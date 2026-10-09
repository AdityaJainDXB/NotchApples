//! Do It (Ultimate): lets the AI work the mouse and keyboard on this PC, one step at a time. The page decides what
//! to do (see services/doit.js); this file only performs a single click, a piece of typing, a key press or a
//! scroll when asked, and takes the screenshot with the small status window out of the way.
//!
//! Stop works from anywhere: while a run is active Ctrl+Alt+Esc is registered as a global shortcut, and the small
//! always-on-top status window (doit-status.html) has its own Stop button. Both send the "doit-stop" event.

use serde::Serialize;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Sending input and reading the screen size. Pure Windows calls, no app types, so it can be checked on its own.
pub mod synth {
    /// Key names and key combinations such as "ctrl+shift+t": (modifiers, key) as virtual-key codes.
    pub fn vk_of(name: &str) -> Option<u16> {
        let n = name.trim().to_ascii_lowercase();
        let one = n.chars().count() == 1;
        if one {
            let c = n.chars().next()?;
            if c.is_ascii_lowercase() {
                return Some(c.to_ascii_uppercase() as u16);
            }
            if c.is_ascii_digit() {
                return Some(c as u16);
            }
        }
        if let Some(num) = n.strip_prefix('f') {
            if let Ok(k) = num.parse::<u16>() {
                if (1..=24).contains(&k) {
                    return Some(0x70 + k - 1);
                }
            }
        }
        Some(match n.as_str() {
            "ctrl" | "control" => 0x11,
            "shift" => 0x10,
            "alt" | "option" => 0x12,
            "win" | "windows" | "meta" | "cmd" | "super" => 0x5B,
            "enter" | "return" => 0x0D,
            "tab" => 0x09,
            "esc" | "escape" => 0x1B,
            "backspace" | "back" => 0x08,
            "delete" | "del" => 0x2E,
            "insert" | "ins" => 0x2D,
            "home" => 0x24,
            "end" => 0x23,
            "pageup" | "pgup" => 0x21,
            "pagedown" | "pgdn" | "pgdown" => 0x22,
            "space" | "spacebar" => 0x20,
            "left" => 0x25,
            "up" => 0x26,
            "right" => 0x27,
            "down" => 0x28,
            "-" | "minus" => 0xBD,
            "=" | "equals" | "plus" => 0xBB,
            "," | "comma" => 0xBC,
            "." | "period" => 0xBE,
            "/" | "slash" => 0xBF,
            ";" | "semicolon" => 0xBA,
            _ => return None,
        })
    }

    pub fn is_modifier(vk: u16) -> bool {
        matches!(vk, 0x10 | 0x11 | 0x12 | 0x5B)
    }

    /// "ctrl+a" -> [0x11, 0x41]. The last part is the key, the rest are held while it is pressed.
    pub fn parse_combo(combo: &str) -> Result<Vec<u16>, String> {
        let parts: Vec<&str> = combo.split('+').map(|p| p.trim()).filter(|p| !p.is_empty()).collect();
        if parts.is_empty() {
            return Err("No key given.".into());
        }
        parts.iter().map(|p| vk_of(p).ok_or_else(|| format!("I don't know the key \"{p}\"."))).collect()
    }

    #[cfg(windows)]
    pub use imp::*;

