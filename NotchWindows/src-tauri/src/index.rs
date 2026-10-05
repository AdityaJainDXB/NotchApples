//! A file index for Search, built in the background so results are instant.
//!
//! The old Search walked the disk on every keystroke. Now the user's folders
//! are indexed once at startup and refreshed every 10 minutes; a search scans
//! the in-memory list, plus installed apps. Until the first index is ready,
//! searches fall back to walking the disk.

use crate::files::{self, Hit};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;
use std::time::Duration;
use walkdir::WalkDir;

struct Entry {
    lower: String,
    hit: Hit,
}

static INDEX: RwLock<Vec<Entry>> = RwLock::new(Vec::new());
static READY: AtomicBool = AtomicBool::new(false);
static EXTRA: RwLock<Vec<PathBuf>> = RwLock::new(Vec::new());
const LIMIT: usize = 400_000;

pub fn start() {
    let _ = std::thread::Builder::new().name("index".into()).spawn(|| {
        // Warm the app list first, so the first search doesn't wait for it.
        let _ = crate::apps::installed();
        loop {
            build();
            std::thread::sleep(Duration::from_secs(600));
        }
    });
}

fn build() {
    let mut roots = files::roots();
    if let Ok(extra) = EXTRA.read() {
        roots.extend(extra.iter().filter(|p| p.exists()).cloned());
    }
    let mut entries = Vec::with_capacity(50_000);
    'outer: for root in roots {
        for entry in WalkDir::new(&root)
            .max_depth(8)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !name.starts_with('.') && !files::SKIP.iter().any(|s| name.eq_ignore_ascii_case(s))
            })
            .filter_map(Result::ok)
        {
            if entry.depth() == 0 {
                continue;
            }
            if entries.len() >= LIMIT {
                break 'outer;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            let is_dir = entry.file_type().is_dir();
            let meta = entry.metadata().ok();
            entries.push(Entry {
                lower: name.to_lowercase(),
                hit: Hit {
                    name,
                    path: path.to_string_lossy().to_string(),
                    parent: path.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                    is_dir,
                    size: if is_dir { 0 } else { meta.as_ref().map(|m| m.len()).unwrap_or(0) },
                    kind: if is_dir { "folder".into() } else { "file".into() },
                    modified: files::modified(&meta),
                },
            });
        }
    }
    if let Ok(mut index) = INDEX.write() {
        *index = entries;
    }
    READY.store(true, Ordering::Relaxed);
}

/// Up to `limit` matches, best first: apps, then files and folders.
pub fn search(query: &str, limit: usize) -> Vec<Hit> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }

    let mut scored: Vec<(i32, Hit)> = crate::apps::installed()
        .into_iter()
        .filter_map(|a| {
            let s = files::score(&a.name.to_lowercase(), &needle);
            (s > 0).then(|| {
                (
                    s + 50, // apps first among equal matches
                    Hit {
                        name: a.name,
                        path: a.path.clone(),
                        parent: "App".into(),
                        is_dir: false,
                        size: 0,
                        kind: "app".into(),
                        modified: 0,
                    },
                )
            })
        })
        .collect();

    if READY.load(Ordering::Relaxed) {
        if let Ok(index) = INDEX.read() {
            for e in index.iter() {
                let s = files::score(&e.lower, &needle);
                if s > 0 {
                    scored.push((s, e.hit.clone()));
                }
            }
        }
    } else {
        scored.extend(files::search(query, limit).into_iter().map(|h| (files::score(&h.name.to_lowercase(), &needle), h)));
    }

    scored.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| b.1.modified.cmp(&a.1.modified))
            .then_with(|| a.1.name.len().cmp(&b.1.name.len()))
    });
    scored.into_iter().take(limit).map(|(_, h)| h).collect()
}

#[tauri::command]
pub async fn search_files(query: String, limit: Option<usize>) -> Vec<Hit> {
    let limit = limit.unwrap_or(40).min(200);
    tauri::async_runtime::spawn_blocking(move || search(&query, limit)).await.unwrap_or_default()
}

/// Extra folders to index (Settings → Search), e.g. a second drive.
#[tauri::command]
pub fn set_search_folders(folders: Vec<String>) {
    if let Ok(mut extra) = EXTRA.write() {
        *extra = folders.into_iter().map(PathBuf::from).collect();
    }
    std::thread::spawn(build);
}

#[tauri::command]
pub fn search_status() -> (bool, usize) {
    (READY.load(Ordering::Relaxed), INDEX.read().map(|i| i.len()).unwrap_or(0))
}
