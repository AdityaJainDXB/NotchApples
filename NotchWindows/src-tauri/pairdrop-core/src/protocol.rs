//! The wire format and rules of PairDrop, identical to the Mac app's PairDropLogic.swift. No sockets in here.
//!
//! One TCP connection per file or message:
//!   sender   → [4-byte big-endian length][JSON header]
//!   receiver → 1 byte: 1 accept, 0 wrong code, 2 too many wrong codes (locked for a minute)
//!   sender   → the file's bytes (files only; chat text travels inside the header)
//!   receiver → 1 byte: 1 saved, 0 failed (files only)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};

pub const MAX_HEADER: usize = 64_000;
pub const MAX_MESSAGE: usize = 4_000;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    #[default]
    File,
    Hello,
    Message,
}

fn unknown() -> String {
    "Unknown".into()
}

/// Older versions only send code, fileName, size and sender; everything else is optional on the way in.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Header {
    #[serde(default)]
    pub kind: Kind,
    pub code: String,
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default = "unknown")]
    pub sender: String,
    /// The sender's own Bonjour service name, so a reply can find its way back.
    #[serde(default)]
    pub sender_service: String,
    /// For `hello`: the code the other side must put on its replies.
    #[serde(default)]
    pub reply_code: String,
    #[serde(default)]
    pub text: String,
}

impl Header {
    pub fn new(kind: Kind, code: &str, sender: &str) -> Self {
        Header { kind, code: code.into(), sender: sender.into(), ..Default::default() }
    }
}

/// Length-prefixed frame for a header, or None if it is too big to send.
pub fn encode(h: &Header) -> Option<Vec<u8>> {
    let json = serde_json::to_vec(h).ok()?;
    if json.len() > MAX_HEADER {
        return None;
    }
    let mut out = (json.len() as u32).to_be_bytes().to_vec();
    out.extend(json);
    Some(out)
}

/// The length in the first four bytes of a frame, or None if it is empty or too large to be believed.
pub fn frame_length(four: [u8; 4]) -> Option<usize> {
    let n = u32::from_be_bytes(four) as usize;
    (n > 0 && n <= MAX_HEADER).then_some(n)
}

pub fn decode(json: &[u8]) -> Option<Header> {
    serde_json::from_slice(json).ok()
}

pub fn is_valid_code(s: &str) -> bool {
    s.chars().count() == 6 && s.chars().all(|c| c.is_ascii_digit())
}

fn strip_controls(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).collect()
}

/// A name that can't point outside Downloads, hide as a dot file or be a reserved Windows name.
pub fn safe_file_name(raw: &str) -> String {
    let last = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let mut name: String = strip_controls(last)
        .chars()
        .map(|c| if matches!(c, ':' | '<' | '>' | '"' | '|' | '?' | '*') { '-' } else { c })
        .collect();
    name = name.trim().to_string();
    if let Some(rest) = name.strip_prefix('.') {
        name = format!("_{rest}");
    }
    if name.is_empty() || name == "_" {
        name = "file".into();
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3"];
    if reserved.contains(&stem.as_str()) {
        name = format!("_{name}");
    }
    name.chars().take(200).collect()
}

/// "photo.jpg", then "1-photo.jpg", "2-photo.jpg"... for the first one that is free.
pub fn unique_name(base: &str, exists: impl Fn(&str) -> bool) -> String {
    let mut candidate = base.to_string();
    let mut n = 1;
    while exists(&candidate) {
        candidate = format!("{n}-{base}");
        n += 1;
    }
    candidate
}

/// The name shown to the other person: trimmed, no control characters, at most 32 characters.
pub fn display_name(raw: &str, fallback: &str) -> String {
    let cleaned = strip_controls(raw);
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned.chars().take(32).collect()
    }
}

pub fn clamp_message(s: &str) -> String {
    s.trim().chars().take(MAX_MESSAGE).collect()
}

/// A chat with one device: what this side puts on messages it sends, and what it expects on the ones it receives.
#[derive(Clone, Debug, PartialEq)]
pub struct Session {
    pub peer_service: String,
    pub peer_name: String,
    pub send_code: String,
    pub expect_code: String,
}

/// Who may send a message: a device that already started a chat and quotes the code agreed for it.
pub fn authorised(h: &Header, sessions: &HashMap<String, Session>) -> bool {
    h.kind == Kind::Message
        && !h.sender_service.is_empty()
        && sessions.get(&h.sender_service).map_or(false, |s| h.code == s.expect_code)
}

/// Stops anyone on the Wi-Fi guessing the six digits: five wrong codes in a minute locks it for a minute.
#[derive(Debug, Clone)]
pub struct AttemptLimiter {
    pub max_failures: usize,
    pub window: Duration,
    pub lock_for: Duration,
    failures: Vec<Instant>,
    locked_until: Option<Instant>,
}

impl Default for AttemptLimiter {
    fn default() -> Self {
        AttemptLimiter { max_failures: 5, window: Duration::from_secs(60), lock_for: Duration::from_secs(60), failures: vec![], locked_until: None }
    }
}

