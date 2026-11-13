// Notch Apple for Windows — the native side.
//
// The window is borderless, transparent and always on top, pinned to the top of
// the primary screen. Collapsed it is a slim pill; opening it grows the window
// downward, which is how the Mac notch behaves. Everything the web UI can't do
// on its own (system APIs, background watchers, web requests without CORS)
// lives in the modules below.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod apps;
mod bambu;
mod bambucam;
mod audio;
mod brightness;
mod notifications;
mod pairdrop;
mod awake;
mod claude_usage;
mod clip;
mod extras;
mod files;
mod friendsstore;
mod hello;
mod icons;
mod index;
mod input;
mod klick;
mod convert;
mod doit;
mod doit_win;
mod privategame;
mod media;
mod net;
mod phonetic;
mod plugins;
mod system;
mod update;
mod watch;
mod window;
mod winmgmt;

use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

// ---- app ----------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: &'static str,
    data_dir: String,
    /// Started by Windows at sign-in (so don't pop the panel open).
    autostarted: bool,
    /// Running the automated UI check (CI).
    selftest: bool,
    platform: &'static str,
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        data_dir: app.path().app_data_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        autostarted: std::env::args().any(|a| a == "--autostart"),
        selftest: std::env::var_os("NOTCH_SELFTEST").is_some(),
        platform: if cfg!(windows) { "windows" } else { "other" },
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart(app: AppHandle, on: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    if on { launcher.enable() } else { launcher.disable() }.map_err(|e| e.to_string())
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

// ---- global shortcuts -----------------------------------------------------

/// Shortcut id -> action ("toggle", "hide", "snap:left", "tab:clipboard", …).
static SHORTCUTS: Mutex<Option<HashMap<u32, String>>> = Mutex::new(None);

/// Registers the user's shortcuts. Returns the ones Windows refused, usually
/// because another app already uses them.
#[tauri::command]
fn register_shortcuts(app: AppHandle, shortcuts: HashMap<String, String>) -> Vec<String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut map = HashMap::new();
    let mut failed = Vec::new();
    for (action, keys) in shortcuts {
        if keys.trim().is_empty() {
            continue;
        }
        match keys.parse::<Shortcut>() {
            Ok(shortcut) => {
                if gs.register(shortcut).is_ok() {
                    map.insert(shortcut.id(), action);
                } else {
                    failed.push(keys);
                }
            }
            Err(_) => failed.push(keys),
        }
    }
    if let Ok(mut s) = SHORTCUTS.lock() {
        *s = Some(map);
    }
    failed
}

fn on_shortcut(app: &AppHandle, id: u32) {
    if doit::on_shortcut(app, id) {
        return;
    }
    let action = SHORTCUTS.lock().ok().and_then(|s| s.as_ref().and_then(|m| m.get(&id).cloned()));
    let Some(action) = action else { return };
    match action.as_str() {
        "toggle" => window::toggle(app),
        "hide" => window::toggle_hidden(app),
        a if a.starts_with("snap:") => winmgmt::snap_from_shortcut(&a[5..]),
        "tile" => {
            let _ = winmgmt::tile_windows();
        }
        _ => {
            // Everything else is for the UI (open a tab, start Focus, …).
            window::USER_HIDDEN.store(false, std::sync::atomic::Ordering::Relaxed);
            window::apply_visibility(app);
            let _ = app.emit("shortcut", action);
        }
    }
}

// ---- system -------------------------------------------------------------

#[tauri::command]
fn system_stats() -> system::Stats {
    let mut guard = system::MONITOR.lock().unwrap_or_else(|e| e.into_inner());
    guard.get_or_insert_with(system::Monitor::new).read()
}

#[tauri::command]
async fn top_processes(limit: Option<usize>) -> Vec<system::Proc> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = system::MONITOR.lock().unwrap_or_else(|e| e.into_inner());
        guard.get_or_insert_with(system::Monitor::new).processes(limit.unwrap_or(8))
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
fn transliterate(text: String) -> String {
    phonetic::latin(&text)
}

