//! Updates, like the Mac app's: check this repository's GitHub releases for a
//! newer Windows build, then download the installer, check it is exactly the
//! file GitHub published (SHA-256), and run it.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

/// The website's latest.json (refreshed by every release). GitHub's API only allows 60 anonymous requests an hour per
/// address, which a shared network uses up, so the API is only the fallback.
const SITE_FILE: &str = "https://adityajaindxb.github.io/NotchApples/latest.json";
const DOWNLOADS: &str = "https://github.com/AdityaJainDXB/NotchApples/releases/download/";
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

#[derive(Deserialize)]
struct SiteFile {
    windows: Option<SiteWindows>,
}

#[derive(Deserialize)]
struct SiteWindows {
    version: String,
    notes: Option<String>,
    url: String,
    sha256: Option<String>,
    size: u64,
    page: String,
}

/// This project's installer on github.com and nothing else: https, the right host and path, no dot segments or encoded
/// tricks (a URL parser would quietly collapse `..` and send the request somewhere else), and a setup.exe at the end.
pub fn trusted_download(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    url.starts_with(DOWNLOADS)
        && url.ends_with("-setup.exe")
        && !lower.contains("..")
        && !lower.contains("%2e")
        && !lower.contains("%2f")
        && !url.contains('?')
        && !url.contains('#')
        && !url.contains('\\')
}

/// What latest.json says about Windows: `Some(None)` = readable and nothing newer, `Some(Some(update))` = a newer
/// build, `None` = unreadable or untrustworthy (use the API instead). The download must be this project's.
pub fn from_site(text: &str, current: &[u64]) -> Option<Option<Update>> {
    let file: SiteFile = serde_json::from_str(text).ok()?;
    let w = file.windows?;
    if !trusted_download(&w.url) || !w.page.starts_with("https://github.com/AdityaJainDXB/NotchApples/") || w.page.contains("..") {
        return None;
    }
    let v = version_of(&format!("win-v{}", w.version))?;
    if !newer(&v, current) {
        return Some(None);
    }
    Some(Some(Update { version: w.version, notes: w.notes.unwrap_or_default(), url: w.url, sha256: w.sha256, size: w.size, page: w.page }))
}

#[tauri::command]
pub async fn update_check() -> Result<Option<Update>, String> {
    let current = version_of(&format!("win-v{CURRENT}")).unwrap_or_default();
    if let Ok(res) = crate::net::client().get(SITE_FILE).header("Cache-Control", "no-cache").timeout(std::time::Duration::from_secs(15)).send().await {
        if res.status().is_success() {
            if let Ok(text) = res.text().await {
                if let Some(answer) = from_site(&text, &current) {
                    return Ok(answer);
                }
            }
        }
    }
    let res = crate::net::client()
        .get(RELEASES)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(crate::net::describe)?;
    if !res.status().is_success() {
        let code = res.status().as_u16();
        return Err(if code == 403 || code == 429 {
            "GitHub is limiting requests from this network for a while. Try again in an hour.".to_string()
        } else {
            format!("GitHub didn't answer ({code}).")
        });
    }
    let releases: Vec<Release> = res.json().await.map_err(|e| e.to_string())?;

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
pub async fn update_install(app: AppHandle, url: String, sha256: Option<String>, size: u64, version: Option<String>) -> Result<(), String> {
    if !trusted_download(&url) {
        return Err("That isn't a Notch Apple download.".into());
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
    // The installer must start only AFTER this app has really exited: while it still runs, the installer can't
    // replace notch-apple.exe ("Failed to kill Notch Apple" / "Error opening file for writing"). Closing a WebView2
    // app can take several seconds on a slow PC, so a fixed delay isn't enough. A small script waits until the
    // process is gone (with a hard stop after about 50 seconds), then runs the installer: /P shows only a progress
    // bar, /R starts the app again when it's done, and /UPDATE tells the installer this is an upgrade. The script writes
    // %TEMP%\\NotchApple-Update.log, and if the app is not running 15 seconds after the installer finishes (it failed, or
    // /R did nothing) it starts the app that was installed, so the notch always comes back.
    // Remember what was tried: the next start compares versions and says so if the update did not take (update_attempt_result).
    remember_attempt(&app, version.as_deref().unwrap_or(&version_from_url(&url)), &path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let script_path = std::env::temp_dir().join("NotchApple-Update.cmd");
        let script = update_script(&path.display().to_string(), &std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default());
        std::fs::write(&script_path, script).map_err(|e| format!("Couldn't prepare the installer: {e}"))?;
        // The helper must outlive this app. If the app was started inside a Windows "job" that ends with it (a launcher or a task),
        // the helper would be killed the moment the app quits, the installer would never run and nothing would reopen. So it asks to
        // break away from the job first; if the job does not allow that, it starts the ordinary way.
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        let started = std::process::Command::new("cmd.exe")
            .arg("/C")
            .arg(&script_path)
            // Not DETACHED_PROCESS: with it Windows ignores CREATE_NO_WINDOW and cmd.exe opens a visible terminal.
            .creation_flags(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB)
            .spawn();
        if started.is_err() {
            std::process::Command::new("cmd.exe")
                .arg("/C")
                .arg(&script_path)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| format!("Couldn't start the installer: {e}"))?;
        }
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new(&path).spawn().map_err(|e| format!("Couldn't start the installer: {e}"))?;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(250));
        handle.exit(0);
    });
    Ok(())
}

