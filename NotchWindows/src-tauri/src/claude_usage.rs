//! Claude Code usage (Ultimate): reads the conversation files Claude Code keeps in
//! `%USERPROFILE%\.claude\projects\**\*.jsonl` and returns one compact row per reply
//! (time, model and token counts), each reply once. The JS side adds them up (5-hour
//! window, today, this week). Nothing is sent anywhere.

use serde::Serialize;
use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use std::time::{Duration, SystemTime};

#[derive(Serialize, Debug, PartialEq)]
pub struct Entry {
    /// Milliseconds since 1970 (UTC).
    pub t: i64,
    pub m: String,
    pub i: u64,
    pub o: u64,
    pub cw: u64,
    pub cr: u64,
}

#[derive(Serialize)]
pub struct Usage {
    pub found: bool,
    pub entries: Vec<Entry>,
}

/// "2026-10-06T15:59:49.608Z" (or "+00:00") → milliseconds since 1970.
pub fn parse_iso(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || (b[10] != b'T' && b[10] != b' ') || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let num = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (num(0, 4)?, num(5, 7)?, num(8, 10)?, num(11, 13)?, num(14, 16)?, num(17, 19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 60 {
        return None;
    }
    // Days since 1970-01-01 (Howard Hinnant's civil-from-days, inverted).
    let yy = if mo <= 2 { y - 1 } else { y };
    let era = (if yy >= 0 { yy } else { yy - 399 }) / 400;
    let yoe = yy - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let mut ms = ((days * 24 + h) * 60 + mi) * 60 * 1000 + se * 1000;
    // Optional fraction.
    if b.get(19) == Some(&b'.') {
        let frac: String = s[20..].chars().take_while(|c| c.is_ascii_digit()).take(3).collect();
        if !frac.is_empty() {
            ms += format!("{frac:0<3}").parse::<i64>().ok()?;
        }
    }
    // A numeric offset (not used by Claude Code, but harmless to honour).
    if let Some(pos) = s[19..].find(|c: char| c == '+' || c == '-') {
        let off = &s[19 + pos + 1..];
        if off.len() >= 5 {
            let sign = if &s[19 + pos..19 + pos + 1] == "+" { 1 } else { -1 };
            let (oh, om) = (off.get(0..2)?.parse::<i64>().ok()?, off.get(3..5)?.parse::<i64>().ok()?);
            ms -= sign * (oh * 60 + om) * 60 * 1000;
        }
    }
    Some(ms)
}

/// One transcript line → (dedupe key, entry), or None if it isn't an assistant reply with usage.
pub fn parse_line(line: &str) -> Option<(Option<String>, Entry)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let message = v.get("message")?;
    let usage = message.get("usage")?;
    let t = parse_iso(v.get("timestamp")?.as_str()?)?;
    let n = |k: &str| usage.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
    let model = message.get("model").and_then(|m| m.as_str()).unwrap_or("unknown").to_string();
    let e = Entry { t, m: model, i: n("input_tokens"), o: n("output_tokens"), cw: n("cache_creation_input_tokens"), cr: n("cache_read_input_tokens") };
    if e.i + e.o + e.cw + e.cr == 0 || e.m == "<synthetic>" {
        return None;
    }
    let key = match (message.get("id").and_then(|x| x.as_str()), v.get("requestId").and_then(|x| x.as_str())) {
        (Some(a), Some(b)) => Some(format!("{a}:{b}")),
        _ => None,
    };
    Some((key, e))
}

fn scan(days: u64) -> Usage {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    let Some(home) = home else { return Usage { found: false, entries: vec![] } };
    let root = std::path::Path::new(&home).join(".claude").join("projects");
    if !root.is_dir() {
        return Usage { found: false, entries: vec![] };
    }
    let cutoff = SystemTime::now() - Duration::from_secs(days * 86400);
    let mut seen: HashSet<String> = HashSet::new();
    let mut entries = Vec::new();
    for f in walkdir::WalkDir::new(&root).into_iter().filter_map(Result::ok) {
        let p = f.path();
        if !f.file_type().is_file() || p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        // Files not touched in the last few days can't hold recent replies.
        if f.metadata().ok().and_then(|m| m.modified().ok()).map_or(true, |m| m < cutoff) {
            continue;
        }
        let Ok(file) = std::fs::File::open(p) else { continue };
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            if !line.contains("\"usage\"") {
                continue;
            }
            if let Some((key, e)) = parse_line(&line) {
                if let Some(k) = key {
                    if !seen.insert(k) {
                        continue;
                    }
                }
                entries.push(e);
            }
        }
    }
    Usage { found: true, entries }
}

#[tauri::command]
pub async fn claude_usage() -> Usage {
    tauri::async_runtime::spawn_blocking(|| scan(8)).await.unwrap_or(Usage { found: false, entries: vec![] })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_timestamps_with_and_without_fractions() {
        // 2026-10-06T15:59:49.608Z
        assert_eq!(parse_iso("2026-10-06T15:59:49.608Z"), Some(1_791_302_389_608));
        assert_eq!(parse_iso("2026-10-06T15:59:49Z"), Some(1_791_302_389_000));
        assert_eq!(parse_iso("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso("2000-03-01T00:00:00Z"), Some(951_868_800_000));
        assert_eq!(parse_iso("2026-10-06T15:59:49+02:00"), Some(1_791_302_389_000 - 2 * 3_600_000));
        assert_eq!(parse_iso("yesterday"), None);
        assert_eq!(parse_iso("2026-13-06T15:59:49Z"), None);
    }

    #[test]
    fn reads_an_assistant_reply() {
        let line = r#"{"type":"assistant","timestamp":"2026-10-06T10:15:30.250Z","requestId":"req_1","message":{"id":"msg_1","model":"claude-opus-5-5","usage":{"input_tokens":120,"output_tokens":80,"cache_creation_input_tokens":300,"cache_read_input_tokens":4000}}}"#;
        let (key, e) = parse_line(line).unwrap();
        assert_eq!(key.as_deref(), Some("msg_1:req_1"));
        assert_eq!((e.i, e.o, e.cw, e.cr), (120, 80, 300, 4000));
        assert_eq!(e.m, "claude-opus-5-5");
    }

    #[test]
    fn ignores_everything_else() {
        assert!(parse_line(r#"{"type":"user","timestamp":"2026-10-06T10:00:00Z","message":{"usage":{"input_tokens":5}}}"#).is_none());
        assert!(parse_line("not json").is_none());
        assert!(parse_line(r#"{"type":"assistant","timestamp":"2026-10-06T10:00:00Z","message":{"model":"x","usage":{}}}"#).is_none());
        assert!(parse_line(r#"{"type":"assistant","timestamp":"2026-10-06T10:00:00Z","message":{"model":"<synthetic>","usage":{"input_tokens":5}}}"#).is_none());
    }
}
