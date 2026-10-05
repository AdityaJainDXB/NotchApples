//! Smaller native helpers: downloads in progress, the VPN (Windows' built-in
//! client), and saving a file the UI produced (a VPN profile, a screenshot).

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

// ---- VPN: Windows' own client, L2TP/IPsec with VPN Gate's published settings ----

const VPN_NAME: &str = "Notch apple VPN";

#[derive(Serialize)]
pub struct VpnStatus {
    pub connected: bool,
    pub server: Option<String>,
}

fn powershell(script: &str) -> Result<String, String> {
    let mut cmd = std::process::Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    crate::plugins::hide_window(&mut cmd);
    crate::plugins::run_with_timeout(cmd, Duration::from_secs(45))
}

fn rasdial(args: &[&str]) -> Result<String, String> {
    let mut cmd = std::process::Command::new("rasdial.exe");
    cmd.args(args);
    crate::plugins::hide_window(&mut cmd);
    crate::plugins::run_with_timeout(cmd, Duration::from_secs(45))
}

#[tauri::command]
pub async fn vpn_status() -> VpnStatus {
    tauri::async_runtime::spawn_blocking(|| {
        if !cfg!(windows) {
            return VpnStatus { connected: false, server: None };
        }
        let out = rasdial(&[]).unwrap_or_default();
        VpnStatus { connected: out.contains(VPN_NAME), server: None }
    })
    .await
    .unwrap_or(VpnStatus { connected: false, server: None })
}

/// Creates (or updates) the VPN profile for this server and connects.
#[tauri::command]
pub async fn vpn_connect(server: String) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("The VPN uses Windows' built-in client.".into());
    }
    // Server is an IP address or host name: nothing else gets into the script.
    if server.is_empty() || !server.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
        return Err("That server address isn't valid.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let script = format!(
            "$ErrorActionPreference='Stop'; $n='{VPN_NAME}'; \
             if (Get-VpnConnection -Name $n -ErrorAction SilentlyContinue) {{ Remove-VpnConnection -Name $n -Force }}; \
             Add-VpnConnection -Name $n -ServerAddress '{server}' -TunnelType L2tp -L2tpPsk 'vpn' -AuthenticationMethod MSChapv2 -EncryptionLevel Optional -RememberCredential -Force -WarningAction SilentlyContinue; 'ok'"
        );
        let out = powershell(&script)?;
        if !out.contains("ok") {
            return Err(format!("Couldn't create the VPN profile: {}", out.trim()));
        }
        let dial = rasdial(&[VPN_NAME, "vpn", "vpn"])?;
        if dial.to_lowercase().contains("successfully connected") || dial.contains("Command completed successfully") {
            Ok(())
        } else {
            Err(format!("The server didn't accept the connection. Try another one. ({})", dial.lines().find(|l| l.contains("Error") || l.contains("error")).unwrap_or(dial.trim())))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vpn_disconnect() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| rasdial(&[VPN_NAME, "/disconnect"]).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}
