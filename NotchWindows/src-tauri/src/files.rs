//! File search across the user's own folders.
//!
//! Windows Search is not reliably available (it can be switched off, and its
//! COM API needs a lot of plumbing), so this walks the folders people actually
//! keep things in and skips system and cache paths. Results are ranked so exact
//! and prefix matches come first, like the macOS Spotlight tab.

use serde::Serialize;
use std::path::PathBuf;
use walkdir::WalkDir;

#[derive(Serialize)]
pub struct Hit {
    pub name: String,
    pub path: String,
    pub parent: String,
    pub is_dir: bool,
    pub size: u64,
}

const SKIP: &[&str] = &[
    "node_modules", "AppData", "Library", ".git", "__pycache__", "venv", ".venv",
    "target", "build", "DerivedData", "Caches", "cache", "$RECYCLE.BIN",
    "Windows", "Program Files", "Program Files (x86)", "ProgramData",
];

fn roots() -> Vec<PathBuf> {
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

pub fn info(path: &str) -> Hit {
    let p = PathBuf::from(path);
    Hit {
        name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string()),
        path: path.to_string(),
        parent: p.parent().map(|x| x.to_string_lossy().to_string()).unwrap_or_default(),
        is_dir: p.is_dir(),
        size: p.metadata().map(|m| m.len()).unwrap_or(0),
    }
}