impl AttemptLimiter {
    pub fn is_locked(&self, now: Instant) -> bool {
        self.locked_until.map_or(false, |t| t > now)
    }
    pub fn record_failure(&mut self, now: Instant) {
        let window = self.window;
        self.failures.retain(|t| now.duration_since(*t) < window);
        self.failures.push(now);
        if self.failures.len() >= self.max_failures {
            self.locked_until = Some(now + self.lock_for);
            self.failures.clear();
        }
    }
    pub fn record_success(&mut self) {
        self.failures.clear();
        self.locked_until = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_header_survives_the_frame() {
        let mut h = Header::new(Kind::File, "123456", "Sam's PC");
        h.file_name = "a.txt".into();
        h.size = 42;
        let frame = encode(&h).unwrap();
        let n = frame_length(frame[..4].try_into().unwrap()).unwrap();
        assert_eq!(n, frame.len() - 4);
        assert_eq!(decode(&frame[4..]).unwrap(), h);
    }

    #[test]
    fn the_json_matches_the_macs_field_names() {
        let mut h = Header::new(Kind::Message, "111111", "Sam");
        h.sender_service = "Sam-ab12".into();
        h.text = "hi".into();
        let v: serde_json::Value = serde_json::from_slice(&encode(&h).unwrap()[4..]).unwrap();
        for key in ["kind", "code", "fileName", "size", "sender", "senderService", "replyCode", "text"] {
            assert!(v.get(key).is_some(), "missing {key}");
        }
        assert_eq!(v["kind"], "message");
    }

    #[test]
    fn an_old_versions_header_still_decodes() {
        let h = decode(br#"{"code":"111111","fileName":"x.pdf","size":9,"sender":"Old Mac"}"#).unwrap();
        assert_eq!(h.kind, Kind::File);
        assert_eq!(h.file_name, "x.pdf");
        assert_eq!(h.sender_service, "");
    }

    #[test]
    fn nonsense_lengths_are_refused() {
        assert!(frame_length([0, 0, 0, 0]).is_none());
        assert!(frame_length([0xFF, 0xFF, 0xFF, 0xFF]).is_none());
    }

    #[test]
    fn codes_are_six_digits() {
        assert!(is_valid_code("012345"));
        assert!(!is_valid_code("12345"));
        assert!(!is_valid_code("12345a"));
    }

    #[test]
    fn file_names_cannot_escape_downloads() {
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_file_name("C:\\Users\\x\\id_rsa"), "id_rsa");
        assert_eq!(safe_file_name(".bashrc"), "_bashrc");
        assert_eq!(safe_file_name(""), "file");
        assert_eq!(safe_file_name("a:b.txt"), "a-b.txt");
        assert_eq!(safe_file_name("CON.txt"), "_CON.txt");
        assert!(safe_file_name(&"x".repeat(500)).chars().count() <= 200);
    }

    #[test]
    fn taken_names_get_a_number() {
        let taken = ["a.txt", "1-a.txt"];
        assert_eq!(unique_name("a.txt", |n| taken.contains(&n)), "2-a.txt");
        assert_eq!(unique_name("b.txt", |n| taken.contains(&n)), "b.txt");
    }

    #[test]
    fn display_names_are_tidied() {
        assert_eq!(display_name("  Sam  ", "PC"), "Sam");
        assert_eq!(display_name("   ", "PC"), "PC");
        assert_eq!(display_name(&"n".repeat(80), "PC").chars().count(), 32);
    }

    #[test]
    fn five_wrong_codes_lock_for_a_minute() {
        let mut l = AttemptLimiter::default();
        let t = Instant::now();
        for i in 0..4 {
            l.record_failure(t + Duration::from_secs(i));
        }
        assert!(!l.is_locked(t + Duration::from_secs(5)));
        l.record_failure(t + Duration::from_secs(5));
        assert!(l.is_locked(t + Duration::from_secs(6)));
        assert!(!l.is_locked(t + Duration::from_secs(70)));
    }

    #[test]
    fn slow_guesses_never_lock_and_a_success_clears() {
        let mut l = AttemptLimiter::default();
        let t = Instant::now();
        for i in 0..10 {
            l.record_failure(t + Duration::from_secs(i * 30));
        }
        assert!(!l.is_locked(t + Duration::from_secs(300)));
        let mut l = AttemptLimiter::default();
        for _ in 0..4 {
            l.record_failure(t);
        }
        l.record_success();
        l.record_failure(t);
        assert!(!l.is_locked(t));
    }

    #[test]
    fn only_an_established_chat_may_message() {
        let mut sessions = HashMap::new();
        sessions.insert("Sam-ab12".to_string(), Session { peer_service: "Sam-ab12".into(), peer_name: "Sam".into(), send_code: "222222".into(), expect_code: "111111".into() });
        let mk = |kind, code: &str, svc: &str| Header { kind, code: code.into(), sender: "x".into(), sender_service: svc.into(), ..Default::default() };
        assert!(authorised(&mk(Kind::Message, "111111", "Sam-ab12"), &sessions));
        assert!(!authorised(&mk(Kind::Message, "999999", "Sam-ab12"), &sessions));
        assert!(!authorised(&mk(Kind::Message, "111111", "Other-1111"), &sessions));
        assert!(!authorised(&mk(Kind::File, "111111", "Sam-ab12"), &sessions));
    }
}
