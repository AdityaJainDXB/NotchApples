//! Finding and launching installed applications.
//!
//! The Start menu is the source: its shortcut folders for desktop apps, plus
//! Windows' own app list (`Get-StartApps`) for Microsoft Store apps such as
//! Calculator or the Store version of Spotify, which have no shortcut file.
//! macOS (development builds) keeps apps in a few well-known folders.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use walkdir::WalkDir;

#[derive(Serialize, Clone)]
pub struct App {
    pub name: String,
    /// A file path, or `shell:AppsFolder\<id>` for a Store app.
    pub path: String,
    /// Base64 PNG, when we have one. The UI asks for icons separately.
    pub icon: Option<String>,
}

#[cfg(windows)]
fn search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(program_data) = std::env::var("ProgramData") {
        roots.push(PathBuf::from(program_data).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        roots.push(PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    roots
}

#[cfg(windows)]
const APP_EXTENSIONS: &[&str] = &["lnk", "exe", "url"];

#[cfg(not(windows))]
fn search_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
        PathBuf::from("/Applications/Utilities"),
    ];
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        roots.push(home.join("Applications"));
    }
    roots
}

#[cfg(not(windows))]
const APP_EXTENSIONS: &[&str] = &["app"];

const NOISE: &[&str] = &["uninstall", "readme", "release notes", "help", "website", "documentation", "license", "manual"];

fn is_noise(name: &str) -> bool {
    let lower = name.to_lowercase();
    NOISE.iter().any(|w| lower.contains(w))
}

fn shortcuts() -> Vec<App> {
    let mut found = Vec::new();
    for root in search_roots() {
        if !root.exists() {
            continue;
        }
        // Depth 4 covers "Programs/Vendor/Product/App.lnk" without walking the world.
        for entry in WalkDir::new(&root).max_depth(4).into_iter().filter_map(Result::ok) {
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if !APP_EXTENSIONS.contains(&ext.as_str()) {
                continue;
            }
            if ext == "app" && entry.depth() > 0 && is_inside_app_bundle(path) {
                continue;
            }
            let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            if name.is_empty() || name.starts_with('.') || is_noise(&name) {
                continue;
            }
            found.push(App { name, path: path.to_string_lossy().to_string(), icon: None });
        }
    }
    found
}

/// Store apps and everything else in the Start menu, from Windows itself.
#[cfg(windows)]
fn start_apps() -> Vec<App> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct Entry {
        name: Option<String>,
        #[serde(rename = "AppID")]
        app_id: Option<String>,
    }
    let mut cmd = std::process::Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress",
    ]);
    crate::plugins::hide_window(&mut cmd);
    let Ok(out) = crate::plugins::run_with_timeout(cmd, Duration::from_secs(20)) else { return Vec::new() };
    let entries: Vec<Entry> = serde_json::from_str::<Vec<Entry>>(out.trim())
        .or_else(|_| serde_json::from_str::<Entry>(out.trim()).map(|e| vec![e]))
        .unwrap_or_default();
    entries
        .into_iter()
        .filter_map(|e| {
            let (name, id) = (e.name?, e.app_id?);
            // Desktop apps show up here by their exe path; the shortcut list has those.
            if id.contains('\\') || (id.contains(':') && !id.contains('!')) || is_noise(&name) {
                return None;
            }
            Some(App { name, path: format!("shell:AppsFolder\\{id}"), icon: None })
        })
        .collect()
}

#[cfg(not(windows))]
fn start_apps() -> Vec<App> {
    Vec::new()
}

static CACHE: Mutex<Option<(Instant, Vec<App>)>> = Mutex::new(None);

/// Every app we can find, sorted by name, without duplicates. Cached for 10 minutes.
pub fn installed() -> Vec<App> {
    if let Ok(guard) = CACHE.lock() {
        if let Some((at, apps)) = guard.as_ref() {
            if at.elapsed() < Duration::from_secs(600) {
                return apps.clone();
            }
        }
    }
    let mut found = shortcuts();
    let mut seen: std::collections::HashSet<String> = found.iter().map(|a| a.name.to_lowercase()).collect();
    for app in start_apps() {
        if seen.insert(app.name.to_lowercase()) {
            found.push(app);
        }
    }
    found.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    found.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some((Instant::now(), found.clone()));
    }
    found
}

/// Opens an app: a shortcut or exe directly, a Store app through the shell.
pub fn launch(path: &str) -> Result<(), String> {
    #[cfg(windows)]
    if path.starts_with("shell:AppsFolder\\") {
        let mut cmd = std::process::Command::new("explorer.exe");
        cmd.arg(path);
        return cmd.spawn().map(|_| ()).map_err(|e| e.to_string());
    }
    if !Path::new(path).exists() {
        return Err("That app isn't installed any more.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // "start" handles .lnk, .url and .exe the way double-clicking does.
        let mut cmd = std::process::Command::new("cmd.exe");
        cmd.raw_arg(format!("/C start \"\" \"{}\"", path.replace('"', "")));
        crate::plugins::hide_window(&mut cmd);
        cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("open").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

fn is_inside_app_bundle(path: &Path) -> bool {
    path.ancestors().skip(1).any(|p| {
        p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("app")).unwrap_or(false)
    })
}
