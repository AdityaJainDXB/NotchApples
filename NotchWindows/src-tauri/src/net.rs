//! Web requests for the UI.
//!
//! The web view enforces CORS, and plenty of the free services Notch Apple uses
//! (ESPN's team lists, Groq, a local Ollama, F1 timing) don't send the headers a
//! browser needs. Requests made from Rust aren't subject to that, so every
//! network call in the app comes through here.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Deserialize)]
pub struct Request {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
    /// Return the body as base64 (images, audio) instead of text.
    pub binary: Option<bool>,
}

#[derive(Serialize)]
pub struct Response {
    pub status: u16,
    pub ok: bool,
    pub body: String,
    pub headers: HashMap<String, String>,
}

pub fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("NotchApple/", env!("CARGO_PKG_VERSION"), " (Windows)"))
            .connect_timeout(Duration::from_secs(10))
            // A redirect is checked like the first address: never from https down to plain http, and never to a place the
            // checks above would have refused (an https site cannot bounce a request to the router or a local service).
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                let downgrade = attempt.previous().last().map_or(false, |p| p.scheme() == "https") && attempt.url().scheme() == "http";
                if attempt.previous().len() >= 6 || downgrade || allowed(attempt.url().as_str()).is_err() { attempt.stop() } else { attempt.follow() }
            }))
            .build()
            .expect("HTTP client")
    })
}

/// For requests that carry a body or a credential (a password, a token, a cookie): a redirect may only stay on the same host,
/// so what was sent can never be forwarded to a different site by a redirect.
pub fn strict_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("NotchApple/", env!("CARGO_PKG_VERSION"), " (Windows)"))
            .connect_timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                let same = attempt.previous().first().map_or(false, |first| first.host_str() == attempt.url().host_str() && attempt.url().scheme() == "https");
                if attempt.previous().len() >= 3 || !same { attempt.stop() } else { attempt.follow() }
            }))
            .build()
            .expect("HTTP client")
    })
}

/// True when a request carries something that must not follow a redirect to another site.
pub fn needs_strict(body: &Option<String>, headers: &Option<HashMap<String, String>>) -> bool {
    body.as_deref().map_or(false, |b| !b.is_empty())
        || headers.as_ref().map_or(false, |h| h.keys().any(|k| {
            let k = k.to_ascii_lowercase();
            ["authorization", "cookie", "x-csrf-token", "x-api-key", "api-key"].contains(&k.as_str()) || k.contains("token") || k.contains("secret")
        }))
}

fn allowed(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| format!("Not a web address: {url}"))?;
    match parsed.scheme() {
        "https" => Ok(parsed),
        // Plain http only for this PC (Ollama) and the local network.
        "http" => {
            let host = parsed.host_str().unwrap_or("");
            // Real address checks: a name that merely starts with "10." or "127." (10.evil.com) is not this PC or the LAN.
            let ip4 = host.parse::<std::net::Ipv4Addr>().ok();
            let ip6 = host.trim_matches(|c| c == '[' || c == ']').parse::<std::net::Ipv6Addr>().ok();
            let local = host == "localhost"
                || ip4.map_or(false, |ip| ip.is_loopback() || ip.is_private())
                || ip6.map_or(false, |ip| ip.is_loopback())
                || host.ends_with(".local");
            if local {
                Ok(parsed)
            } else {
                Err("Only secure (https) addresses can be used.".into())
            }
        }
        _ => Err("Only web addresses can be used.".into()),
    }
}

#[tauri::command]
pub async fn http(req: Request) -> Result<Response, String> {
    let url = allowed(&req.url)?;
    let method = req.method.as_deref().unwrap_or("GET").to_uppercase();
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "Unknown request method.")?;
    let strict = needs_strict(&req.body, &req.headers);
    let mut builder = (if strict { strict_client() } else { client() })
        .request(method, url)
        .timeout(Duration::from_millis(req.timeout_ms.unwrap_or(30_000).clamp(1_000, 180_000)));
    for (k, v) in req.headers.unwrap_or_default() {
        builder = builder.header(k, v);
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }
    let res = builder.send().await.map_err(describe)?;
    let status = res.status().as_u16();
    let headers = res
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().to_string(), v.to_string())))
        .collect();
    let body = if req.binary.unwrap_or(false) {
        let bytes = res.bytes().await.map_err(describe)?;
        base64::engine::general_purpose::STANDARD.encode(bytes)
    } else {
        res.text().await.map_err(describe)?
    };
    Ok(Response { status, ok: (200..300).contains(&status), body, headers })
}

/// A friendlier message than reqwest's.
pub fn describe(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "The request timed out. Check your connection and try again.".into()
    } else if e.is_connect() {
        "Couldn't connect. Check your internet connection.".into()
    } else {
        format!("Network error: {e}")
    }
}

/// Downloads `url` to `path`, returning the number of bytes written.
pub async fn download(url: &str, path: &std::path::Path) -> Result<u64, String> {
    let url = allowed(url)?;
    let res = client()
        .get(url)
        .timeout(Duration::from_secs(600))
        .send()
        .await
        .map_err(describe)?;
    if !res.status().is_success() {
        return Err(format!("Download failed ({}).", res.status().as_u16()));
    }
    let bytes = res.bytes().await.map_err(describe)?;
    std::fs::write(path, &bytes).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_with_a_body_or_a_credential_never_follows_a_redirect_to_another_site() {
        let h = |k: &str| Some(HashMap::from([(k.to_string(), "x".to_string())]));
        assert!(needs_strict(&Some("{\"password\":1}".into()), &None));
        assert!(needs_strict(&None, &h("Authorization")));
        assert!(needs_strict(&None, &h("cookie")));
        assert!(needs_strict(&None, &h("x-csrf-token")));
        assert!(needs_strict(&None, &h("X-Api-Key")));
        assert!(!needs_strict(&None, &None));
        assert!(!needs_strict(&Some(String::new()), &h("accept")));
    }
    #[test]
    fn only_safe_addresses_are_allowed() {
        assert!(allowed("https://site.api.espn.com/x").is_ok());
        assert!(allowed("http://localhost:11434/v1").is_ok());
        assert!(allowed("http://127.0.0.1:8080").is_ok());
        assert!(allowed("http://example.com").is_err());
        assert!(allowed("file:///C:/Windows/win.ini").is_err());
        assert!(allowed("javascript:alert(1)").is_err());
    }
}
