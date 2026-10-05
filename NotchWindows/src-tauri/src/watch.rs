//! One background thread that keeps an eye on the desktop, twice a second:
//!
//! • which app is in front (so window snapping and snippet pasting act on the
//!   app you were using, not on the notch), and its friendly name;
//! • whether that app is fullscreen (the notch hides itself);
//! • Screen Time: seconds per app per day, only while you're actually at the PC;
//! • which apps are using the microphone or camera;
//! • display changes, so the notch stays at the top of the screen.

// Parts of this file only run on Windows; development builds elsewhere get stubs.
#![cfg_attr(not(windows), allow(dead_code, unused_imports))]

use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// The last window in front that wasn't the notch.
pub static LAST_EXTERNAL: AtomicIsize = AtomicIsize::new(0);
/// Open the notch when the mouse is pushed against the top edge of the screen.
pub static EDGE_TRIGGER: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[derive(Serialize, Clone, PartialEq, Default)]
pub struct Foreground {
    pub exe: String,
    pub name: String,
    pub title: String,
}

#[derive(Serialize, Clone, PartialEq, Default)]
pub struct Privacy {
    pub microphone: Vec<String>,
    pub camera: Vec<String>,
}

/// date (YYYY-MM-DD) -> app name -> seconds
type Usage = HashMap<String, HashMap<String, u64>>;
static USAGE: Mutex<Option<Usage>> = Mutex::new(None);

fn usage_file(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("screentime.json"))
}

fn load_usage(app: &AppHandle) -> Usage {
    usage_file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_usage(app: &AppHandle, usage: &Usage) {
    if let Some(p) = usage_file(app) {
        if let Ok(s) = serde_json::to_string(usage) {
            let _ = std::fs::write(p, s);
        }
    }
}

pub fn start(app: AppHandle) {
    let _ = std::thread::Builder::new().name("watch".into()).spawn(move || run(app));
}

fn run(app: AppHandle) {
    if let Ok(mut u) = USAGE.lock() {
        *u = Some(load_usage(&app));
    }
    let mut last_fg = Foreground::default();
    let mut last_fullscreen = false;
    let mut last_privacy = Privacy::default();
    let mut last_screen = screen_signature();
    let mut tick: u64 = 0;
    let mut last_count = Instant::now();
    let mut dirty = false;
    let mut edge_since: Option<Instant> = None;

    loop {
        std::thread::sleep(Duration::from_millis(500));
        tick += 1;

        // Edge trigger: the cursor resting on the top edge for half a second.
        if EDGE_TRIGGER.load(Ordering::Relaxed) && !crate::window::EXPANDED.load(Ordering::Relaxed) {
            if cursor_at_top_edge() {
                match edge_since {
                    Some(t) if t.elapsed() >= Duration::from_millis(450) => {
                        edge_since = None;
                        let _ = app.emit("edge", ());
                    }
                    None => edge_since = Some(Instant::now()),
                    _ => {}
                }
            } else {
                edge_since = None;
            }
        }

        let fg = foreground();
        if let Some(fg) = &fg {
            if fg.exe != last_fg.exe {
                let _ = app.emit("foreground", fg.clone());
            }
            last_fg = fg.clone();
        }

        let fullscreen = fg.is_some() && foreground_is_fullscreen();
        if fullscreen != last_fullscreen {
            last_fullscreen = fullscreen;
            let _ = app.emit("fullscreen", fullscreen);
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || crate::window::set_fullscreen(&handle, fullscreen));
        }

        // Screen Time: count the elapsed time for the app in front, unless idle 2+ minutes.
        let elapsed = last_count.elapsed().as_secs_f64();
        if elapsed >= 5.0 {
            last_count = Instant::now();
            if idle_seconds() < 120 && !last_fg.name.is_empty() {
                if let Ok(mut guard) = USAGE.lock() {
                    let usage = guard.get_or_insert_with(Usage::new);
                    *usage.entry(today()).or_default().entry(last_fg.name.clone()).or_default() += elapsed.round() as u64;
                    dirty = true;
                }
            }
        }
        // Save once a minute, and keep the last 35 days.
        if dirty && tick % 120 == 0 {
            if let Ok(mut guard) = USAGE.lock() {
                if let Some(usage) = guard.as_mut() {
                    if usage.len() > 35 {
                        let mut days: Vec<String> = usage.keys().cloned().collect();
                        days.sort();
                        for d in days.iter().take(usage.len() - 35) {
                            usage.remove(d);
                        }
                    }
                    save_usage(&app, usage);
                }
            }
            dirty = false;
        }

        // Microphone and camera use, every 2 s.
        if tick % 4 == 0 {
            let p = privacy();
            if p != last_privacy {
                last_privacy = p.clone();
                let _ = app.emit("privacy", p);
            }
        }

        // Display layout changed (resolution, scaling, monitor plugged in): re-place.
        if tick % 4 == 2 {
            let screen = screen_signature();
            if screen != last_screen {
                last_screen = screen;
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    let _ = crate::window::place(&handle);
                });
            }
        }
    }
}