/// The little script that waits for the app to close, runs the installer, logs what happened and makes sure the app comes back.
#[allow(dead_code)]
pub fn update_script(installer: &str, exe: &str) -> String {
    format!(
            "@echo off\r\n\
             set /a tries=0\r\n\
             :wait\r\n\
             tasklist /fi \"imagename eq notch-apple.exe\" 2>nul | find /i \"notch-apple.exe\" >nul\r\n\
             if errorlevel 1 goto go\r\n\
             set /a tries+=1\r\n\
             if %tries% geq 40 taskkill /f /im notch-apple.exe >nul 2>&1\r\n\
             if %tries% geq 50 goto go\r\n\
             ping -n 2 127.0.0.1 >nul\r\n\
             goto wait\r\n\
             :go\r\n\
             ping -n 3 127.0.0.1 >nul\r\n\
             echo %date% %time% starting the installer (%~z0 bytes script) >> \"%TEMP%\\NotchApple-Update.log\"\r\n\
             if not exist \"{}\" echo %date% %time% THE INSTALLER FILE IS MISSING >> \"%TEMP%\\NotchApple-Update.log\"\r\n\
             \"{}\" /P /R /UPDATE\r\n\
             echo %date% %time% the installer finished with code %errorlevel% >> \"%TEMP%\\NotchApple-Update.log\"\r\n\
             ping -n 16 127.0.0.1 >nul\r\n\
             tasklist /fi \"imagename eq notch-apple.exe\" 2>nul | find /i \"notch-apple.exe\" >nul\r\n\
             if errorlevel 1 (echo %date% %time% the app did not start again, starting it >> \"%TEMP%\\NotchApple-Update.log\" & start \"\" \"{}\")\r\n",
        installer, installer, exe
    )
}

/// What an update attempt left behind, kept in the app's own folder until the next start decides how it went.
#[derive(Serialize, Deserialize, Clone)]
struct Attempt {
    from: String,
    to: String,
    installer: String,
    at: u64,
}

fn attempt_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    app.path().app_local_data_dir().ok().map(|d| d.join("update-attempt.json"))
}

/// "https://github.com/.../releases/download/win-v2.2.48/Notch.apple_2.2.48_x64-setup.exe" -> "2.2.48"
fn version_from_url(url: &str) -> String {
    url.split('/').rev().nth(1).and_then(|t| t.strip_prefix("win-v")).unwrap_or("").to_string()
}

fn remember_attempt(app: &AppHandle, to: &str, installer: &std::path::Path) {
    let Some(file) = attempt_file(app) else { return };
    let attempt = Attempt {
        from: CURRENT.to_string(),
        to: to.to_string(),
        installer: installer.display().to_string(),
        at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
    };
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = serde_json::to_string(&attempt).map(|t| std::fs::write(file, t));
}

#[derive(Serialize)]
pub struct AttemptResult {
    pub ok: bool,
    pub from: String,
    pub to: String,
    pub log: String,
    pub installer_saved: bool,
}

/// The last lines of the update helper's log (%TEMP%\NotchApple-Update.log), so a failed update can say why.
fn log_tail() -> String {
    let text = std::fs::read_to_string(std::env::temp_dir().join("NotchApple-Update.log")).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(12)..].join("\n")
}

