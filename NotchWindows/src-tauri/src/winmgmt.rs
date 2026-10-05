//! Window snapping, ported from WindowManager.swift: halves, thirds, quarters,
//! maximise, centre, restore and "tile all". It acts on the window you were
//! using before you opened the notch (or the one in front, from a shortcut).

#[cfg(windows)]
mod imp {
    use crate::watch::LAST_EXTERNAL;
    use std::collections::HashMap;
    use std::sync::atomic::Ordering;
    use std::sync::Mutex;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::core::BOOL;
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, MonitorFromWindow, HDC, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowRect, GetWindowTextLengthW,
        GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, IsZoomed, SetForegroundWindow, SetWindowPos,
        ShowWindow, GWL_EXSTYLE, GW_OWNER, SWP_NOACTIVATE, SWP_NOZORDER, SW_MAXIMIZE, SW_RESTORE, WS_EX_TOOLWINDOW,
    };

    /// Where each window was before we moved it, for "Restore".
    static BEFORE: Mutex<Option<HashMap<isize, RECT>>> = Mutex::new(None);

    fn ours(hwnd: HWND) -> bool {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        pid == unsafe { GetCurrentProcessId() }
    }

    /// The window to act on: the one in front unless that's the notch, then the last one.
    pub fn target() -> Option<HWND> {
        unsafe {
            let fg = GetForegroundWindow();
            if !fg.0.is_null() && !ours(fg) {
                return Some(fg);
            }
            let last = HWND(LAST_EXTERNAL.load(Ordering::Relaxed) as _);
            (!last.0.is_null() && IsWindow(Some(last)).as_bool()).then_some(last)
        }
    }

    fn work_area(hwnd: HWND) -> Option<RECT> {
        unsafe {
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            GetMonitorInfoW(monitor, &mut info).as_bool().then_some(info.rcWork)
        }
    }

    /// Windows 10/11 windows have invisible resize borders; size the visible frame instead.
    fn borders(hwnd: HWND) -> (i32, i32, i32, i32) {
        unsafe {
            let mut window = RECT::default();
            let mut frame = RECT::default();
            if GetWindowRect(hwnd, &mut window).is_err()
                || DwmGetWindowAttribute(
                    hwnd,
                    DWMWA_EXTENDED_FRAME_BOUNDS,
                    &mut frame as *mut RECT as *mut _,
                    std::mem::size_of::<RECT>() as u32,
                )
                .is_err()
            {
                return (0, 0, 0, 0);
            }
            (frame.left - window.left, frame.top - window.top, window.right - frame.right, window.bottom - frame.bottom)
        }
    }

    fn move_to(hwnd: HWND, x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
        unsafe {
            if IsZoomed(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            let (l, t, r, b) = borders(hwnd);
            SetWindowPos(hwnd, None, x - l, y - t, w + l + r, h + t + b, SWP_NOZORDER | SWP_NOACTIVATE)
                .map_err(|e| e.to_string())?;
            let _ = SetForegroundWindow(hwnd);
        }
        Ok(())
    }

    fn remember(hwnd: HWND) {
        let mut rect = RECT::default();
        if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
            if let Ok(mut guard) = BEFORE.lock() {
                guard.get_or_insert_with(HashMap::new).entry(hwnd.0 as isize).or_insert(rect);
            }
        }
    }

    pub fn snap(action: &str) -> Result<(), String> {
        let hwnd = target().ok_or("Click the window you want to move first, then open the notch.")?;
        let area = work_area(hwnd).ok_or("Couldn't read the screen size.")?;
        let (ax, ay) = (area.left, area.top);
        let (aw, ah) = (area.right - area.left, area.bottom - area.top);
        let (hw, hh) = (aw / 2, ah / 2);
        let (tw, th) = (aw / 3, ah / 3);
        let _ = th;

        match action {
            "restore" => {
                let saved = BEFORE.lock().ok().and_then(|mut g| g.as_mut().and_then(|m| m.remove(&(hwnd.0 as isize))));
                return match saved {
                    Some(r) => unsafe {
                        if IsZoomed(hwnd).as_bool() {
                            let _ = ShowWindow(hwnd, SW_RESTORE);
                        }
                        SetWindowPos(hwnd, None, r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOZORDER | SWP_NOACTIVATE)
                            .map_err(|e| e.to_string())
                    },
                    None => Err("This window hasn't been moved by Notch apple.".into()),
                };
            }
            "maximize" => {
                remember(hwnd);
                unsafe {
                    let _ = ShowWindow(hwnd, SW_MAXIMIZE);
                    let _ = SetForegroundWindow(hwnd);
                }
                return Ok(());
            }
            "next-display" => return next_display(hwnd),
            _ => {}
        }

        remember(hwnd);
        let (x, y, w, h) = match action {
            "left" => (ax, ay, hw, ah),
            "right" => (ax + hw, ay, aw - hw, ah),
            "top" => (ax, ay, aw, hh),
            "bottom" => (ax, ay + hh, aw, ah - hh),
            "top-left" => (ax, ay, hw, hh),
            "top-right" => (ax + hw, ay, aw - hw, hh),
            "bottom-left" => (ax, ay + hh, hw, ah - hh),
            "bottom-right" => (ax + hw, ay + hh, aw - hw, ah - hh),
            "left-third" => (ax, ay, tw, ah),
            "center-third" => (ax + tw, ay, tw, ah),
            "right-third" => (ax + 2 * tw, ay, aw - 2 * tw, ah),
            "left-two-thirds" => (ax, ay, 2 * tw, ah),
            "right-two-thirds" => (ax + tw, ay, aw - tw, ah),
            "almost-maximize" => (ax + aw / 20, ay + ah / 20, aw * 9 / 10, ah * 9 / 10),
            "center" => {
                let (w, h) = (aw * 6 / 10, ah * 7 / 10);
                (ax + (aw - w) / 2, ay + (ah - h) / 2, w, h)
            }
            other => return Err(format!("Unknown snap: {other}")),
        };
        move_to(hwnd, x, y, w, h)
    }

    fn monitors() -> Vec<RECT> {
        unsafe extern "system" fn each(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
            let list = &mut *(data.0 as *mut Vec<RECT>);
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            if GetMonitorInfoW(m, &mut info).as_bool() {
                list.push(info.rcWork);
            }
            BOOL(1)
        }
        let mut list: Vec<RECT> = Vec::new();
        unsafe {
            let _ = EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut list as *mut _ as isize));
        }
        list.sort_by_key(|r| (r.left, r.top));
        list
    }

    fn next_display(hwnd: HWND) -> Result<(), String> {
        let all = monitors();
        if all.len() < 2 {
            return Err("Only one screen is connected.".into());
        }
        let current = work_area(hwnd).ok_or("Couldn't read the screen size.")?;
        let i = all.iter().position(|r| r.left == current.left && r.top == current.top).unwrap_or(0);
        let next = all[(i + 1) % all.len()];
        let mut rect = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|e| e.to_string())?;
        // Keep the same relative position and size, scaled to the new screen.
        let fx = (rect.left - current.left) as f64 / (current.right - current.left) as f64;
        let fy = (rect.top - current.top) as f64 / (current.bottom - current.top) as f64;
        let fw = (rect.right - rect.left) as f64 / (current.right - current.left) as f64;
        let fh = (rect.bottom - rect.top) as f64 / (current.bottom - current.top) as f64;
        let (nw, nh) = ((next.right - next.left) as f64, (next.bottom - next.top) as f64);
        move_to(
            hwnd,
            next.left + (fx * nw) as i32,
            next.top + (fy * nh) as i32,
            (fw.min(1.0) * nw) as i32,
            (fh.min(1.0) * nh) as i32,
        )
    }

    fn tileable(hwnd: HWND) -> bool {
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() || ours(hwnd) {
                return false;
            }
            if GetWindowTextLengthW(hwnd) == 0 {
                return false;
            }
            if GetWindow(hwnd, GW_OWNER).map(|o| !o.0.is_null()).unwrap_or(false) {
                return false;
            }
            if (GetWindowLongW(hwnd, GWL_EXSTYLE) as u32) & WS_EX_TOOLWINDOW.0 != 0 {
                return false;
            }
            let mut cloaked = 0u32;
            let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, 4);
            cloaked == 0
        }
    }

    /// Arranges every open window on the screen in a grid.
    pub fn tile_all() -> Result<usize, String> {
        unsafe extern "system" fn each(hwnd: HWND, data: LPARAM) -> BOOL {
            let list = &mut *(data.0 as *mut Vec<HWND>);
            if tileable(hwnd) {
                list.push(hwnd);
            }
            BOOL(1)
        }
        let anchor = target().ok_or("Open a window first.")?;
        let area = work_area(anchor).ok_or("Couldn't read the screen size.")?;
        let mut all: Vec<HWND> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(each), LPARAM(&mut all as *mut _ as isize));
        }
        // Only the windows on the same screen.
        let windows: Vec<HWND> = all.into_iter().filter(|h| work_area(*h).map(|r| r.left == area.left && r.top == area.top).unwrap_or(false)).take(12).collect();
        let n = windows.len();
        if n == 0 {
            return Err("No windows to arrange.".into());
        }
        let cols = (n as f64).sqrt().ceil() as i32;
        let rows = ((n as f64) / cols as f64).ceil() as i32;
        let (aw, ah) = (area.right - area.left, area.bottom - area.top);
        for (i, hwnd) in windows.iter().enumerate() {
            let (c, r) = (i as i32 % cols, i as i32 / cols);
            // The last row stretches when it isn't full.
            let in_row = if r == rows - 1 { n as i32 - r * cols } else { cols };
            let w = aw / in_row.max(1);
            remember(*hwnd);
            let _ = move_to(*hwnd, area.left + c * w, area.top + r * (ah / rows), w, ah / rows);
        }
        Ok(n)
    }
}

#[tauri::command]
pub fn snap_window(action: String) -> Result<(), String> {
    #[cfg(windows)]
    return imp::snap(&action);
    #[cfg(not(windows))]
    {
        let _ = action;
        Err("Window snapping is Windows-only in this build.".into())
    }
}

#[tauri::command]
pub fn tile_windows() -> Result<usize, String> {
    #[cfg(windows)]
    return imp::tile_all();
    #[cfg(not(windows))]
    Err("Window snapping is Windows-only in this build.".into())
}

pub fn snap_from_shortcut(action: &str) {
    #[cfg(windows)]
    {
        let _ = imp::snap(action);
    }
    #[cfg(not(windows))]
    let _ = action;
}
