//! Notification peek (opt-in): reads the toast notifications Windows keeps in its own notification database
//! (`%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db`), read-only, so the newest can flash
//! beside the pill. Windows has no official way for a normal desktop app to do this (the notification
//! listener API needs a packaged app), so this reads the file the way the Mac app reads Notification
//! Center's, and may not work on every PC or Windows version. Nothing is stored or sent anywhere.

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq, Clone)]
pub struct Item {
    pub id: i64,
    pub app: String,
    pub title: String,
    pub body: String,
    /// Milliseconds since 1970 (UTC).
    pub at: i64,
}

#[derive(Serialize, Default)]
pub struct Recent {
    pub available: bool,
    /// Why it isn't available, in words for the user.
    pub reason: String,
    /// The newest notification id on this PC (the JS side starts from it, so old ones never flash).
    pub latest: i64,
    /// Notifications newer than the id asked for, oldest first.
    pub items: Vec<Item>,
}

/// Windows FILETIME (100 ns ticks since 1601) to milliseconds since 1970.
pub fn filetime_ms(ft: i64) -> i64 {
    ft / 10_000 - 11_644_473_600_000
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

/// The visible text of a toast: the first line is the title, the rest make the body.
/// Attribution lines ("via Chrome") are left out.
pub fn parse_toast(xml: &str) -> (String, String) {
    let mut texts: Vec<String> = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find("<text") {
        let after = &rest[i + 5..];
        if !matches!(after.chars().next(), Some('>') | Some(' ') | Some('/')) {
            rest = after;
            continue;
        }
        let Some(gt) = after.find('>') else { break };
        let attrs = &after[..gt];
        if attrs.ends_with('/') {
            rest = &after[gt + 1..];
            continue;
        }
        let inner = &after[gt + 1..];
        let Some(end) = inner.find("</text>") else { break };
        let text = unescape(inner[..end].trim());
        if !text.is_empty() && !attrs.contains("attribution") {
            texts.push(text);
        }
        rest = &inner[end + 7..];
    }
    let mut it = texts.into_iter();
    let title = it.next().unwrap_or_default();
    (title, it.collect::<Vec<_>>().join(" "))
}

/// A readable app name from Windows' app id: "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App" → "WhatsAppDesktop".
pub fn friendly_app(primary: &str) -> String {
    let mut s = primary.split('!').next().unwrap_or("");
    s = s.split('_').next().unwrap_or(s);
    s = s.rsplit(['\\', '/']).next().unwrap_or(s);
    let pick = s
        .split('.')
        .filter(|p| !p.is_empty() && !p.eq_ignore_ascii_case("exe") && !p.chars().all(|c| c.is_ascii_digit()))
        .last()
        .unwrap_or(s);
    pick.to_string()
}

#[tauri::command]
pub async fn notifications_recent(since: Option<i64>) -> Recent {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        return imp::recent(since);
        #[cfg(not(windows))]
        {
            let _ = since;
            Recent { reason: "Notification peek is Windows-only.".into(), ..Recent::default() }
        }
    })
    .await
    .unwrap_or_default()
}

#[cfg(windows)]
mod imp {
    use super::*;
    use rusqlite::{Connection, OpenFlags};
    use std::path::PathBuf;
    use std::time::Duration;

    fn db_path() -> Option<PathBuf> {
        let base = std::env::var_os("LOCALAPPDATA")?;
        Some(PathBuf::from(base).join(r"Microsoft\Windows\Notifications\wpndatabase.db"))
    }

    /// Opens the database read-only. If Windows has it locked, reads a copy of it (and its journal) instead.
    fn open(path: &PathBuf) -> Result<Connection, String> {
        let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        if let Ok(c) = Connection::open_with_flags(path, flags) {
            let _ = c.busy_timeout(Duration::from_millis(1500));
            if c.prepare("SELECT Id FROM Notification LIMIT 1").is_ok() {
                return Ok(c);
            }
        }
        let dir = std::env::temp_dir().join("notchapple-wpn");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let copy = dir.join("wpndatabase.db");
        std::fs::copy(path, &copy).map_err(|e| format!("Windows is using the notification list ({e})."))?;
        for ext in ["-wal", "-shm"] {
            let mut from = path.clone().into_os_string();
            from.push(ext);
            let mut to = copy.clone().into_os_string();
            to.push(ext);
            let _ = std::fs::copy(from, to);
        }
        Connection::open_with_flags(&copy, flags).map_err(|e| e.to_string())
    }

