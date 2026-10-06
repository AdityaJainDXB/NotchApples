//! The notch window: where it sits, how big it is, and whether it's showing.
//!
//! Collapsed it's a slim pill at the top of the primary screen; opening it grows
//! the window downward, the way the Mac notch opens. It hides itself while a
//! fullscreen app (a video, a game, a presentation) is in front.

use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow};

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    /// "center", "left" or "right" along the top edge.
    pub position: String,
    pub pill_width: f64,
    pub pill_height: f64,
    pub width: f64,
    pub height: f64,
    /// Distance from the screen edge when on the left or right.
    pub inset: f64,
}

impl Default for Layout {
    fn default() -> Self {
        Self {
            position: "center".into(),
            pill_width: 240.0,
            pill_height: 34.0,
            width: 780.0,
            height: 460.0,
            inset: 120.0,
        }
    }
}

static LAYOUT: Mutex<Option<Layout>> = Mutex::new(None);
/// The last bounds applied, in physical pixels (x, y, width, height). Placing the window again with the
/// same bounds does nothing, so repeated calls cost nothing and cannot make the window flicker.
static LAST_BOUNDS: Mutex<Option<(i32, i32, i32, i32)>> = Mutex::new(None);
static TOPMOST_SET: AtomicBool = AtomicBool::new(false);
pub static EXPANDED: AtomicBool = AtomicBool::new(false);
/// Hidden with Ctrl+Alt+O or the eye button.
pub static USER_HIDDEN: AtomicBool = AtomicBool::new(false);
/// Hidden because a fullscreen app is in front.
pub static FULLSCREEN_HIDDEN: AtomicBool = AtomicBool::new(false);
pub static HIDE_IN_FULLSCREEN: AtomicBool = AtomicBool::new(true);

fn layout() -> Layout {
    LAYOUT.lock().ok().and_then(|l| l.clone()).unwrap_or_default()
}

/// Sizes and positions the window for its current state.
pub fn place(app: &AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("notch").ok_or("no notch window")?;
    let l = layout();
    let expanded = EXPANDED.load(Ordering::Relaxed);
    let (w, h) = if expanded { (l.width, l.height) } else { (l.pill_width, l.pill_height) };

    let monitor = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())
        .ok_or("no monitor")?;
    let scale = monitor.scale_factor();
    let screen = monitor.size().to_logical::<f64>(scale);
    let origin = monitor.position().to_logical::<f64>(scale);

    // Never wider than the screen.
    let w = w.min(screen.width - 16.0);
    let x = match l.position.as_str() {
        "left" => origin.x + l.inset.min(screen.width - w),
        "right" => origin.x + (screen.width - w - l.inset).max(0.0),
        _ => origin.x + (screen.width - w) / 2.0,
    };

    let bounds = (
        (x * scale).round() as i32,
        (origin.y * scale).round() as i32,
        (w * scale).round() as i32,
        (h * scale).round() as i32,
    );
    let changed = LAST_BOUNDS.lock().map(|mut last| {
        let changed = *last != Some(bounds);
        *last = Some(bounds);
        changed
    }).unwrap_or(true);
    if changed {
        set_bounds(&window, bounds, (x, origin.y, w, h))?;
    }
    // Always-on-top only needs asking for once; asking every time re-stacks the window for nothing.
    if !TOPMOST_SET.swap(true, Ordering::Relaxed) {
        let _ = window.set_always_on_top(true);
    }
    if expanded {
        let _ = window.set_focus();
    }
    Ok(())
}

/// Moves and resizes the window in ONE native call. Doing it as two calls (size, then position) draws the
/// window once at the new size in the old place, which shows as a jump while the notch opens.
#[cfg(windows)]
fn set_bounds(window: &WebviewWindow, px: (i32, i32, i32, i32), _logical: (f64, f64, f64, f64)) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let result = unsafe { SetWindowPos(HWND(hwnd as _), None, px.0, px.1, px.2, px.3, SWP_NOZORDER | SWP_NOACTIVATE) };
    result.map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn set_bounds(window: &WebviewWindow, _px: (i32, i32, i32, i32), logical: (f64, f64, f64, f64)) -> Result<(), String> {
    window.set_size(LogicalSize::new(logical.2, logical.3)).map_err(|e| e.to_string())?;
    window.set_position(LogicalPosition::new(logical.0, logical.1)).map_err(|e| e.to_string())
}

/// Shows or hides the window from the two reasons it can be hidden.
pub fn apply_visibility(app: &AppHandle) {
    let Some(window) = app.get_webview_window("notch") else { return };
    let hidden = USER_HIDDEN.load(Ordering::Relaxed)
        || (FULLSCREEN_HIDDEN.load(Ordering::Relaxed) && !EXPANDED.load(Ordering::Relaxed));
    let visible = window.is_visible().unwrap_or(true);
    if hidden && visible {
        let _ = window.hide();
    } else if !hidden && !visible {
        let _ = window.show();
        if let Ok(mut last) = LAST_BOUNDS.lock() { *last = None; }
        let _ = place(app);
    }
}

pub fn set_fullscreen(app: &AppHandle, fullscreen: bool) {
    let want = fullscreen && HIDE_IN_FULLSCREEN.load(Ordering::Relaxed);
    if FULLSCREEN_HIDDEN.swap(want, Ordering::Relaxed) != want {
        apply_visibility(app);
    }
}

// ---- commands ----

#[tauri::command]
pub fn set_expanded(app: AppHandle, expanded: bool) -> Result<(), String> {
    EXPANDED.store(expanded, Ordering::Relaxed);
    if expanded {
        // Opening always shows it, even over a fullscreen app.
        if let Some(w) = app.get_webview_window("notch") {
            let _ = w.show();
        }
    }
    place(&app)?;
    apply_visibility(&app);
    Ok(())
}

#[tauri::command]
pub fn set_layout(app: AppHandle, layout: Layout) -> Result<(), String> {
    let clean = Layout {
        position: layout.position,
        pill_width: layout.pill_width.clamp(120.0, 600.0),
        pill_height: layout.pill_height.clamp(22.0, 60.0),
        width: layout.width.clamp(560.0, 1400.0),
        height: layout.height.clamp(340.0, 900.0),
        inset: layout.inset.clamp(0.0, 4000.0),
    };
    if let Ok(mut l) = LAYOUT.lock() {
        *l = Some(clean);
    }
    place(&app)
}

#[tauri::command]
pub fn set_hidden(app: AppHandle, hidden: bool) {
    USER_HIDDEN.store(hidden, Ordering::Relaxed);
    apply_visibility(&app);
}

#[tauri::command]
pub fn set_hide_in_fullscreen(app: AppHandle, on: bool) {
    HIDE_IN_FULLSCREEN.store(on, Ordering::Relaxed);
    if !on {
        FULLSCREEN_HIDDEN.store(false, Ordering::Relaxed);
        apply_visibility(&app);
    }
}

/// Shows the notch if it was hidden, then asks the UI to open or close it.
pub fn toggle(app: &AppHandle) {
    use tauri::Emitter;
    if USER_HIDDEN.swap(false, Ordering::Relaxed) {
        apply_visibility(app);
    }
    let _ = app.emit("toggle-notch", ());
}

pub fn toggle_hidden(app: &AppHandle) {
    let now = !USER_HIDDEN.load(Ordering::Relaxed);
    USER_HIDDEN.store(now, Ordering::Relaxed);
    apply_visibility(app);
}
