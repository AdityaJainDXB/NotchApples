//! Finding and launching installed applications.
//!
//! Windows has no single list of installed apps, so the Start Menu shortcuts
//! are the practical source — that is what the Start menu itself shows.
//! macOS keeps apps in a few well-known folders.

use serde::Serialize;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Serialize, Clone)]
pub struct App {
    pub name: String,
    pub path: String,
    /// Base64 PNG, when we can get one. The UI falls back to a generic icon.
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
const APP_EXTENSIONS: &[&str] = &["lnk", "exe"];

#[cfg(not(windows))]
fn search_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
        PathBuf::from("/Applications/Utilities"),
    ];
    if let Some(home) = dirs_home() {
        roots.push(home.join("Applications"));
    }
    roots
}

#[cfg(not(windows))]
const APP_EXTENSIONS: &[&str] = &["app"];

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

/// Every app we can find, sorted by name, de-duplicated by path.
pub fn installed() -> Vec<App> {
    let mut found: Vec<App> = Vec::new();
    let mut seen = std::collections::HashSet::new();

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
            // On macOS an .app is a folder; don't descend into it.
            if ext == "app" && entry.depth() > 0 && is_inside_app_bundle(path) {
                continue;
            }
            let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            if name.is_empty() || name.starts_with('.') {
                continue;
            }
            // Uninstallers and help links are noise in a launcher.
            let lower = name.to_lowercase();
            if ["uninstall", "readme", "release notes", "help", "website", "documentation"]
                .iter()
                .any(|w| lower.contains(w))
            {
                continue;
            }
            let key = path.to_string_lossy().to_string();
            if seen.insert(key.clone()) {
                found.push(App { name, path: key, icon: None });
            }
        }
    }

    found.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    found.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
    found
}

fn is_inside_app_bundle(path: &Path) -> bool {
    path.ancestors().skip(1).any(|p| {
        p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("app")).unwrap_or(false)
    })
}
