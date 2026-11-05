// Messenger → Friends keeps three small files in the app's own data folder (…\Notch Apple\Friends\): the identity (friend code and
// private keys), the vault key, and the sealed history. Same idea as the Bambu sign-in file (bambu.rs): a file only this user's
// account can read, written atomically. This is NOT Windows Credential Manager or DPAPI; see the PR for why and what to do next.
// Only three fixed names, plus `f-<64 hex characters>` (one sealed file that came with a message), are accepted, so the page
// cannot use this to read or write anything else.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const NAMES: [&str; 3] = ["identity", "vaultkey", "vault"];
const MAX_BYTES: usize = 32 * 1024 * 1024;

/// `f-` and the SHA-256 of a message id, as hex: the name of one received or sent file.
fn is_file_name(name: &str) -> bool {
    name.len() == 66 && name.starts_with("f-") && name[2..].bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !NAMES.contains(&name) && !is_file_name(name) { return Err("Unknown Friends file.".into()); }
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

/// Deletes every stored file that came with a message ("Delete all my chat data"). The identity, key and vault are not touched here.
#[tauri::command]
pub fn friends_files_clear(app: AppHandle) -> Result<(), String> {
    let dir = file(&app, "vault")?.parent().map(|p| p.to_path_buf()).ok_or("No private place for Friends.")?;
    for e in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let n = e.file_name().to_string_lossy().to_string();
        if n.starts_with("f-") && n.ends_with(".bin") && is_file_name(&n[..n.len() - 4]) { let _ = std::fs::remove_file(e.path()); }
    }
    Ok(())
}

/// A name that is safe to create on Windows: the last path component only, no characters Windows refuses, no trailing dots or
/// spaces, and not a device name such as CON. Nothing here is ever run or opened: the page only shows the file in Explorer.
pub fn safe_name(raw: &str) -> String {
    let last = raw.rsplit(|c| c == '/' || c == '\\').find(|p| !p.is_empty()).unwrap_or("");
    let mut s: String = last.chars().filter(|c| !c.is_control() && !"<>:\"|?*".contains(*c)).collect();
    s = s.trim().trim_end_matches(['.', ' ']).to_string();
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit());
    if s.is_empty() || s.starts_with('.') && s.trim_start_matches('.').is_empty() { s = "file".into(); }
    if reserved { s = format!("_{s}"); }
    s.chars().take(100).collect()
}

/// Writes a received file into a fresh folder in the temp directory and returns its path, so the page can show it in Explorer.
#[tauri::command]
pub fn friends_stage_file(name: String, base64: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64).map_err(|e| e.to_string())?;
    if bytes.len() > 2_000_000 { return Err("Too much data.".into()); }   // a received file is at most 2,000,000 bytes (it was 160,000 before 2.2.8)
    let mut tag = [0u8; 8];
    for (i, b) in std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0).to_le_bytes().iter().take(8).enumerate() { tag[i] = *b; }
    let dir = std::env::temp_dir().join("NotchApple").join("friends").join(tag.iter().map(|b| format!("{b:02x}")).collect::<String>());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(safe_name(&name));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_names_are_checked() {
        assert!(is_file_name(&format!("f-{}", "a".repeat(64))));
        assert!(!is_file_name("f-../../x") && !is_file_name("identity") && !is_file_name(&format!("f-{}", "A".repeat(64))));
    }
    #[test]
    fn staged_names_are_safe() {
        assert_eq!(safe_name("..\\..\\evil.exe"), "evil.exe");
        assert_eq!(safe_name("a/b/c.txt"), "c.txt");
        assert_eq!(safe_name("CON.txt"), "_CON.txt");
        assert_eq!(safe_name("a<b>:c?.txt"), "abc.txt");
        assert_eq!(safe_name(".."), "file");
        assert_eq!(safe_name("name. "), "name");
    }
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