    #[cfg(windows)]
    mod imp {
        use std::time::Duration;
        use windows::Win32::Graphics::Gdi::{GetDC, GetDeviceCaps, ReleaseDC, LOGPIXELSX};
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY,
            KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
            MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT, MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
        };
        use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SetCursorPos, SM_CXSCREEN, SM_CYSCREEN};

        /// The primary monitor in physical pixels: (width, height, left, top, scale).
        pub fn screen() -> (i32, i32, i32, i32, f64) {
            unsafe {
                let w = GetSystemMetrics(SM_CXSCREEN);
                let h = GetSystemMetrics(SM_CYSCREEN);
                let dc = GetDC(None);
                let dpi = if dc.is_invalid() { 96 } else { GetDeviceCaps(Some(dc), LOGPIXELSX) };
                if !dc.is_invalid() {
                    ReleaseDC(None, dc);
                }
                (w, h, 0, 0, if dpi > 0 { dpi as f64 / 96.0 } else { 1.0 })
            }
        }

        fn send(inputs: &[INPUT]) {
            unsafe {
                SendInput(inputs, std::mem::size_of::<INPUT>() as i32);
            }
        }

        fn mouse(flags: MOUSE_EVENT_FLAGS, data: i32) -> INPUT {
            INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: data as u32, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
            }
        }

        fn key(vk: u16, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
            }
        }

        fn pause(ms: u64) {
            std::thread::sleep(Duration::from_millis(ms));
        }

        /// Moves the pointer to physical pixel (x, y) and clicks `count` times (1 or 2, max 3).
        pub fn click(x: i32, y: i32, right: bool, count: u32) {
            unsafe {
                let _ = SetCursorPos(x, y);
            }
            pause(60);
            let (down, up) = if right { (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP) } else { (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP) };
            for _ in 0..count.clamp(1, 3) {
                send(&[mouse(down, 0), mouse(up, 0)]);
                pause(40);
            }
        }

        /// Scrolls at the pointer, or at (x, y) when given. dy > 0 scrolls down, dx > 0 scrolls right, in wheel notches.
        pub fn scroll(at: Option<(i32, i32)>, dx: i32, dy: i32) {
            if let Some((x, y)) = at {
                unsafe {
                    let _ = SetCursorPos(x, y);
                }
                pause(60);
            }
            if dy != 0 {
                send(&[mouse(MOUSEEVENTF_WHEEL, -dy.clamp(-50, 50) * 120)]);
            }
            if dx != 0 {
                send(&[mouse(MOUSEEVENTF_HWHEEL, dx.clamp(-50, 50) * 120)]);
            }
        }

        /// Types text into whatever has focus, one UTF-16 unit at a time (so any language and emoji work).
        pub fn type_text(text: &str) {
            for ch in text.chars() {
                match ch {
                    '\r' => {}
                    '\n' => press(&[0x0D]),
                    '\t' => press(&[0x09]),
                    _ => {
                        let mut buf = [0u16; 2];
                        for unit in ch.encode_utf16(&mut buf).iter() {
                            send(&[key(0, *unit, KEYEVENTF_UNICODE), key(0, *unit, KEYBD_EVENT_FLAGS(KEYEVENTF_UNICODE.0 | KEYEVENTF_KEYUP.0))]);
                        }
                    }
                }
                pause(8);
            }
        }

        fn extended(vk: u16) -> KEYBD_EVENT_FLAGS {
            // Arrows, Home/End, Page Up/Down, Insert, Delete and the Windows key are "extended" keys.
            if matches!(vk, 0x21..=0x28 | 0x2D | 0x2E | 0x5B) { KEYEVENTF_EXTENDEDKEY } else { KEYBD_EVENT_FLAGS(0) }
        }

        /// Presses keys together: all but the last are held while the last is tapped.
        pub fn press(vks: &[u16]) {
            let Some((last, held)) = vks.split_last() else { return };
            for vk in held {
                send(&[key(*vk, 0, extended(*vk))]);
                pause(15);
            }
            send(&[key(*last, 0, extended(*last))]);
            pause(30);
            send(&[key(*last, 0, KEYBD_EVENT_FLAGS(extended(*last).0 | KEYEVENTF_KEYUP.0))]);
            for vk in held.iter().rev() {
                pause(15);
                send(&[key(*vk, 0, KEYBD_EVENT_FLAGS(extended(*vk).0 | KEYEVENTF_KEYUP.0))]);
            }
        }
    }
}

// ---- commands -------------------------------------------------------------

#[derive(Serialize)]
pub struct Screen {
    pub width: i32,
    pub height: i32,
    pub left: i32,
    pub top: i32,
    pub scale: f64,
}

/// The primary monitor in physical pixels (what the clicks use).
#[tauri::command]
pub fn doit_screen() -> Screen {
    #[cfg(windows)]
    {
        let (width, height, left, top, scale) = synth::screen();
        Screen { width, height, left, top, scale }
    }
    #[cfg(not(windows))]
    Screen { width: 1920, height: 1080, left: 0, top: 0, scale: 1.0 }
}

