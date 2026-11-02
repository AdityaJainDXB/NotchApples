// Messenger → Friends keeps three small files in the app's own data folder (…\Notch Apple\Friends\): the identity (friend code and
// private keys), the vault key, and the sealed history. Same idea as the Bambu sign-in file (bambu.rs): a file only this user's
// account can read, written atomically. This is NOT Windows Credential Manager or DPAPI; see the PR for why and what to do next.
// Only three fixed names are accepted, so the page cannot use this to read or write anything else.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const NAMES: [&str; 3] = ["identity", "vaultkey", "vault"];
const MAX_BYTES: usize = 32 * 1024 * 1024;

fn file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !NAMES.contains(&name) { return Err("Unknown Friends file.".into()); }
    let dir = app.path().app_data_dir().map_err(|e| format!("No private place for Friends: {e}"))?.join("Friends");
    std::fs::create_dir_all(&dir).map_err(|e| format!("No private place for Friends: {e}"))?;
    Ok(dir.join(format!("{name}.bin")))
}

pub fn write_atomic(path: &PathBuf, text: &str) -> Result<(), String> {
    if text.len() > MAX_BYTES { return Err("Too much data.".into()); }
    let tmp = path.with_extension("bin.tmp");
    let done = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut o = std::fs::OpenOptions::new();
        o.write(true).create(true).truncate(true);
        #[cfg(unix)]
        { use std::os::unix::fs::OpenOptionsExt; o.mode(0o600); }
        o.open(&tmp)?.write_all(text.as_bytes())?;
        std::fs::rename(&tmp, path)
    })();
    if let Err(e) = done { let _ = std::fs::remove_file(&tmp); return Err(e.to_string()); }
    Ok(())
}

/// The saved text, or null when there is none yet.
#[tauri::command]
pub fn friends_file_get(app: AppHandle, name: String) -> Result<Option<String>, String> {
    match std::fs::read_to_string(file(&app, &name)?) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("couldn’t read the saved Friends data: {e}")),
    }
}

#[tauri::command]
pub fn friends_file_set(app: AppHandle, name: String, text: String) -> Result<(), String> {
    write_atomic(&file(&app, &name)?, &text)
}

#[tauri::command]
pub fn friends_file_delete(app: AppHandle, name: String) -> Result<(), String> {
    match std::fs::remove_file(file(&app, &name)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn writes_reads_and_replaces_atomically() {
        let dir = std::env::temp_dir().join(format!("notch-friends-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("vault.bin");
        write_atomic(&p, "one").unwrap();
        write_atomic(&p, "two").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "two");
        assert!(!dir.join("vault.bin.tmp").exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
