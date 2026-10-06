//! Updates, like the Mac app's: check this repository's GitHub releases for a
//! newer Windows build, then download the installer, check it is exactly the
//! file GitHub published (SHA-256), and run it.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

const RELEASES: &str = "https://api.github.com/repos/AdityaJainDXB/NotchApples/releases?per_page=40";
pub const CURRENT: &str = env!("CARGO_PKG_VERSION");

#[derive(Serialize, Clone)]
pub struct Update {
    pub version: String,
    pub notes: String,
    pub url: String,
    pub sha256: Option<String>,
    pub size: u64,
    pub page: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    body: Option<String>,
    html_url: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

/// "win-v1.24.3-sports" -> [1, 24, 3]
pub fn version_of(tag: &str) -> Option<Vec<u64>> {
    let rest = tag.strip_prefix("win-v")?;
    let numbers: Vec<u64> = rest
        .split(|c: char| c == '.' || c == '-')
        .map_while(|p| p.parse::<u64>().ok())
        .collect();
    (numbers.len() >= 2).then_some(numbers)
}

pub fn newer(candidate: &[u64], current: &[u64]) -> bool {
    for i in 0..candidate.len().max(current.len()) {
        let (a, b) = (candidate.get(i).copied().unwrap_or(0), current.get(i).copied().unwrap_or(0));
        if a != b {
            return a > b;
        }
    }
    false
}

#[tauri::command]
pub async fn update_check() -> Result<Option<Update>, String> {
    let res = crate::net::client()
        .get(RELEASES)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(crate::net::describe)?;
    if !res.status().is_success() {
        return Err(format!("GitHub didn't answer ({}).", res.status().as_u16()));
    }
    let releases: Vec<Release> = res.json().await.map_err(|e| e.to_string())?;
    let current = version_of(&format!("win-v{CURRENT}")).unwrap_or_default();

    let best = releases
        .into_iter()
        .filter(|r| !r.draft)   // Windows builds are still marked BETA (pre-release), so those count too
        .filter_map(|r| version_of(&r.tag_name).map(|v| (v, r)))
        .filter(|(v, _)| newer(v, &current))
        .max_by(|(a, _), (b, _)| if newer(a, b) { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Less });

    let Some((v, release)) = best else { return Ok(None) };
    let Some(asset) = release.assets.iter().find(|a| a.name.ends_with("-setup.exe")) else { return Ok(None) };
    Ok(Some(Update {
        version: v.iter().map(|n| n.to_string()).collect::<Vec<_>>().join("."),
        notes: release.body.unwrap_or_default(),
        url: asset.browser_download_url.clone(),
        sha256: asset.digest.as_ref().and_then(|d| d.strip_prefix("sha256:").map(str::to_string)),
        size: asset.size,
        page: release.html_url,
    }))
}

#[tauri::command]
pub async fn update_install(app: AppHandle, url: String, sha256: Option<String>, size: u64) -> Result<(), String> {
    if !url.starts_with("https://github.com/AdityaJainDXB/NotchApples/releases/download/") {
        return Err("That isn't a Notch apple download.".into());
    }
    let path = std::env::temp_dir().join("NotchApple-Update-Setup.exe");
    let written = crate::net::download(&url, &path).await?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let ok = match &sha256 {
        Some(expected) => hex(&Sha256::digest(&bytes)).eq_ignore_ascii_case(expected),
        None => written == size,
    };
    if !ok {
        let _ = std::fs::remove_file(&path);
        return Err("The download didn't match the published file, so it wasn't installed. Try again.".into());
    }
    // /P shows only a progress bar (no wizard pages), /R starts the app again when it's done, and /UPDATE tells
    // the installer this is an upgrade, so it replaces the old version without asking.
    std::process::Command::new(&path)
        .args(["/P", "/R", "/UPDATE"])
        .spawn()
        .map_err(|e| format!("Couldn't start the installer: {e}"))?;
    // Quit so the installer can replace the app.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(700));
        handle.exit(0);
    });
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_versions_from_windows_tags() {
        assert_eq!(version_of("win-v1.24.0"), Some(vec![1, 24, 0]));
        assert_eq!(version_of("win-v1.14.5-sports"), Some(vec![1, 14, 5]));
        assert_eq!(version_of("v1.24.0"), None); // a Mac release
        assert_eq!(version_of("windows-latest"), None);
    }

    #[test]
    fn compares_versions() {
        assert!(newer(&[1, 25, 0], &[1, 24, 9]));
        assert!(newer(&[1, 24, 1], &[1, 24]));
        assert!(!newer(&[1, 24, 0], &[1, 24, 0]));
        assert!(!newer(&[1, 9, 9], &[1, 24, 0]));
    }
}