/// A JPEG of the main screen, base64 encoded, with the notch hidden so the app
/// never photographs itself.
#[tauri::command]
async fn capture_screen(app: AppHandle) -> Result<String, String> {
    let window = app.get_webview_window("notch");
    if let Some(w) = &window {
        let _ = w.hide();
    }
    let shot = tauri::async_runtime::spawn_blocking(|| {
        // Give the compositor a moment to actually remove the window from the screen.
        std::thread::sleep(std::time::Duration::from_millis(180));
        grab_screen(1568)
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Some(w) = &window {
        let _ = w.show();
        let _ = w.set_focus();
    }
    shot
}

fn grab_screen(longest_edge: u32) -> Result<String, String> {
    grab_screen_region(longest_edge, None)
}

/// The primary screen as a base64 JPEG no longer than `longest_edge` on its longest side. With `region` ([x0, y0, x1, y1] on a 0 to 1000
/// grid over the whole screen) only that part is sent, at the display's own detail (Do It's zoom: small formulas become readable).
pub(crate) fn grab_screen_region(longest_edge: u32, region: Option<Vec<f64>>) -> Result<String, String> {
    grab_screen_region_at(longest_edge, region, None)
}

/// The monitor whose top-left corner is at `origin` (physical pixels), or the primary one. Lets Do It see the
/// display its target window is on, not just the primary.
fn grab_monitor(origin: Option<(i32, i32)>) -> Result<xcap::Monitor, String> {
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    if let Some((x, y)) = origin {
        if let Some(m) = monitors.iter().find(|m| m.x().unwrap_or(i32::MIN) == x && m.y().unwrap_or(i32::MIN) == y) {
            return Ok(m.clone());
        }
    }
    monitors.into_iter().find(|m| m.is_primary().unwrap_or(false)).ok_or("no primary monitor".into())
}

/// A tiny 32x32 luma signature of the monitor at `origin` (or the primary), for Do It's "did the screen change?" check.
pub(crate) fn grab_signature(origin: Option<(i32, i32)>) -> Result<Vec<u8>, String> {
    let rgba = grab_monitor(origin)?.capture_image().map_err(|e| e.to_string())?;
    let small = image::imageops::resize(&image::DynamicImage::ImageRgba8(rgba).to_luma8(), 32, 32, image::imageops::FilterType::Triangle);
    Ok(small.into_raw())
}

pub(crate) fn grab_screen_region_at(longest_edge: u32, region: Option<Vec<f64>>, origin: Option<(i32, i32)>) -> Result<String, String> {
    let monitor = grab_monitor(origin)?;
    let rgba = monitor.capture_image().map_err(|e| e.to_string())?;
    let (w, h) = (rgba.width(), rgba.height());
    let mut dynamic = image::DynamicImage::ImageRgba8(rgba);
    if let Some(r) = region.as_ref().filter(|r| r.len() == 4 && r.iter().all(|v| v.is_finite())) {
        let cl = |v: f64| v.clamp(0.0, 1000.0) / 1000.0;
        let (x0, x1) = (cl(r[0].min(r[2])), cl(r[0].max(r[2])));
        let (y0, y1) = (cl(r[1].min(r[3])), cl(r[1].max(r[3])));
        let px = (x0 * w as f64) as u32;
        let py = (y0 * h as f64) as u32;
        let pw = (((x1 - x0) * w as f64) as u32).max(8).min(w - px.min(w - 1));
        let ph = (((y1 - y0) * h as f64) as u32).max(8).min(h - py.min(h - 1));
        dynamic = dynamic.crop_imm(px.min(w - 1), py.min(h - 1), pw, ph);
    }
    let (w, h) = (dynamic.width(), dynamic.height());
    let longest = w.max(h);
    let resized = if longest > longest_edge {
        let f = longest_edge as f32 / longest as f32;
        dynamic.resize((w as f32 * f) as u32, (h as f32 * f) as u32, image::imageops::FilterType::Triangle)
    } else {
        dynamic
    };
    let mut buffer = std::io::Cursor::new(Vec::new());
    resized
        .to_rgb8()
        .write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 82))
        .map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(buffer.into_inner()))
}

