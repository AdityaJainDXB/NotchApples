// Notch apple for Windows — Tauri shell.
//
// The window is borderless, transparent and always on top, pinned to the top
// centre of the primary screen. Collapsed it is a slim pill; opening it grows
// the window downward, which is how the macOS notch behaves.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod apps;
mod files;
mod phonetic;
mod system;

use base64::Engine;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
};

const COLLAPSED: (f64, f64) = (240.0, 34.0);
const EXPANDED: (f64, f64) = (780.0, 450.0);

// ---- window placement ---------------------------------------------------

/// Resizes the notch and keeps it centred at the top of the screen it is on.
fn place(app: &AppHandle, expanded: bool) -> Result<(), String> {
    let window = app.get_webview_window("notch").ok_or("no notch window")?;
    let (w, h) = if expanded { EXPANDED } else { COLLAPSED };

    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or("no monitor")?;
    let scale = monitor.scale_factor();
    let screen = monitor.size().to_logical::<f64>(scale);
    let origin = monitor.position().to_logical::<f64>(scale);

    window.set_size(LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
    window
        .set_position(LogicalPosition::new(origin.x + (screen.width - w) / 2.0, origin.y))
        .map_err(|e| e.to_string())?;
    if expanded {
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn set_expanded(app: AppHandle, expanded: bool) -> Result<(), String> {
    place(&app, expanded)
}

#[tauri::command]
fn set_hidden(app: AppHandle, hidden: bool) -> Result<(), String> {
    let window = app.get_webview_window("notch").ok_or("no notch window")?;
    if hidden {
        window.hide().map_err(|e| e.to_string())
    } else {
        window.show().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ---- system -------------------------------------------------------------

#[tauri::command]
fn system_stats() -> system::Stats {
    let mut guard = system::MONITOR.lock().unwrap();
    guard.get_or_insert_with(system::Monitor::new).read()
}

#[tauri::command]
fn transliterate(text: String) -> String {
    phonetic::latin(&text)
}

/// A JPEG of the main screen, base64 encoded, with the notch window hidden
/// so the app never photographs itself.
#[tauri::command]
async fn capture_screen(app: AppHandle) -> Result<String, String> {
    let window = app.get_webview_window("notch");
    if let Some(w) = &window {
        let _ = w.hide();
    }
    let shot = tauri::async_runtime::spawn_blocking(|| {
        // Give the compositor a moment to actually remove the window from the screen.
        std::thread::sleep(std::time::Duration::from_millis(140));
        grab()
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Some(w) = &window {
        let _ = w.show();
    }
    shot
}

fn grab() -> Result<String, String> {
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .ok_or("no primary monitor")?;
    let rgba = monitor.capture_image().map_err(|e| e.to_string())?;

    // Scale the long edge down to 1568 px, the size the vision models expect.
    let (w, h) = (rgba.width(), rgba.height());
    let longest = w.max(h) as f32;
    let dynamic = image::DynamicImage::ImageRgba8(rgba);
    let resized = if longest > 1568.0 {
        let f = 1568.0 / longest;
        dynamic.resize((w as f32 * f) as u32, (h as f32 * f) as u32, image::imageops::FilterType::Triangle)
    } else {
        dynamic
    };

    let mut buffer = std::io::Cursor::new(Vec::new());
    resized
        .to_rgb8()
        .write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 80))
        .map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(buffer.into_inner()))
}

// ---- apps, files, links -------------------------------------------------

#[tauri::command]
async fn installed_apps() -> Vec<apps::App> {
    tauri::async_runtime::spawn_blocking(apps::installed).await.unwrap_or_default()
}

#[tauri::command]
async fn search_files(query: String, limit: Option<usize>) -> Vec<files::Hit> {
    let limit = limit.unwrap_or(30);
    tauri::async_runtime::spawn_blocking(move || files::search(&query, limit))
        .await
        .unwrap_or_default()
}

/// The clipboard read from the native side. The webview refuses `navigator.clipboard.readText()`
/// unless it has focus, which is not true while you are copying in another app.
#[tauri::command]
fn read_clipboard(app: AppHandle) -> Option<String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().read_text().ok().filter(|t| !t.is_empty())
}

#[tauri::command]
fn write_clipboard(app: AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
fn path_info(path: String) -> files::Hit {
    files::info(&path)
}

#[tauri::command]
fn launch_app(app: AppHandle, path: String) -> Result<(), String> {
    open_path(app, path)
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn pick_app(app: AppHandle) -> Result<Option<apps::App>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    let filter: (&str, &[&str]) = if cfg!(windows) {
        ("Applications", &["exe", "lnk"])
    } else {
        ("Applications", &["app"])
    };
    app.dialog()
        .file()
        .add_filter(filter.0, filter.1)
        .pick_file(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .map_err(|e| e.to_string())?;
    Ok(picked.map(|p| {
        let path = p.to_string();
        let name = std::path::Path::new(&path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        apps::App { name, path, icon: None }
    }))
}

/// Opens a page in a separate always-on-top browser window. The notch panel is
/// only ~450 px tall, which is too short to read a web page in.
#[tauri::command]
fn open_browser(app: AppHandle, url: String) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(|_| "That doesn't look like a web address.")?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only web pages can be opened here.".into());
    }
    if let Some(existing) = app.get_webview_window("browser") {
        let _ = existing.set_focus();
        let _ = existing.eval(&format!("location.href = {}", serde_json::to_string(&url).unwrap()));
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "browser", WebviewUrl::External(parsed))
        .title("Notch apple — Browser")
        .inner_size(1100.0, 760.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- keep awake ---------------------------------------------------------

#[cfg(windows)]
#[tauri::command]
fn set_keep_awake(on: bool) -> Result<(), String> {
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };
    let flags = if on {
        ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED
    } else {
        ES_CONTINUOUS
    };
    if unsafe { SetThreadExecutionState(flags) } == 0 {
        return Err("Windows refused the request.".into());
    }
    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
fn set_keep_awake(on: bool) -> Result<(), String> {
    use std::sync::Mutex;
    static CAFFEINATE: Mutex<Option<std::process::Child>> = Mutex::new(None);
    let mut guard = CAFFEINATE.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
    }
    if on {
        let child = std::process::Command::new("/usr/bin/caffeinate")
            .arg("-d")
            .spawn()
            .map_err(|e| e.to_string())?;
        *guard = Some(child);
    }
    Ok(())
}

// ---- app ----------------------------------------------------------------

fn toggle(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("notch") {
        if !window.is_visible().unwrap_or(true) {
            let _ = window.show();
        }
    }
    let _ = app.emit("toggle-notch", ());
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let keys = shortcut.into_string();
                    if keys.contains("KeyN") {
                        toggle(app);
                    } else if keys.contains("KeyO") {
                        if let Some(window) = app.get_webview_window("notch") {
                            let visible = window.is_visible().unwrap_or(true);
                            let _ = if visible { window.hide() } else { window.show() };
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            set_expanded, set_hidden, quit_app, system_stats, transliterate, capture_screen,
            installed_apps, search_files, path_info, launch_app, open_path, open_url,
            read_clipboard, write_clipboard,
            pick_app, open_browser, set_keep_awake,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            place(&handle, false)?;

            // Ctrl+Alt+N opens/closes, Ctrl+Alt+O hides. Windows reserves most
            // Win-key combinations, so Ctrl+Alt is the safe choice.
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                let gs = app.global_shortcut();
                let _ = gs.register(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN));
                let _ = gs.register(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyO));
            }

            let open_item = MenuItem::with_id(app, "open", "Open notch", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Notch apple", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Notch apple — Ctrl+Alt+N")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => toggle(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    use tauri::tray::{MouseButton, TrayIconEvent};
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        toggle(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Notch apple");
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
        println!(
            "ram {}/{} MB · cpu {:.0}% ({} cores) · disk {} / {} GB free · battery {:?} · up {}s",
            s.ram_used / 1_048_576, s.ram_total / 1_048_576, s.cpu_percent, s.cpu_cores,
            s.disk_free / 1_073_741_824, s.disk_total / 1_073_741_824, s.battery_percent, s.uptime_seconds
        );
    }

    #[test]
    fn finds_installed_apps() {
        let apps = apps::installed();
        assert!(apps.len() > 5, "only found {} apps", apps.len());
        assert!(apps.iter().all(|a| !a.name.is_empty()), "an app had no name");
        // Sorted and free of the obvious noise.
        assert!(!apps.iter().any(|a| a.name.to_lowercase().contains("uninstall")));
        println!("{} apps, first five: {:?}", apps.len(),
                 apps.iter().take(5).map(|a| &a.name).collect::<Vec<_>>());
    }

    #[test]
    fn searches_files_and_ranks_them() {
        let hits = files::search("a", 10);
        assert!(hits.len() <= 10, "limit not respected");
        let empty = files::search("   ", 10);
        assert!(empty.is_empty(), "blank query should find nothing");
        // A name that cannot exist anywhere.
        let none = files::search("zzqqxx-not-a-real-file-9183", 10);
        assert!(none.is_empty(), "matched something impossible");
        println!("'a' -> {} hits; first: {:?}", hits.len(), hits.first().map(|h| &h.name));
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
        println!("mandarin={mandarin:?} hindi={hindi:?} arabic={arabic:?}");
    }

    #[test]
    fn path_info_reads_a_real_path() {
        let info = files::info("/");
        assert!(info.is_dir, "root should be a directory");
    }
}
