// Notch apple for Windows — the native side.
//
// The window is borderless, transparent and always on top, pinned to the top of
// the primary screen. Collapsed it is a slim pill; opening it grows the window
// downward, which is how the Mac notch behaves. Everything the web UI can't do
// on its own (system APIs, background watchers, web requests without CORS)
// lives in the modules below.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod apps;
mod audio;
mod awake;
mod clip;
mod extras;
mod files;
mod hello;
mod icons;
mod index;
mod input;
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
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .ok_or("no primary monitor")?;
    let rgba = monitor.capture_image().map_err(|e| e.to_string())?;
    let (w, h) = (rgba.width(), rgba.height());
    let dynamic = image::DynamicImage::ImageRgba8(rgba);
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

/// Opens a page in a separate always-on-top browser window. The notch panel is
/// too short to read a web page in.
#[tauri::command]
fn open_browser(app: AppHandle, url: String) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(|_| "That doesn't look like a web address.")?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only web pages can be opened here.".into());
    }
    if let Some(existing) = app.get_webview_window("browser") {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        let _ = existing.eval(&format!("location.href = {}", serde_json::to_string(&url).unwrap_or_default()));
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
            .find(|w| w.pid().ok() == Some(ours) && w.title().map(|t| t == "Notch apple").unwrap_or(false))
            .ok_or("notch window not found")?;
        let img = target.capture_image().map_err(|e| e.to_string())?;
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
    let open = MenuItem::with_id(app, "open", "Open Notch apple", true, Some("Ctrl+Alt+N"))?;
    let hide = MenuItem::with_id(app, "hide", "Show or hide the pill", true, Some("Ctrl+Alt+O"))?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let updates = MenuItem::with_id(app, "updates", "Check for updates…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Notch apple", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &hide, &settings, &updates, &sep, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().ok_or(tauri::Error::InvalidIcon(std::io::Error::other("no icon")))?)
        .tooltip("Notch apple — Ctrl+Alt+N")
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
            clip::clipboard_pause, clip::clipboard_copy_text, clip::clipboard_copy_image, clip::clipboard_forget,
            awake::set_keep_awake, awake::keep_awake_state,
            system_stats, top_processes, transliterate, capture_screen,
            installed_apps, path_info, launch_app, open_path, reveal_path, open_url,
            pick_app, pick_folder, pick_file, open_browser,
            index::search_files, index::set_search_folders, index::search_status,
            icons::icons,
            watch::screen_time, watch::set_edge_trigger, watch::privacy_now, watch::foreground_now, watch::minimize_external,
            winmgmt::snap_window, winmgmt::tile_windows,
            media::media_now, media::media_control,
            audio::audio_state, audio::audio_set,
            hello::hello_available, hello::hello_verify,
            input::paste_text, input::paste_now, input::dictate,
            plugins::plugins_list, plugins::plugins_dir, plugins::plugin_run, plugins::run_command,
            update::update_check, update::update_install,
            extras::downloads_progress, extras::save_temp_file, extras::save_file_as, extras::read_file_base64,
            extras::vpn_status, extras::vpn_connect, extras::vpn_disconnect,
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

            clip::start(handle.clone());
            watch::start(handle.clone());
            media::start(handle.clone());
            index::start();
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