// ---- apps, files, links -------------------------------------------------

#[tauri::command]
async fn installed_apps() -> Vec<apps::App> {
    tauri::async_runtime::spawn_blocking(apps::installed).await.unwrap_or_default()
}

#[tauri::command]
fn path_info(path: String) -> files::Hit {
    files::info(&path)
}

#[tauri::command]
async fn launch_app(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || apps::launch(&path)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if path.starts_with("shell:") {
        return apps::launch(&path);
    }
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    files::reveal(&path)
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let allowed = ["https://", "http://", "mailto:", "ms-settings:"];
    if !allowed.iter().any(|p| url.starts_with(p)) {
        return Err("That link can't be opened.".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

async fn pick(app: AppHandle, folder: bool, filter: Option<(&'static str, &'static [&'static str])>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    let mut dialog = app.dialog().file();
    if let Some((name, exts)) = filter {
        dialog = dialog.add_filter(name, exts);
    }
    if folder {
        dialog.pick_folder(move |p| {
            let _ = tx.send(p);
        });
    } else {
        dialog.pick_file(move |p| {
            let _ = tx.send(p);
        });
    }
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .map_err(|e| e.to_string())?;
    Ok(picked.map(|p| p.to_string()))
}

#[tauri::command]
async fn pick_app(app: AppHandle) -> Result<Option<apps::App>, String> {
    let filter: (&str, &[&str]) = if cfg!(windows) { ("Applications", &["exe", "lnk"]) } else { ("Applications", &["app"]) };
    Ok(pick(app, false, Some(filter)).await?.map(|path| {
        let name = std::path::Path::new(&path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        apps::App { name, path, icon: None }
    }))
}

#[tauri::command]
async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    pick(app, true, None).await
}

#[tauri::command]
async fn pick_file(app: AppHandle) -> Result<Option<String>, String> {
    pick(app, false, None).await
}

/// Where the page goes, in CSS pixels from the top-left of the notch's own web view (the empty area under the Browser tab's
/// address bar). The page is a separate window with no access to the app, laid exactly over that area, so it looks like part
/// of the notch; it is hidden when the notch closes or another tab opens.
#[derive(serde::Deserialize, Clone, Copy)]
struct BrowserRect { x: f64, y: f64, w: f64, h: f64 }

fn place_browser(app: &AppHandle, win: &tauri::WebviewWindow, r: BrowserRect) -> Result<(), String> {
    let notch = app.get_webview_window("notch").ok_or("no notch window")?;
    let pos = notch.inner_position().map_err(|e| e.to_string())?;
    let scale = notch.scale_factor().map_err(|e| e.to_string())?;
    let w = (r.w * scale).round().max(240.0) as u32;
    let h = (r.h * scale).round().max(160.0) as u32;
    win.set_size(tauri::PhysicalSize::new(w, h)).map_err(|e| e.to_string())?;
    win.set_position(tauri::PhysicalPosition::new(pos.x + (r.x * scale).round() as i32, pos.y + (r.y * scale).round() as i32)).map_err(|e| e.to_string())?;
    Ok(())
}

/// Opens a page. With `rect` it sits inside the notch (no frame, no taskbar button, over the notch's page area); without it,
/// in its own always-on-top window. Async on purpose: building a window inside a synchronous command deadlocks on Windows
/// (the notch freezes while the page's window is created).
#[tauri::command]
async fn open_browser(app: AppHandle, url: String, rect: Option<BrowserRect>) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(|_| "That doesn't look like a web address.")?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only web pages can be opened here.".into());
    }
    if let Some(existing) = app.get_webview_window("browser") {
        let _ = existing.set_decorations(rect.is_none());
        let _ = existing.set_skip_taskbar(rect.is_some());
        let _ = existing.set_always_on_top(true);
        if let Some(r) = rect { place_browser(&app, &existing, r)?; } else { let _ = existing.center(); }
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        let _ = existing.eval(&format!("location.href = {}", serde_json::to_string(&url).unwrap_or_default()));
        return Ok(());
    }
    let mut b = WebviewWindowBuilder::new(&app, "browser", WebviewUrl::External(parsed))
        .title("Notch Apple — Browser")
        .always_on_top(true);
    b = match rect {
        Some(r) => b.decorations(false).resizable(false).skip_taskbar(true).shadow(false).inner_size(r.w.max(240.0), r.h.max(160.0)).visible(false),
        None => b.inner_size(1100.0, 760.0).center(),
    };
    let win = b.build().map_err(|e| e.to_string())?;
    if let Some(r) = rect {
        place_browser(&app, &win, r)?;
        let _ = win.show();
    }
    Ok(())
}

/// Moves the in-notch page to a new area (the notch grew, or the layout changed) and shows it if it was hidden.
#[tauri::command]
async fn browser_place(app: AppHandle, rect: BrowserRect) -> Result<(), String> {
    let win = app.get_webview_window("browser").ok_or("no page is open")?;
    place_browser(&app, &win, rect)?;
    let _ = win.show();
    Ok(())
}

/// Hides the page without closing it (another tab is showing, or the notch closed). Its place in the page is kept.
#[tauri::command]
async fn browser_hide(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("browser") { let _ = w.hide(); }
    Ok(())
}

/// Closes the page.
#[tauri::command]
async fn browser_close(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("browser") { let _ = w.close(); }
    Ok(())
}

/// Back, forward or reload in the page.
#[tauri::command]
async fn browser_nav(app: AppHandle, action: String) -> Result<(), String> {
    let js = match action.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        _ => return Err("unknown action".into()),
    };
    if let Some(w) = app.get_webview_window("browser") { let _ = w.eval(js); }
    Ok(())
}

/// Shows the lyrics overlay: a transparent, click-through window pinned to the left or right edge of the main
/// screen, vertically centred. Created the first time it is needed (see src/lyrics-overlay.html).
#[tauri::command]
async fn lyrics_overlay_show(app: AppHandle, side: String) -> Result<(), String> {
    const W: f64 = 360.0;
    const H: f64 = 440.0;
    const MARGIN: f64 = 12.0;
    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| app.get_webview_window("notch").and_then(|w| w.current_monitor().ok().flatten()))
        .ok_or("no monitor")?;
    let scale = monitor.scale_factor();
    let screen = monitor.size().to_logical::<f64>(scale);
    let origin = monitor.position().to_logical::<f64>(scale);
    let x = if side == "right" { origin.x + screen.width - W - MARGIN } else { origin.x + MARGIN };
    let y = origin.y + (screen.height - H) / 2.0;

    let window = match app.get_webview_window("lyrics-overlay") {
        Some(existing) => existing,
        None => {
            let w = WebviewWindowBuilder::new(&app, "lyrics-overlay", WebviewUrl::App("lyrics-overlay.html".into()))
                .title("Notch Apple — Lyrics")
                .inner_size(W, H)
                .position(x, y)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .focused(false)
                .focusable(false)
                .visible_on_all_workspaces(true)
                .build()
                .map_err(|e| e.to_string())?;
            let _ = w.set_ignore_cursor_events(true);
            w
        }
    };
    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.show();
    Ok(())
}

/// Desktop widgets (Ultimate): one small window per widget ("widget-clock", "widget-todo", "widget-nowplaying"), sitting
/// at the bottom of the window stack so it never covers what the user is working on. It can be dragged (src/widget.html).
/// `x` and `y` are the saved position in logical pixels; without them the widget opens down the right edge of the main screen.
#[tauri::command]
async fn widget_show(app: AppHandle, kind: String, index: u32, x: Option<f64>, y: Option<f64>) -> Result<(), String> {
    let (w, h) = match kind.as_str() {
        "clock" => (190.0, 96.0),
        "todo" => (240.0, 170.0),
        "nowplaying" => (240.0, 84.0),
        _ => return Err("unknown widget".into()),
    };
    let label = format!("widget-{kind}");
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.show();
        return Ok(());
    }
    let monitor = app.primary_monitor().ok().flatten().ok_or("no monitor")?;
    let scale = monitor.scale_factor();
    let screen = monitor.size().to_logical::<f64>(scale);
    let origin = monitor.position().to_logical::<f64>(scale);
    let (px, py) = match (x, y) {
        (Some(x), Some(y)) if x >= origin.x - w + 60.0 && x <= origin.x + screen.width - 60.0 && y >= origin.y && y <= origin.y + screen.height - 40.0 => (x, y),
        _ => (origin.x + screen.width - w - 24.0, origin.y + 64.0 + (index as f64) * 190.0),
    };
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(format!("widget.html?kind={kind}").into()))
        .title("Notch Apple widget")
        .inner_size(w, h)
        .position(px, py)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_bottom(true)
        .skip_taskbar(true)
        .focused(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Closes one desktop widget (its switch went off, or Ultimate lapsed).
#[tauri::command]
fn widget_hide(app: AppHandle, kind: String) {
    if let Some(w) = app.get_webview_window(&format!("widget-{kind}")) {
        let _ = w.close();
    }
}

/// Closes the lyrics overlay (the switch went off, or Pro lapsed).
#[tauri::command]
fn lyrics_overlay_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window("lyrics-overlay") {
        let _ = w.close();
    }
}