/// Called at start-up. `None` = no update was tried. Otherwise `ok` says whether this version is now the one that was installed
/// (a finished attempt is forgotten); when it is not, the log says what happened and the saved installer can be run by hand.
#[tauri::command]
pub fn update_attempt_result(app: AppHandle) -> Option<AttemptResult> {
    let file = attempt_file(&app)?;
    let attempt: Attempt = serde_json::from_str(&std::fs::read_to_string(&file).ok()?).ok()?;
    let target = version_of(&format!("win-v{}", attempt.to)).unwrap_or_default();
    let current = version_of(&format!("win-v{CURRENT}")).unwrap_or_default();
    let ok = !target.is_empty() && !newer(&target, &current);
    if ok {
        let _ = std::fs::remove_file(&file);
    }
    Some(AttemptResult {
        ok,
        from: attempt.from,
        to: attempt.to,
        log: if ok { String::new() } else { log_tail() },
        installer_saved: std::env::temp_dir().join("NotchApple-Update-Setup.exe").exists(),
    })
}

/// Runs the saved installer the ordinary way (its own window, no hidden steps), for when the automatic update did not work.
/// Only the file this app downloaded and checked, in the temp folder, can be run.
#[tauri::command]
pub fn update_run_installer() -> Result<(), String> {
    let path = std::env::temp_dir().join("NotchApple-Update-Setup.exe");
    if !path.exists() {
        return Err("The installer isn't saved on this PC any more. Use Check now, then Install and restart.".into());
    }
    std::process::Command::new(&path).spawn().map(|_| ()).map_err(|e| format!("Couldn't start the installer: {e}"))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_update_script_runs_the_installer_logs_and_brings_the_app_back() {
        let sc = update_script("C:\\Temp\\Setup.exe", "C:\\Apps\\notch-apple.exe");
        assert!(sc.contains("\"C:\\Temp\\Setup.exe\" /P /R /UPDATE"));
        assert!(sc.contains("THE INSTALLER FILE IS MISSING"), "a missing installer is written down");
        assert!(sc.contains("NotchApple-Update.log"));
        assert!(sc.contains("start \"\" \"C:\\Apps\\notch-apple.exe\""));
        assert!(sc.find("/P /R /UPDATE").unwrap() < sc.find("start \"\"").unwrap(), "the app is only started again after the installer ran");
        assert!(sc.contains("taskkill /f /im notch-apple.exe"), "it still waits for the old app to be gone first");
    }

    #[test]
    fn the_version_comes_from_the_download_address() {
        assert_eq!(version_from_url("https://github.com/AdityaJainDXB/NotchApples/releases/download/win-v2.2.48/Notch.apple_2.2.48_x64-setup.exe"), "2.2.48");
        assert_eq!(version_from_url("https://example.com/x.exe"), "");
    }

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

#[cfg(test)]
mod site_tests {
    use super::*;

    const GOOD: &str = r#"{"version":"2.0.50","windows":{"version":"1.53.0","notes":"n","url":"https://github.com/AdityaJainDXB/NotchApples/releases/download/win-v1.53.0/Notch.apple_1.53.0_x64-setup.exe","sha256":"ab","size":10,"page":"https://github.com/AdityaJainDXB/NotchApples/releases/tag/win-v1.53.0"}}"#;

    #[test]
    fn a_newer_build_is_offered() {
        let u = from_site(GOOD, &[1, 52, 0]).unwrap().unwrap();
        assert_eq!(u.version, "1.53.0");
        assert_eq!(u.sha256.as_deref(), Some("ab"));
    }

    #[test]
    fn the_same_or_an_older_build_is_not() {
        assert!(from_site(GOOD, &[1, 53, 0]).unwrap().is_none());
        assert!(from_site(GOOD, &[1, 60, 0]).unwrap().is_none());
    }

    #[test]
    fn a_download_from_somewhere_else_is_refused() {
        let bad = GOOD.replace("github.com/AdityaJainDXB", "evil.example/AdityaJainDXB");
        assert!(from_site(&bad, &[1, 52, 0]).is_none());
        let dots = GOOD.replace("releases/download/win-v1.53.0/", "releases/download/../../../Other/repo/releases/download/x/");
        assert!(from_site(&dots, &[1, 52, 0]).is_none());
        assert!(!trusted_download("https://github.com/AdityaJainDXB/NotchApples/releases/download/win-v1.0.0/a-setup.exe?x=1"));
        assert!(from_site("not json", &[1, 52, 0]).is_none());
        assert!(from_site(r#"{"version":"2.0.50"}"#, &[1, 52, 0]).is_none());
    }
}