// ---- commands ----

#[tauri::command]
pub fn screen_time(app: AppHandle) -> Usage {
    let guard = USAGE.lock();
    match guard.ok().and_then(|g| g.clone()) {
        Some(u) => u,
        None => load_usage(&app),
    }
}

#[tauri::command]
pub fn set_edge_trigger(on: bool) {
    EDGE_TRIGGER.store(on, Ordering::Relaxed);
}

#[tauri::command]
pub fn privacy_now() -> Privacy {
    privacy()
}

#[tauri::command]
pub fn foreground_now() -> Option<Foreground> {
    foreground()
}

/// Minimises the last app you were using (Screen Time limits, Focus blocking).
#[tauri::command]
pub fn minimize_external() {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_MINIMIZE};
        let h = LAST_EXTERNAL.load(Ordering::Relaxed);
        if h != 0 {
            let _ = ShowWindow(windows::Win32::Foundation::HWND(h as _), SW_MINIMIZE);
        }
    }
}

fn today() -> String {
    #[cfg(windows)]
    {
        let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
        format!("{:04}-{:02}-{:02}", t.wYear, t.wMonth, t.wDay)
    }
    #[cfg(not(windows))]
    {
        let days = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() / 86_400)
            .unwrap_or(0) as i64;
        // Civil-from-days (UTC), good enough for development builds.
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
        format!("{y:04}-{m:02}-{d:02}")
    }
}

// ---- Windows ----