/// The greeting: a transparent, click-through window at the top centre of the main screen that plays a mascot (or the
/// handwritten hello) across a drawing of the open notch (see src/mascot-greeting.html and js/mascots.js). It closes itself.
#[tauri::command]
async fn greeting_show(app: AppHandle, id: String, name: String, notch_height: f64) -> Result<(), String> {
    const W: f64 = 420.0;
    let notch_height = notch_height.clamp(20.0, 80.0);
    let h = notch_height + 112.0;
    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| app.get_webview_window("notch").and_then(|w| w.current_monitor().ok().flatten()))
        .ok_or("no monitor")?;
    let scale = monitor.scale_factor();
    let screen = monitor.size().to_logical::<f64>(scale);
    let origin = monitor.position().to_logical::<f64>(scale);
    if let Some(old) = app.get_webview_window("greeting") {
        let _ = old.close();
    }
    let params = serde_json::json!({ "id": id, "name": name, "notchHeight": notch_height, "width": W, "height": h });
    let window = WebviewWindowBuilder::new(&app, "greeting", WebviewUrl::App("mascot-greeting.html".into()))
        .title("Notch Apple: Hello")
        .inner_size(W, h)
        .position(origin.x + (screen.width - W) / 2.0, origin.y)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .visible_on_all_workspaces(true)
        .initialization_script(format!("window.NOTCH_MASCOT = {};", params))
        .build()
        .map_err(|e| e.to_string())?;
    let _ = window.set_ignore_cursor_events(true);
    // The animation lasts about 5 to 6 seconds (the handwriting a little longer); close the window after it, for sure.
    let handle = app.clone();
    let wait = if id == "hello" { 8 } else { 7 };
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
        if let Some(w) = handle.get_webview_window("greeting") {
            let _ = w.close();
        }
    });
    Ok(())
}