#[tauri::command]
pub async fn doit_click(x: i32, y: i32, button: String, count: u32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        synth::click(x, y, button == "right", count);
        #[cfg(not(windows))]
        let _ = (x, y, button, count);
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doit_type(text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        synth::type_text(&text);
        #[cfg(not(windows))]
        let _ = text;
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doit_key(combo: String) -> Result<(), String> {
    let vks = synth::parse_combo(&combo)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        synth::press(&vks);
        #[cfg(not(windows))]
        let _ = vks;
    })
    .await
    .map_err(|e| e.to_string())
}

/// Scrolls the wheel (notches; positive dy scrolls down) at the pointer, or at the given physical pixel.
#[tauri::command]
pub async fn doit_scroll(x: Option<i32>, y: Option<i32>, dx: i32, dy: i32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        synth::scroll(x.zip(y), dx, dy);
        #[cfg(not(windows))]
        let _ = (x, y, dx, dy);
    })
    .await
    .map_err(|e| e.to_string())
}

/// Waits without relying on page timers (the notch window is hidden during a run, and a hidden page's timers are throttled).
#[tauri::command]
pub async fn doit_sleep(ms: u64) {
    tokio_sleep(ms.min(30_000)).await;
}

async fn tokio_sleep(ms: u64) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(std::time::Duration::from_millis(ms))).await;
}

const STATUS: &str = "doit-status";
const HOTKEY: &str = "Ctrl+Alt+Escape";
static HOTKEY_ID: AtomicU32 = AtomicU32::new(0);

/// True (and handled) when `id` is the Stop shortcut.
pub fn on_shortcut(app: &AppHandle, id: u32) -> bool {
    let mine = HOTKEY_ID.load(Ordering::Relaxed);
    if mine != 0 && mine == id {
        let _ = app.emit("doit-stop", ());
        true
    } else {
        false
    }
}

/// A run starts (true) or ends (false): Ctrl+Alt+Esc is the Stop shortcut and the status window is shown only while it runs.
#[tauri::command]
pub fn doit_arm(app: AppHandle, on: bool) -> Result<bool, String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let mut hotkey_ok = false;
    if let Ok(shortcut) = HOTKEY.parse::<Shortcut>() {
        let gs = app.global_shortcut();
        if on {
            let _ = gs.unregister(shortcut);
            hotkey_ok = gs.register(shortcut).is_ok();
            HOTKEY_ID.store(if hotkey_ok { shortcut.id() } else { 0 }, Ordering::Relaxed);
        } else {
            let _ = gs.unregister(shortcut);
            HOTKEY_ID.store(0, Ordering::Relaxed);
        }
    }
    if on {
        show_status(&app)?;
    } else if let Some(w) = app.get_webview_window(STATUS) {
        let _ = w.hide();
    }
    Ok(hotkey_ok)
}

fn show_status(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(STATUS) {
        place(app, &w);
        let _ = w.show();
        return Ok(());
    }
    let w = WebviewWindowBuilder::new(app, STATUS, WebviewUrl::App("doit-status.html".into()))
        .title("Do It")
        .inner_size(340.0, 44.0)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .shadow(false)
        .build()
        .map_err(|e| e.to_string())?;
    place(app, &w);
    Ok(())
}

/// Bottom centre of the primary monitor, just above the taskbar.
fn place(app: &AppHandle, w: &tauri::WebviewWindow) {
    if let Ok(Some(m)) = app.primary_monitor() {
        let s = m.scale_factor();
        let (mw, mh) = (m.size().width as f64, m.size().height as f64);
        let x = m.position().x as f64 + (mw - 340.0 * s) / 2.0;
        let y = m.position().y as f64 + mh - (44.0 + 64.0) * s;
        let _ = w.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
    }
}

/// A JPEG of the main screen (base64), with the status window hidden for the instant of the capture. The notch is
/// hidden by the page for the whole run, so unlike capture_screen this never shows it again.
#[tauri::command]
pub async fn doit_capture(app: AppHandle) -> Result<String, String> {
    let status = app.get_webview_window(STATUS);
    let was_visible = status.as_ref().map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false);
    if was_visible {
        if let Some(w) = &status {
            let _ = w.hide();
        }
    }
    let shot = tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(160));
        crate::grab_screen(1568)
    })
    .await
    .map_err(|e| e.to_string())?;
    if was_visible {
        if let Some(w) = &status {
            let _ = w.show();
        }
    }
    shot
}
