//! PairDrop commands for the UI. The engine itself is in `pairdrop-core` (tested on its own, and against the Mac
//! app's code): file sharing and private chat on the local network, found over Bonjour.

use pairdrop_core::{Engine, Notice, Snapshot};
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager};

static ENGINE: OnceLock<Engine> = OnceLock::new();

fn engine(app: &AppHandle) -> &'static Engine {
    ENGINE.get_or_init(|| {
        let downloads = app.path().download_dir().unwrap_or_else(|_| std::env::temp_dir());
        let name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "This PC".into());
        let handle = app.clone();
        Engine::new(downloads, name, move |notice| match notice {
            Notice::Changed => {
                if let Some(e) = ENGINE.get() {
                    let _ = handle.emit("pairdrop", e.snapshot());
                }
            }
            Notice::Received { name, from } => {
                let _ = handle.emit("pairdrop-received", serde_json::json!({ "name": name, "from": from }));
            }
            Notice::Message { from, text } => {
                let _ = handle.emit("pairdrop-message", serde_json::json!({ "from": from, "text": text }));
            }
        })
    })
}

/// Starts listening and announcing this PC. Safe to call again.
#[tauri::command]
pub fn pd_start(app: AppHandle, username: Option<String>) -> Result<Snapshot, String> {
    let e = engine(&app);
    e.start(username.as_deref().unwrap_or(""))?;
    Ok(e.snapshot())
}

#[tauri::command]
pub fn pd_stop(app: AppHandle) -> Snapshot {
    let e = engine(&app);
    e.stop();
    e.snapshot()
}

#[tauri::command]
pub fn pd_state(app: AppHandle) -> Snapshot {
    engine(&app).snapshot()
}

#[tauri::command]
pub fn pd_set_username(app: AppHandle, name: String) -> Result<Snapshot, String> {
    let e = engine(&app);
    e.set_username(&name)?;
    Ok(e.snapshot())
}

#[tauri::command]
pub fn pd_regenerate_code(app: AppHandle) -> Snapshot {
    let e = engine(&app);
    e.regenerate_code();
    e.snapshot()
}

/// Sends files or folders to whichever nearby device is showing `code` (or to one chosen device).
#[tauri::command]
pub fn pd_send(app: AppHandle, paths: Vec<String>, code: String, peer: Option<String>) {
    engine(&app).send(paths.into_iter().map(PathBuf::from).collect(), &code, peer.as_deref());
}

#[tauri::command]
pub fn pd_chat_start(app: AppHandle, code: String, peer: Option<String>) {
    engine(&app).start_chat(&code, peer.as_deref());
}

#[tauri::command]
pub fn pd_chat_send(app: AppHandle, thread: String, text: String) {
    engine(&app).send_message(&thread, &text);
}

#[tauri::command]
pub fn pd_chat_read(app: AppHandle, thread: String) {
    engine(&app).mark_read(&thread);
}

#[tauri::command]
pub fn pd_chat_close(app: AppHandle, thread: String) {
    engine(&app).close_chat(&thread);
}
