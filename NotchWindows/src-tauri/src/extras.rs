//! Smaller native helpers: downloads in progress, and saving a file the UI produced (a calendar event, a screenshot).

use base64::Engine;
use serde::Serialize;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

#[derive(Serialize)]
pub struct Download {
    pub name: String,
    pub size: u64,
}

fn downloads_dir() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    let dir = PathBuf::from(home).join("Downloads");
    dir.exists().then_some(dir)
}

/// Browsers write partial files (.crdownload, .part, …) while downloading.
#[tauri::command]
pub fn downloads_progress() -> Vec<Download> {
    let Some(dir) = downloads_dir() else { return Vec::new() };
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let partial = ["crdownload", "part", "partial", "download", "opdownload"];
    entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let ext = name.rsplit('.').next()?.to_lowercase();
            if !partial.contains(&ext.as_str()) {
                return None;
            }
            let meta = e.metadata().ok()?;
            // Ignore abandoned leftovers.
            let recent = meta.modified().ok().and_then(|m| SystemTime::now().duration_since(m).ok()).map(|d| d < Duration::from_secs(120)).unwrap_or(false);
            recent.then(|| Download { name, size: meta.len() })
        })
        .collect()
}

/// Saves base64 data as a file in the temp folder and returns its path.
#[tauri::command]
pub fn save_temp_file(name: String, base64: String) -> Result<String, String> {
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')).collect();
    if safe.is_empty() || safe.starts_with('.') {
        return Err("Bad file name.".into());
    }
    // This only ever holds data for another app to open (a calendar event, a picture): never a program or a script.
    let ext = safe.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if !matches!(ext.as_str(), "ics" | "ovpn" | "png" | "jpg" | "jpeg" | "gif" | "webp" | "json" | "txt" | "pdf") {
        return Err("That kind of file can't be saved here.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64).map_err(|e| e.to_string())?;
    let path = std::env::temp_dir().join("NotchApple").join(safe);
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Saves base64 data to a place the user picked (screenshots, voice notes).
#[tauri::command]
pub async fn save_file_as(app: tauri::AppHandle, name: String, base64: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().set_file_name(&name).save_file(move |p| {
        let _ = tx.send(p);
    });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten()).await.map_err(|e| e.to_string())?;
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[derive(Serialize)]
pub struct FileData {
    pub name: String,
    pub mime: String,
    pub data: String,
    pub size: u64,
}

/// Reads a file the user dropped or picked (AI attachments), up to 20 MB.
#[tauri::command]
pub async fn read_file_base64(path: String) -> Result<FileData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let meta = std::fs::metadata(p).map_err(|_| "That file can't be read.")?;
        if meta.is_dir() {
            return Err("That's a folder, not a file.".into());
        }
        if meta.len() > 20 * 1024 * 1024 {
            return Err("That file is larger than 20 MB.".into());
        }
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        let mime = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "pdf" => "application/pdf",
            "txt" | "md" | "csv" | "json" | "log" | "js" | "ts" | "py" | "rs" | "html" | "css" | "xml" | "yml" | "yaml" | "ini" => "text/plain",
            _ => "application/octet-stream",
        };
        let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
        Ok(FileData {
            name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            mime: mime.into(),
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
            size: meta.len(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