/// Closes the greeting window early (for example when the notch is hidden).
#[tauri::command]
fn greeting_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window("greeting") {
        let _ = w.close();
    }
}

// ---- automated UI check (CI) --------------------------------------------

/// Saves a screenshot of the notch window (CI only).
#[tauri::command]
async fn selftest_capture(name: String) -> Result<(), String> {
    let Some(dir) = std::env::var_os("NOTCH_SELFTEST_DIR") else { return Ok(()) };
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    tauri::async_runtime::spawn_blocking(move || {
        let windows = xcap::Window::all().map_err(|e| e.to_string())?;
        let ours = std::process::id();
        let target = windows
            .into_iter()
            .find(|w| w.pid().ok() == Some(ours) && w.title().map(|t| t == "Notch Apple").unwrap_or(false));
        let img = match target {
            Some(w) => w.capture_image().map_err(|e| e.to_string())?,
            // The window isn't listed on some machines (it is a tool window with no taskbar button): take the
            // whole screen instead. This only runs in CI, where NOTCH_SELFTEST_DIR is set.
            None => xcap::Monitor::all()
                .map_err(|e| e.to_string())?
                .into_iter()
                .next()
                .ok_or("no screen to capture")?
                .capture_image()
                .map_err(|e| e.to_string())?,
        };
        img.save(std::path::Path::new(&dir).join(format!("{safe}.png"))).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn selftest_finish(app: AppHandle, report: String) {
    if let Some(dir) = std::env::var_os("NOTCH_SELFTEST_DIR") {
        let _ = std::fs::write(std::path::Path::new(&dir).join("report.json"), report);
    }
    app.exit(0);
}

// ---- tray -----------------------------------------------------------------

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Notch Apple", true, Some("Ctrl+Alt+N"))?;
    let hide = MenuItem::with_id(app, "hide", "Show or hide the pill", true, Some("Ctrl+Alt+O"))?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let updates = MenuItem::with_id(app, "updates", "Check for updates…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Notch Apple", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &hide, &settings, &updates, &sep, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().ok_or(tauri::Error::InvalidIcon(std::io::Error::other("no icon")))?)
        .tooltip("Notch Apple — Ctrl+Alt+N")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => window::toggle(app),
            "hide" => window::toggle_hidden(app),
            "settings" | "updates" => {
                window::USER_HIDDEN.store(false, std::sync::atomic::Ordering::Relaxed);
                window::apply_visibility(app);
                let _ = app.emit("tray", event.id.as_ref().to_string());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                window::toggle(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Machines with 6 GB of memory or less (small laptops, virtual machines) get a leaner WebView2: Chromium's
/// low-end device mode (smaller caches, fewer raster threads) and a cap on each page's JavaScript heap.
/// Site isolation stays on, because the Browser tab opens real websites. A value already set in the
/// environment is left alone, so it can still be overridden.
fn lean_webview_on_small_machines() {
    if !cfg!(windows) || std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_some() {
        return;
    }
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    let gib = system.total_memory() as f64 / 1_073_741_824.0;
    if gib > 0.0 && gib <= 6.2 {
        // Includes the three features Tauri turns off by default, because the last --disable-features wins.
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --enable-low-end-device-mode --js-flags=--max-old-space-size=256",
        );
    }
}

fn main() {
    lean_webview_on_small_machines();
    tauri::Builder::default()
        .manage(bambu::Pool::default())
        .manage(bambucam::CamPool::default())
        // A second launch (e.g. clicking the Start menu entry again) opens the
        // existing notch instead of starting another one.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // `--open <tab>`, `--hide`, `--show` are for scripts (Ultimate); a plain second launch opens the notch.
            if args.iter().any(|a| a.starts_with("--")) {
                let _ = app.emit("second-instance", args);
            } else {
                window::toggle(app);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        on_shortcut(app, shortcut.id());
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            app_info, quit_app, notify, set_autostart, get_autostart, register_shortcuts,
            window::set_expanded, window::set_glass, window::set_layout, window::set_hidden, window::set_hide_in_fullscreen,
            net::http,
            friendsstore::friends_file_get, friendsstore::friends_file_set, friendsstore::friends_file_delete, friendsstore::friends_files_clear, friendsstore::friends_stage_file, friendsstore::friends_unstage,
            clip::clipboard_pause, clip::clipboard_copy_text, clip::clipboard_copy_image, clip::clipboard_forget,
            awake::set_keep_awake, awake::keep_awake_state,
            system_stats, top_processes, transliterate, capture_screen,
            installed_apps, path_info, launch_app, open_path, reveal_path, open_url,
            pick_app, pick_folder, pick_file, open_browser, browser_place, browser_hide, browser_close, browser_nav, lyrics_overlay_show, lyrics_overlay_hide, widget_show, widget_hide, greeting_show, greeting_hide, privategame::private_game_save, privategame::private_game_open, privategame::private_game_remove,
            index::search_files, index::set_search_folders, index::search_status,
            icons::icons,
            watch::screen_time, watch::set_edge_trigger, watch::privacy_now, watch::foreground_now, watch::minimize_external,
            winmgmt::snap_window, winmgmt::tile_windows,
            media::media_now, media::media_control,
            audio::audio_state, audio::audio_set,
            hello::hello_available, hello::hello_verify,
            input::paste_text, input::paste_now, input::dictate,
            klick::klick_set,
            doit::doit_screen, doit::doit_click, doit::doit_type, doit::doit_key, doit::doit_scroll, doit::doit_drag, doit::doit_sleep, doit::doit_arm, doit::doit_capture,
            doit::doit_tree, doit::doit_element, doit::doit_menu, doit::doit_target, doit::doit_focus_app, doit::doit_signature,
            convert::convert_tools,
            convert::convert_read,
            convert::convert_write,
            convert::convert_target,
            convert::convert_run,
            convert::convert_pick,
            convert::convert_temp_dir,
            plugins::plugins_list, plugins::plugins_dir, plugins::plugin_run, plugins::run_command,
            update::update_check, update::update_install, update::update_attempt_result, update::update_run_installer,
            extras::downloads_progress, extras::save_temp_file, extras::save_file_as, extras::read_file_base64,
            bambu::bambu_start, bambu::bambu_stop, bambu::bambu_running, bambu::bambu_trust_new, bambu::bambu_cloud_save, bambu::bambu_cloud_status, bambu::bambu_cloud_get, bambucam::bambu_camera_start, bambucam::bambu_camera_stop, bambu::bambu_cloud_clear,
        claude_usage::claude_usage,
        brightness::brightness_state,
        notifications::notifications_recent,
        pairdrop::pd_start, pairdrop::pd_stop, pairdrop::pd_state, pairdrop::pd_set_username, pairdrop::pd_regenerate_code,
        pairdrop::pd_send, pairdrop::pd_chat_start, pairdrop::pd_chat_send, pairdrop::pd_chat_read, pairdrop::pd_chat_close,
            selftest_capture, selftest_finish,
        ])
        .on_window_event(|window, event| {
            if window.label() != "notch" {
                return;
            }
            // Clicking anywhere else closes the panel, like the Mac notch.
            if let WindowEvent::Focused(false) = event {
                let _ = window.emit("notch-blur", ());
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            window::place(&handle)?;
            build_tray(app)?;

            // Safety net: if the page never gets to apply its layout, show the notch anyway after a few seconds.
            let late = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                let again = late.clone();
                let _ = late.run_on_main_thread(move || window::reveal(&again));
            });

            clip::start(handle.clone());
            watch::start(handle.clone());
            media::start(handle.clone());
            index::start();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Notch Apple");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_real_system_stats() {
        let mut m = system::Monitor::new();
        let _ = m.read(); // first read has no baseline for rates
        std::thread::sleep(std::time::Duration::from_millis(600));
        let s = m.read();
        assert!(s.ram_total > 0, "no total memory");
        assert!(s.ram_used > 0 && s.ram_used <= s.ram_total, "ram_used out of range");
        assert!(s.cpu_cores > 0, "no cpu cores");
        assert!(s.disk_total > 0, "no disk");
        assert!(s.disk_free <= s.disk_total, "free > total");
        assert!(s.uptime_seconds > 0, "no uptime");
        let top = m.processes(5);
        assert!(!top.is_empty(), "no processes");
    }

    #[test]
    fn finds_installed_apps() {
        let apps = apps::installed();
        assert!(apps.len() > 5, "only found {} apps", apps.len());
        assert!(apps.iter().all(|a| !a.name.is_empty()), "an app had no name");
        assert!(!apps.iter().any(|a| a.name.to_lowercase().contains("uninstall")));
        println!("{} apps, first five: {:?}", apps.len(), apps.iter().take(5).map(|a| &a.name).collect::<Vec<_>>());
    }

    #[test]
    fn searches_files_and_ranks_them() {
        let hits = files::search("a", 10);
        assert!(hits.len() <= 10, "limit not respected");
        assert!(files::search("   ", 10).is_empty(), "blank query should find nothing");
        assert!(files::search("zzqqxx-not-a-real-file-9183", 10).is_empty(), "matched something impossible");
        assert_eq!(files::score("notes.txt", "notes.txt"), 300);
        assert_eq!(files::score("notes.txt", "not"), 200);
        assert_eq!(files::score("my notes.txt", "not"), 100);
        assert_eq!(files::score("denotes", "not"), 10);
        assert_eq!(files::score("abc", "xyz"), 0);
    }

    #[test]
    fn transliterates_non_latin_scripts() {
        let mandarin = transliterate("你好，你怎么样？".into());
        let hindi = transliterate("नमस्ते".into());
        let arabic = transliterate("صباح الخير".into());
        let english = transliterate("hello there".into());
        assert!(!mandarin.is_empty() && mandarin.is_ascii(), "mandarin: {mandarin:?}");
        assert!(!hindi.is_empty() && hindi.is_ascii(), "hindi: {hindi:?}");
        assert!(!arabic.is_empty() && arabic.is_ascii(), "arabic: {arabic:?}");
        assert!(english.is_empty(), "latin text should produce no pronunciation line");
    }

    #[test]
    fn path_info_reads_a_real_path() {
        let root = if cfg!(windows) { "C:\\" } else { "/" };
        assert!(files::info(root).is_dir, "root should be a directory");
    }

    // ---- real Windows only (run on the GitHub Windows runner) ----

    #[cfg(windows)]
    #[test]
    fn extracts_real_icons() {
        let icon = icons::icon_for(r"C:\Windows\System32\notepad.exe").expect("no icon for notepad");
        let png = base64::engine::general_purpose::STANDARD.decode(icon).expect("not base64");
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']), "not a PNG");
        let img = image::load_from_memory(&png).expect("unreadable PNG");
        assert!(img.width() >= 16, "icon too small: {}", img.width());
    }

    #[cfg(windows)]
    #[test]
    fn reads_friendly_app_names() {
        let name = watch::friendly_name(r"C:\Windows\explorer.exe");
        assert!(name.to_lowercase().contains("explorer"), "explorer.exe -> {name:?}");
    }

    #[cfg(windows)]
    #[test]
    fn lists_store_apps_too() {
        let apps = apps::installed();
        let store = apps.iter().filter(|a| a.path.starts_with("shell:AppsFolder")).count();
        println!("{} apps, {store} from Windows' app list", apps.len());
        // Windows Server (the CI machine) has no Store apps; real PCs do. Report, don't fail.
        assert!(apps.len() > 5, "too few apps");
        let calc = apps.iter().find(|a| a.name.to_lowercase().contains("calculator"));
        println!("calculator: {:?}", calc.map(|a| &a.path));
    }

    #[cfg(windows)]
    #[test]
    fn clipboard_round_trip() {
        clip::clipboard_copy_text("notch-apple-test-123".into()).expect("couldn't write");
        let text = arboard::Clipboard::new().unwrap().get_text().unwrap();
        assert_eq!(text, "notch-apple-test-123");
    }

    #[cfg(windows)]
    #[test]
    fn audio_and_media_do_not_crash() {
        // CI machines may have no sound card: this only checks nothing panics.
        let state = tauri::async_runtime::block_on(audio::audio_state());
        println!("audio available={} outputs={} apps={}", state.available, state.outputs.len(), state.apps.len());
        let privacy = watch::privacy_now();
        println!("mic={:?} camera={:?}", privacy.microphone, privacy.camera);
        let _ = hello::hello_available;
    }
}