#[cfg(windows)]
mod imp {
    use super::*;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HWND, RECT};
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::System::Threading::{
        GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetSystemMetrics, GetWindowRect, GetWindowTextW,
        GetWindowThreadProcessId, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    };

    static NAMES: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

    fn class_of(hwnd: HWND) -> String {
        let mut buf = [0u16; 128];
        let n = unsafe { GetClassNameW(hwnd, &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    pub fn exe_path(pid: u32) -> Option<String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
            let _ = CloseHandle(handle);
            ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
        }
    }

    /// "Google Chrome" rather than "chrome": the exe's own description when it has one.
    pub fn friendly_name(path: &str) -> String {
        if let Ok(mut guard) = NAMES.lock() {
            let cache = guard.get_or_insert_with(HashMap::new);
            if let Some(n) = cache.get(path) {
                return n.clone();
            }
            let name = file_description(path).unwrap_or_else(|| {
                std::path::Path::new(path)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default()
            });
            cache.insert(path.to_string(), name.clone());
            return name;
        }
        String::new()
    }

    fn file_description(path: &str) -> Option<String> {
        use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let size = GetFileVersionInfoSizeW(PCWSTR(wide.as_ptr()), None);
            if size == 0 {
                return None;
            }
            let mut data = vec![0u8; size as usize];
            GetFileVersionInfoW(PCWSTR(wide.as_ptr()), None, size, data.as_mut_ptr() as _).ok()?;

            // The first language/code page in the translation table.
            let mut ptr: *mut std::ffi::c_void = std::ptr::null_mut();
            let mut len: u32 = 0;
            let query: Vec<u16> = "\\VarFileInfo\\Translation\0".encode_utf16().collect();
            if !VerQueryValueW(data.as_ptr() as _, PCWSTR(query.as_ptr()), &mut ptr, &mut len).as_bool() || len < 4 {
                return None;
            }
            let lang = *(ptr as *const u16);
            let cp = *((ptr as *const u16).add(1));
            let key = format!("\\StringFileInfo\\{lang:04x}{cp:04x}\\FileDescription\0");
            let key: Vec<u16> = key.encode_utf16().collect();
            if !VerQueryValueW(data.as_ptr() as _, PCWSTR(key.as_ptr()), &mut ptr, &mut len).as_bool() || len == 0 {
                return None;
            }
            let slice = std::slice::from_raw_parts(ptr as *const u16, len as usize);
            let text = String::from_utf16_lossy(slice).trim_end_matches('\0').trim().to_string();
            (!text.is_empty() && text.len() < 60).then_some(text)
        }
    }

    pub fn foreground() -> Option<Foreground> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == GetCurrentProcessId() {
                return None; // the notch itself
            }
            let class = class_of(hwnd);
            if matches!(class.as_str(), "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
                return None;
            }
            LAST_EXTERNAL.store(hwnd.0 as isize, Ordering::Relaxed);
            let path = exe_path(pid).unwrap_or_default();
            let mut title = [0u16; 256];
            let n = GetWindowTextW(hwnd, &mut title);
            let exe = std::path::Path::new(&path)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let name = if matches!(class.as_str(), "Progman" | "WorkerW") {
                "Desktop".to_string()
            } else if exe.eq_ignore_ascii_case("ApplicationFrameHost.exe") {
                // Store apps are hosted; their window title is the app's name.
                String::from_utf16_lossy(&title[..n.max(0) as usize])
            } else {
                friendly_name(&path)
            };
            Some(Foreground { exe, name, title: String::from_utf16_lossy(&title[..n.max(0) as usize]) })
        }
    }

    pub fn foreground_is_fullscreen() -> bool {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return false;
            }
            if matches!(class_of(hwnd).as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd") {
                return false;
            }
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_err() {
                return false;
            }
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                return false;
            }
            let m = info.rcMonitor;
            rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom
        }
    }

    pub fn cursor_at_top_edge() -> bool {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTONEAREST as NEAREST};
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
        unsafe {
            let mut p = POINT::default();
            if GetCursorPos(&mut p).is_err() {
                return false;
            }
            let monitor = MonitorFromPoint(p, NEAREST);
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                return false;
            }
            // Only on the primary screen, where the notch is.
            info.dwFlags & 1 != 0 && p.y <= info.rcMonitor.top
        }
    }

    pub fn idle_seconds() -> u64 {
        unsafe {
            let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
            if !GetLastInputInfo(&mut info).as_bool() {
                return 0;
            }
            let now = windows::Win32::System::SystemInformation::GetTickCount();
            (now.wrapping_sub(info.dwTime) / 1000) as u64
        }
    }

    pub fn screen_signature() -> (i32, i32, i32, i32) {
        unsafe {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN),
                GetSystemMetrics(SM_CYVIRTUALSCREEN),
            )
        }
    }

    /// Apps using the microphone or camera right now, from the same registry
    /// keys Windows reads for its own "in use" icon in the taskbar.
    pub fn privacy() -> Privacy {
        Privacy { microphone: in_use("microphone"), camera: in_use("webcam") }
    }

    fn in_use(capability: &str) -> Vec<String> {
        use windows::Win32::System::Registry::HKEY_CURRENT_USER;
        let base = format!(r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{capability}");
        let mut names = Vec::new();
        for sub in reg::subkeys(HKEY_CURRENT_USER, &base) {
            if sub == "NonPackaged" {
                for app in reg::subkeys(HKEY_CURRENT_USER, &format!(r"{base}\NonPackaged")) {
                    if reg::active(HKEY_CURRENT_USER, &format!(r"{base}\NonPackaged\{app}")) {
                        let path = app.replace('#', "\\");
                        let name = friendly_name(&path);
                        names.push(if name.is_empty() { path } else { name });
                    }
                }
            } else if reg::active(HKEY_CURRENT_USER, &format!(r"{base}\{sub}")) {
                // "Microsoft.WindowsCamera_8wekyb3d8bbwe" -> "WindowsCamera"
                let short = sub.split('_').next().unwrap_or(&sub);
                names.push(short.rsplit('.').next().unwrap_or(short).to_string());
            }
        }
        names.sort();
        names.dedup();
        names
    }

    mod reg {
        use windows::core::{PCWSTR, PWSTR};
        use windows::Win32::Foundation::ERROR_SUCCESS;
        use windows::Win32::System::Registry::{
            RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, KEY_READ,
        };

        fn wide(s: &str) -> Vec<u16> {
            s.encode_utf16().chain(std::iter::once(0)).collect()
        }

        fn open(root: HKEY, path: &str) -> Option<HKEY> {
            let p = wide(path);
            let mut key = HKEY::default();
            let r = unsafe { RegOpenKeyExW(root, PCWSTR(p.as_ptr()), Some(0), KEY_READ, &mut key) };
            (r == ERROR_SUCCESS).then_some(key)
        }

        pub fn subkeys(root: HKEY, path: &str) -> Vec<String> {
            let Some(key) = open(root, path) else { return Vec::new() };
            let mut out = Vec::new();
            for i in 0..512u32 {
                let mut buf = [0u16; 512];
                let mut len = buf.len() as u32;
                let r = unsafe {
                    RegEnumKeyExW(key, i, Some(PWSTR(buf.as_mut_ptr())), &mut len, None, None, None, None)
                };
                if r != ERROR_SUCCESS {
                    break;
                }
                out.push(String::from_utf16_lossy(&buf[..len as usize]));
            }
            unsafe {
                let _ = RegCloseKey(key);
            }
            out
        }

        fn qword(key: HKEY, name: &str) -> Option<u64> {
            let n = wide(name);
            let mut value = 0u64;
            let mut size = 8u32;
            let r = unsafe {
                RegQueryValueExW(key, PCWSTR(n.as_ptr()), None, None, Some(&mut value as *mut u64 as *mut u8), Some(&mut size))
            };
            (r == ERROR_SUCCESS).then_some(value)
        }

        /// In use: it has started and hasn't stopped.
        pub fn active(root: HKEY, path: &str) -> bool {
            let Some(key) = open(root, path) else { return false };
            let start = qword(key, "LastUsedTimeStart").unwrap_or(0);
            let stop = qword(key, "LastUsedTimeStop").unwrap_or(1);
            unsafe {
                let _ = RegCloseKey(key);
            }
            start > 0 && stop == 0
        }
    }
}

#[cfg(windows)]
use imp::{cursor_at_top_edge, foreground, foreground_is_fullscreen, idle_seconds, privacy, screen_signature};
#[cfg(windows)]
pub use imp::{exe_path, friendly_name};

#[cfg(not(windows))]
fn foreground() -> Option<Foreground> {
    None
}
#[cfg(not(windows))]
fn foreground_is_fullscreen() -> bool {
    false
}
#[cfg(not(windows))]
fn cursor_at_top_edge() -> bool {
    false
}
#[cfg(not(windows))]
fn idle_seconds() -> u64 {
    0
}
#[cfg(not(windows))]
fn privacy() -> Privacy {
    Privacy::default()
}
#[cfg(not(windows))]
fn screen_signature() -> (i32, i32, i32, i32) {
    (0, 0, 0, 0)
}
