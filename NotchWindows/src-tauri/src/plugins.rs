//! Plugins: your own notch widgets, in the same format as the Mac app.
//! Every script in the Plugins folder runs and its output shows as a card:
//!
//!   first line            → the card's headline
//!   other lines           → body text
//!   text | href=https:…   → a line you can click to open a link
//!   text | run=command    → a line you can click to run a command
//!
//! The refresh interval goes in the file name: weather.10m.ps1, cpu.5s.py,
//! news.1h.bat (default 5 minutes). Scripts are stopped after 10 seconds.

use serde::Serialize;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct Plugin {
    pub file: String,
    pub name: String,
    pub interval: u64,
}

const EXAMPLE: &str = r#"# An example Notch apple plugin. Edit it, or add your own scripts here.
# The ".1m" in the file name means it refreshes every minute.
Write-Output "Hello from PowerShell"
Write-Output ("It's " + (Get-Date -Format "dddd, HH:mm"))
Write-Output "Plugin guide | href=https://github.com/AdityaJainDXB/NotchApples/blob/main/docs/PLUGINS.md"
"#;

pub fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("Plugins");
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let _ = std::fs::write(dir.join("example.1m.ps1"), EXAMPLE);
    }
    Ok(dir)
}

/// "weather.10m.ps1" -> ("weather", 600)
fn parse_name(file: &str) -> (String, u64) {
    let parts: Vec<&str> = file.split('.').collect();
    let name = parts.first().copied().unwrap_or(file).replace(['-', '_'], " ");
    let interval = parts.iter().skip(1).find_map(|p| {
        let (num, unit) = p.split_at(p.len().saturating_sub(1));
        let n: u64 = num.parse().ok()?;
        Some(match unit {
            "s" => n.max(5),
            "m" => n * 60,
            "h" => n * 3600,
            "d" => n * 86_400,
            _ => return None,
        })
    });
    (name, interval.unwrap_or(300))
}

const RUNNABLE: &[&str] = &["ps1", "bat", "cmd", "py", "js", "exe", "sh"];

#[tauri::command]
pub fn plugins_list(app: AppHandle) -> Result<Vec<Plugin>, String> {
    let dir = dir(&app)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let file = entry.file_name().to_string_lossy().to_string();
        let ext = file.rsplit('.').next().unwrap_or("").to_lowercase();
        if file.starts_with('.') || !RUNNABLE.contains(&ext.as_str()) {
            continue;
        }
        let (name, interval) = parse_name(&file);
        out.push(Plugin { file, name, interval });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub fn plugins_dir(app: AppHandle) -> Result<String, String> {
    dir(&app).map(|d| d.to_string_lossy().to_string())
}

fn command_for(path: &std::path::Path) -> Command {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let p = path.as_os_str();
    let mut cmd = match ext.as_str() {
        "ps1" => {
            let mut c = Command::new("powershell.exe");
            c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]).arg(p);
            c
        }
        "bat" | "cmd" => {
            let mut c = Command::new("cmd.exe");
            c.arg("/C").arg(p);
            c
        }
        "py" => {
            let mut c = Command::new(if cfg!(windows) { "py" } else { "python3" });
            c.arg(p);
            c
        }
        "js" => {
            let mut c = Command::new("node");
            c.arg(p);
            c
        }
        "sh" => {
            let mut c = Command::new("sh");
            c.arg(p);
            c
        }
        _ => Command::new(p),
    };
    hide_window(&mut cmd);
    cmd
}

pub fn hide_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// Runs a command, giving up after `timeout`. Returns stdout (or stderr when stdout is empty).
pub fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<String, String> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't run it: {e}"))?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                return Err(format!("Stopped after {} seconds.", timeout.as_secs()));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(e.to_string()),
        }
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(if out.stdout.is_empty() { &out.stderr } else { &out.stdout }).to_string();
    Ok(text.chars().take(4000).collect())
}

#[tauri::command]
pub async fn plugin_run(app: AppHandle, file: String) -> Result<String, String> {
    let dir = dir(&app)?;
    let path = dir.join(&file);
    // Only scripts that are actually in the Plugins folder.
    if path.parent() != Some(dir.as_path()) || !path.exists() {
        return Err("That plugin isn't in the Plugins folder.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = command_for(&path);
        cmd.current_dir(&dir);
        run_with_timeout(cmd, Duration::from_secs(10))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A `run=` line from a plugin, or a custom Action.
#[tauri::command]
pub async fn run_command(command: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("cmd.exe");
            c.arg("/C").arg(&command);
            c
        } else {
            let mut c = Command::new("sh");
            c.arg("-c").arg(&command);
            c
        };
        hide_window(&mut cmd);
        run_with_timeout(cmd, Duration::from_secs(30))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::parse_name;

    #[test]
    fn reads_the_interval_from_the_file_name() {
        assert_eq!(parse_name("weather.10m.ps1"), ("weather".into(), 600));
        assert_eq!(parse_name("cpu.5s.py"), ("cpu".into(), 5));
        assert_eq!(parse_name("cpu.1s.py"), ("cpu".into(), 5)); // at least 5 s
        assert_eq!(parse_name("news.1h.bat"), ("news".into(), 3600));
        assert_eq!(parse_name("plain.ps1"), ("plain".into(), 300));
        assert_eq!(parse_name("my-stats.2d.js"), ("my stats".into(), 172_800));
    }
}