    pub fn recent(since: Option<i64>) -> Recent {
        let Some(path) = db_path().filter(|p| p.exists()) else {
            return Recent { reason: "Windows' notification list wasn't found on this PC.".into(), ..Recent::default() };
        };
        let conn = match open(&path) {
            Ok(c) => c,
            Err(e) => return Recent { reason: e, ..Recent::default() },
        };
        let out = read(&conn, since);
        drop(conn);
        // The fallback copy holds people's notifications: never leave it behind.
        let _ = std::fs::remove_dir_all(std::env::temp_dir().join("notchapple-wpn"));
        out
    }

    fn read(conn: &Connection, since: Option<i64>) -> Recent {
        let latest: i64 = match conn.query_row("SELECT COALESCE(MAX(Id), 0) FROM Notification", [], |r| r.get(0)) {
            Ok(v) => v,
            Err(_) => return Recent { reason: "This version of Windows keeps notifications in a way this can't read.".into(), ..Recent::default() },
        };
        let mut out = Recent { available: true, latest, ..Recent::default() };
        let Some(since) = since else { return out };   // the first call only learns where "now" is
        let sql = "SELECT n.Id, n.ArrivalTime, n.Payload, COALESCE(h.PrimaryId, '') \
                   FROM Notification n LEFT JOIN NotificationHandler h ON n.HandlerId = h.RecordId \
                   WHERE n.Id > ?1 AND n.Type = 'toast' ORDER BY n.Id ASC LIMIT 20";
        let Ok(mut stmt) = conn.prepare(sql) else { return out };
        let rows = stmt.query_map([since], |r| {
            // The toast XML is a blob on most PCs and text on some.
            let payload: Vec<u8> = match r.get_ref(2)? {
                rusqlite::types::ValueRef::Blob(b) | rusqlite::types::ValueRef::Text(b) => b.to_vec(),
                _ => Vec::new(),
            };
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1).unwrap_or(0), payload, r.get::<_, String>(3)?))
        });
        if let Ok(rows) = rows {
            for (id, arrived, payload, app) in rows.flatten() {
                let (title, body) = parse_toast(&String::from_utf8_lossy(&payload));
                if title.is_empty() && body.is_empty() {
                    continue;
                }
                out.items.push(Item { id, app: friendly_app(&app), title, body, at: filetime_ms(arrived) });
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_title_and_body_from_a_toast() {
        let xml = r#"<toast launch="x"><visual><binding template="ToastGeneric"><text hint-maxLines="1">Aditya</text><text>Are you free at 5? &amp; bring &quot;the file&quot;</text><text placement="attribution">via Chrome</text></binding></visual></toast>"#;
        assert_eq!(parse_toast(xml), ("Aditya".to_string(), "Are you free at 5? & bring \"the file\"".to_string()));
    }

    #[test]
    fn ignores_look_alike_tags_and_empty_text() {
        let xml = "<toast><binding><textBlock>no</textBlock><text/><text></text><text>Only this</text></binding></toast>";
        assert_eq!(parse_toast(xml), ("Only this".to_string(), String::new()));
        assert_eq!(parse_toast("not xml at all"), (String::new(), String::new()));
    }

    #[test]
    fn joins_extra_lines_into_the_body() {
        assert_eq!(parse_toast("<toast><text>A</text><text>one</text><text>two</text></toast>"), ("A".to_string(), "one two".to_string()));
    }

    #[test]
    fn makes_app_ids_readable() {
        assert_eq!(friendly_app("5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"), "WhatsAppDesktop");
        assert_eq!(friendly_app("Microsoft.Office.OUTLOOK.EXE.15"), "OUTLOOK");
        assert_eq!(friendly_app("Chrome"), "Chrome");
        assert_eq!(friendly_app(r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"), "powershell");
        assert_eq!(friendly_app(""), "");
    }

    #[test]
    fn converts_windows_file_times() {
        assert_eq!(filetime_ms(116_444_736_000_000_000), 0);                 // 1970-01-01
        assert_eq!(filetime_ms(116_444_736_000_000_000 + 10_000 * 1_500), 1_500);
    }
}
