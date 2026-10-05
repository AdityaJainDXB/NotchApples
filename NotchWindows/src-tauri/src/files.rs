//! File search across the user's own folders.
//!
//! Windows Search is not reliably available (it can be switched off, and its
//! COM API needs a lot of plumbing), so this walks the folders people actually
//! keep things in and skips system and cache paths. Results are ranked so exact
//! and prefix matches come first, like the macOS Spotlight tab.

use serde::Serialize;
use std::path::PathBuf;
use walkdir::WalkDir;

#[derive(Serialize, Clone)]
pub struct Hit {
    pub name: String,
    pub path: String,
    pub parent: String,
    pub is_dir: bool,
    pub size: u64,
    /// "file", "folder" or "app".
    pub kind: String,
    /// Seconds since 1970, for "recent first" among equal matches.
    pub modified: u64,
}

pub const SKIP: &[&str] = &[
    "node_modules", "AppData", "Library", ".git", "__pycache__", "venv", ".venv",
    "target", "build", "DerivedData", "Caches", "cache", "$RECYCLE.BIN",
    "Windows", "Program Files", "Program Files (x86)", "ProgramData",
];

pub fn roots() -> Vec<PathBuf> {
    let home = match std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        Some(h) => PathBuf::from(h),
        None => return Vec::new(),
    };
    ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos", "OneDrive"]
        .iter()
        .map(|d| home.join(d))
        .filter(|p| p.exists())
        .collect()
}

/// Up to `limit` matches for `query`, best first.
pub fn search(query: &str, limit: usize) -> Vec<Hit> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }

    let mut scored: Vec<(i32, Hit)> = Vec::new();
    // A cap on files examined keeps a broad query from walking for ever.
    let mut examined = 0usize;

    'outer: for root in roots() {
        for entry in WalkDir::new(&root)
            .max_depth(6)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !name.starts_with('.') && !SKIP.iter().any(|s| name.eq_ignore_ascii_case(s))
            })
            .filter_map(Result::ok)
        {
            examined += 1;
            if examined > 120_000 {
                break 'outer;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let lower = name.to_lowercase();
            if !lower.contains(&needle) {
                continue;
            }

            let score = if lower == needle {
                300
            } else if lower.starts_with(&needle) {
                200
            } else if lower.split(|c: char| !c.is_alphanumeric()).any(|w| w.starts_with(&needle)) {
                100
            } else {
                10
            };

            let path = entry.path();
            let is_dir = entry.file_type().is_dir();
            scored.push((
                score,
                Hit {
                    name,
                    path: path.to_string_lossy().to_string(),
                    parent: path.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                    is_dir,
                    size: if is_dir { 0 } else { entry.metadata().map(|m| m.len()).unwrap_or(0) },
                    kind: if is_dir { "folder".into() } else { "file".into() },
                    modified: modified(&entry.metadata().ok()),
                },
            ));

            // Plenty of candidates: stop early and rank what we have.
            if scored.len() >= limit * 12 {
                break 'outer;
            }
        }
    }

    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.len().cmp(&b.1.name.len())));
    scored.into_iter().take(limit).map(|(_, hit)| hit).collect()
}

pub fn modified(meta: &Option<std::fs::Metadata>) -> u64 {
    meta.as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// How well `lower` (a lower-cased name) matches `needle`: higher is better, 0 is no match.
pub fn score(lower: &str, needle: &str) -> i32 {
    if lower == needle {
        300
    } else if lower.starts_with(needle) {
        200
    } else if lower.split(|c: char| !c.is_alphanumeric()).any(|w| w.starts_with(needle)) {
        100
    } else if lower.contains(needle) {
        10
    } else {
        0
    }
}

pub fn info(path: &str) -> Hit {
    let p = PathBuf::from(path);
    let meta = p.metadata().ok();
    let is_dir = p.is_dir();
    Hit {
        name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string()),
        path: path.to_string(),
        parent: p.parent().map(|x| x.to_string_lossy().to_string()).unwrap_or_default(),
        is_dir,
        size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
        kind: if is_dir { "folder".into() } else { "file".into() },
        modified: modified(&meta),
    }
}

/// Shows a file selected in Explorer (or Finder in development builds).
pub fn reveal(path: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", path.replace('"', "")))
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("open").args(["-R", path]).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}
