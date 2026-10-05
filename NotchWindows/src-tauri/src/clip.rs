//! Clipboard history, recorded in the background for as long as the app runs
//! (not only while the Clipboard tab is open).
//!
//! Text, images and copied files are reported to the UI as a `clipboard` event.
//! Anything a password manager marks as private (the standard Windows
//! "ExcludeClipboardContentFromMonitorProcessing" format) is never recorded.

use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub static PAUSED: AtomicBool = AtomicBool::new(false);
/// Set while we write to the clipboard ourselves, so copying an item back
/// doesn't count as a new copy.
pub static OWN_WRITE: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone, Default)]
pub struct Clip {
    pub kind: &'static str, // "text" | "image" | "files"
    pub text: Option<String>,
    /// Full-size PNG saved in the app's data folder.
    pub image: Option<String>,
    /// Small PNG preview, base64.
    pub thumb: Option<String>,
    pub files: Option<Vec<String>>,
    pub width: u32,
    pub height: u32,
}

pub fn clips_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("clipboard");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

pub fn start(app: AppHandle) {
    let _ = std::thread::Builder::new()
        .name("clipboard".into())
        .spawn(move || run(app));
}

fn run(app: AppHandle) {
    let mut board = loop {
        match arboard::Clipboard::new() {
            Ok(b) => break b,
            Err(_) => std::thread::sleep(Duration::from_secs(2)),
        }
    };
    // Start from whatever is on the clipboard now; only new copies are recorded.
    let mut last_seq = sequence();
    let mut last_text = board.get_text().ok();

    loop {
        std::thread::sleep(Duration::from_millis(450));
        let seq = sequence();
        if cfg!(windows) && seq == last_seq {
            continue;
        }
        if PAUSED.load(Ordering::Relaxed) || OWN_WRITE.swap(false, Ordering::Relaxed) {
            last_seq = seq;
            last_text = board.get_text().ok();
            continue;
        }
        if excluded() {
            last_seq = seq;
            continue;
        }

        match read(&mut board, &app, &last_text) {
            Read::Clip(clip) => {
                if clip.kind == "text" {
                    last_text = clip.text.clone();
                }
                last_seq = seq;
                let _ = app.emit("clipboard", clip);
            }
            Read::Nothing => last_seq = seq,
            // Another app has the clipboard open; try again on the next tick.
            Read::Busy => {}
        }
    }
}

enum Read {
    Clip(Clip),
    Nothing,
    Busy,
}

fn read(board: &mut arboard::Clipboard, app: &AppHandle, last_text: &Option<String>) -> Read {
    let busy = |e: &arboard::Error| matches!(e, arboard::Error::ClipboardOccupied);

    // Files copied in Explorer.
    match board.get().file_list() {
        Ok(files) if !files.is_empty() => {
            return Read::Clip(Clip {
                kind: "files",
                files: Some(files.iter().map(|p| p.to_string_lossy().to_string()).collect()),
                ..Default::default()
            })
        }
        Err(e) if busy(&e) => return Read::Busy,
        _ => {}
    }

    match board.get_text() {
        Ok(text) if !text.trim().is_empty() => {
            // Without sequence numbers (non-Windows builds) a repeat read isn't a new copy.
            if !cfg!(windows) && last_text.as_deref() == Some(text.as_str()) {
                return Read::Nothing;
            }
            let text: String = text.chars().take(100_000).collect();
            return Read::Clip(Clip { kind: "text", text: Some(text), ..Default::default() });
        }
        Err(e) if busy(&e) => return Read::Busy,
        _ => {}
    }

    match board.get_image() {
        Ok(img) => match save_image(app, img.width as u32, img.height as u32, &img.bytes) {
            Some(clip) => Read::Clip(clip),
            None => Read::Nothing,
        },
        Err(e) if busy(&e) => Read::Busy,
        Err(_) => Read::Nothing,
    }
}

fn save_image(app: &AppHandle, width: u32, height: u32, rgba: &[u8]) -> Option<Clip> {
    // Ignore absurd sizes rather than filling the disk.
    if width == 0 || height == 0 || (width as u64) * (height as u64) > 60_000_000 {
        return None;
    }
    let buffer = image::RgbaImage::from_raw(width, height, rgba.to_vec())?;
    let hash = hex(&Sha256::digest(rgba))[..24].to_string();
    let path = clips_dir(app)?.join(format!("{hash}.png"));
    if !path.exists() {
        buffer.save(&path).ok()?;
    }
    let thumb = image::DynamicImage::ImageRgba8(buffer).thumbnail(220, 140);
    let mut png = std::io::Cursor::new(Vec::new());
    thumb.write_to(&mut png, image::ImageFormat::Png).ok()?;
    Some(Clip {
        kind: "image",
        image: Some(path.to_string_lossy().to_string()),
        thumb: Some(base64::engine::general_purpose::STANDARD.encode(png.into_inner())),
        width,
        height,
        ..Default::default()
    })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(windows)]
fn sequence() -> u32 {
    unsafe { windows::Win32::System::DataExchange::GetClipboardSequenceNumber() }
}

#[cfg(not(windows))]
fn sequence() -> u32 {
    0
}

/// Password managers mark what they copy so clipboard histories skip it.
#[cfg(windows)]
fn excluded() -> bool {
    use windows::core::w;
    use windows::Win32::System::DataExchange::{IsClipboardFormatAvailable, RegisterClipboardFormatW};
    unsafe {
        [w!("ExcludeClipboardContentFromMonitorProcessing"), w!("Clipboard Viewer Ignore")]
            .iter()
            .any(|name| {
                let format = RegisterClipboardFormatW(*name);
                format != 0 && IsClipboardFormatAvailable(format).is_ok()
            })
    }
}

#[cfg(not(windows))]
fn excluded() -> bool {
    false
}

// ---- commands ----

#[tauri::command]
pub fn clipboard_pause(paused: bool) {
    PAUSED.store(paused, Ordering::Relaxed);
}

#[tauri::command]
pub fn clipboard_copy_text(text: String) -> Result<(), String> {
    OWN_WRITE.store(true, Ordering::Relaxed);
    arboard::Clipboard::new()
        .and_then(|mut b| b.set_text(text))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_copy_image(path: String) -> Result<(), String> {
    let img = image::open(&path).map_err(|_| "That image is no longer on this PC.")?.to_rgba8();
    let (w, h) = img.dimensions();
    OWN_WRITE.store(true, Ordering::Relaxed);
    arboard::Clipboard::new()
        .and_then(|mut b| {
            b.set_image(arboard::ImageData {
                width: w as usize,
                height: h as usize,
                bytes: std::borrow::Cow::Owned(img.into_raw()),
            })
        })
        .map_err(|e| e.to_string())
}

/// Deletes a saved clipboard image (when its history item is removed).
#[tauri::command]
pub fn clipboard_forget(app: AppHandle, path: String) {
    if let Some(dir) = clips_dir(&app) {
        let p = PathBuf::from(&path);
        // Only ever delete inside our own clipboard folder.
        if p.parent() == Some(dir.as_path()) {
            let _ = std::fs::remove_file(p);
        }
    }
}
