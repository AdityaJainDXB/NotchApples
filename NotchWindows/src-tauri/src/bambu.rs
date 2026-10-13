//! The Bambu Lab tab's printer connection.
//!
//! Bambu Lab printers speak MQTT over TLS on the local network (port 8883, user `bblp`, password = the LAN
//! access code, certificate signed by the printer itself, so it can't be checked against any authority).
//! The web view can't open a raw socket, so this does: it connects, subscribes to `device/<serial>/report`,
//! and streams every report to the UI as an event. Each connection drives itself on its own thread and is
//! kept alive by the `Client` held in `Pool`: stopping (the tab closing, a printer removed) drops the
//! client, the iteration ends and the thread leaves. Nothing here blocks the caller for long — a printer
//! that is off or slow fails on its own thread and tells the UI why.

use std::sync::Mutex;
use std::time::Duration;

use rumqttc::{Client, Connection, Event, MqttOptions, Packet, QoS, Transport, TlsConfiguration};
use rumqttc::tokio_rustls::rustls;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, SignatureScheme};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// The LAN port every Bambu printer answers MQTT on.
pub const PORT: u16 = 8883;
const USER: &str = "bblp";
const KEEP_ALIVE: u64 = 30;

/// One printer to watch, as the settings screen keeps it.
#[derive(Deserialize, Clone)]
pub struct Config {
    pub host: String,
    pub access_code: String,
    pub serial: String,
}

struct Entry {
    serial: String,
    /// Keeping this alive keeps the printer's connection open; dropping it ends the thread.
    client: Client,
}

/// The live printer connections, by serial: saving a printer re-connects it without a second socket.
#[derive(Default)]
pub struct Pool {
    inner: Mutex<Vec<Entry>>,
}

/// The events the UI listens for: one payload per report, and one state line per connection change.
pub const EVENT_REPORT: &str = "bambu:report";
pub const EVENT_STATE: &str = "bambu:state";

/// Connects (or re-connects) one printer and returns the topic its reports arrive on.
#[tauri::command]
pub fn bambu_start(pool: State<'_, Pool>, app: AppHandle, config: Config) -> Result<String, String> {
    let serial = config.serial.trim().to_string();
    let topic = format!("device/{serial}/report");
    let pins = pin_file(&app)?;
    let mismatch = Arc::new(AtomicBool::new(false));
    let (client, connection) = connect(&config, pins, mismatch.clone())?;
    {
        let mut live = pool.inner.lock().map_err(|_| "The Bambu Lab connections are broken.".to_string())?;
        live.retain(|e| e.serial != serial);
        live.push(Entry { serial: serial.clone(), client });
    }
    let pump = app.clone();
    std::thread::spawn(move || drive(pump, serial, connection, mismatch));
    Ok(topic)
}

/// Stops every printer (the tab closing, or the settings being emptied).
#[tauri::command]
pub fn bambu_stop(pool: State<'_, Pool>) {
    if let Ok(mut live) = pool.inner.lock() {
        live.clear();
    }
}

/// Which printers the app is connected to (Settings shows the count).
#[tauri::command]
pub fn bambu_running(pool: State<'_, Pool>) -> Vec<String> {
    pool.inner.lock().map(|live| live.iter().map(|e| e.serial.clone()).collect()).unwrap_or_default()
}

/// Opens the connection and subscribes. A problem here is reported to the UI by the driving thread, so
/// this only fails on a printer the settings describe wrongly.
fn connect(config: &Config, pins: PathBuf, mismatch: Arc<AtomicBool>) -> Result<(Client, Connection), String> {
    let serial = config.serial.trim();
    if serial.is_empty() || config.access_code.trim().is_empty() || config.host.trim().is_empty() {
        return Err("Add the printer’s IP, access code and serial number first.".into());
    }
    let mut opts = MqttOptions::new("notchapple", config.host.trim(), PORT);
    opts.set_credentials(USER, config.access_code.trim());
    opts.set_keep_alive(Duration::from_secs(KEEP_ALIVE));
    opts.set_clean_session(true);
    opts.set_transport(Transport::Tls(TlsConfiguration::Rustls(printer_cert_config(pins, serial.to_string(), mismatch))));

    let (client, connection) = Client::new(opts, 8);
    // Subscribing before the first iteration is fine: what can't be sent yet is queued.
    client
        .subscribe(format!("device/{serial}/report"), QoS::AtMostOnce)
        .map_err(|e| format!("Couldn’t subscribe to the printer: {e}"))?;
    Ok((client, connection))
}

/// What a connection's thread does: every report goes to the UI, and a connection that fails or ends
/// emits a state so the tab can show it and try again.
fn drive(app: AppHandle, serial: String, mut connection: Connection, mismatch: Arc<AtomicBool>) {
    for event in connection.iter() {
        match event {
            Ok(Event::Incoming(Packet::Publish(p))) => {
                let _ = app.emit(EVENT_REPORT, serde_json::json!({
                    "serial": serial,
                    "payload": String::from_utf8_lossy(&p.payload).to_string(),
                }));
            }
            Ok(_) => {}
            Err(e) => {
                let _ = app.emit(EVENT_STATE, serde_json::json!({ "serial": serial, "state": "failed", "message": if mismatch.load(Ordering::SeqCst) { PIN_MISMATCH.to_string() } else { explain(&e.to_string()) } }));
                return;
            }
        }
    }
    let _ = app.emit(EVENT_STATE, serde_json::json!({ "serial": serial, "state": "dropped" }));
}

const PIN_MISMATCH: &str = "The printer’s certificate changed, so Notch Apple refused to connect. If you updated its firmware or reset it, choose “Trust new certificate” in Settings → Bambu Lab. If not, someone on your network may be posing as it.";

#[derive(Debug, PartialEq)]
pub enum PinDecision {
    PinFirst,
    Match,
    Mismatch,
}

/// A printer's certificate is signed by the printer itself, so no authority can vouch for it. Instead the
/// first certificate it shows is remembered (trust on first use) and any different one is refused, so
/// someone on the same Wi-Fi can't pose as the printer and read the access code.
pub fn decide_pin(stored: Option<&str>, seen: &str) -> PinDecision {
    match stored {
        None | Some("") => PinDecision::PinFirst,
        Some(s) if s.eq_ignore_ascii_case(seen) => PinDecision::Match,
        Some(_) => PinDecision::Mismatch,
    }
}

fn fingerprint(der: &[u8]) -> String {
    Sha256::digest(der).iter().map(|b| format!("{b:02x}")).collect()
}

/// Where the remembered certificates live: one small JSON file of serial -> fingerprint in the app's data folder.
fn pin_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("No place to keep the printer’s certificate: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("No place to keep the printer’s certificate: {e}"))?;
    Ok(dir.join("bambu_pins.json"))
}

fn read_pins(path: &PathBuf) -> serde_json::Map<String, serde_json::Value> {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// Forgets a printer's remembered certificate (after a firmware update or reset): the next connection remembers the new one.
#[tauri::command]
pub fn bambu_trust_new(app: AppHandle, serial: String) -> Result<(), String> {
    let path = pin_file(&app)?;
    let mut pins = read_pins(&path);
    pins.remove(serial.trim());
    std::fs::write(&path, serde_json::Value::Object(pins).to_string()).map_err(|e| e.to_string())
}

#[derive(Debug)]
struct PinnedCert {
    file: PathBuf,
    serial: String,
    mismatch: Arc<AtomicBool>,
}
impl ServerCertVerifier for PinnedCert {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let seen = fingerprint(end_entity.as_ref());
        let mut pins = read_pins(&self.file);
        match decide_pin(pins.get(&self.serial).and_then(|v| v.as_str()), &seen) {
            PinDecision::Match => Ok(ServerCertVerified::assertion()),
            PinDecision::PinFirst => {
                pins.insert(self.serial.clone(), serde_json::Value::String(seen));
                std::fs::write(&self.file, serde_json::Value::Object(pins).to_string())
                    .map_err(|e| rustls::Error::General(format!("couldn’t remember the printer’s certificate: {e}")))?;
                Ok(ServerCertVerified::assertion())
            }
            PinDecision::Mismatch => {
                self.mismatch.store(true, Ordering::SeqCst);
                Err(rustls::Error::General("printer certificate changed".into()))
            }
        }
    }
    // The signature on the handshake is still checked with the certificate's own key; only the "who vouches for
    // this certificate" step is replaced by the pin.
    fn verify_tls12_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(m, c, d, &rustls::crypto::ring::default_provider().signature_verification_algorithms)
    }
    fn verify_tls13_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(m, c, d, &rustls::crypto::ring::default_provider().signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        rustls::crypto::ring::default_provider().signature_verification_algorithms.supported_schemes()
    }
}

fn printer_cert_config(file: PathBuf, serial: String, mismatch: Arc<AtomicBool>) -> Arc<ClientConfig> {
    Arc::new(
        ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(PinnedCert { file, serial, mismatch }))
            .with_no_client_auth(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_first_certificate_is_remembered() {
        assert_eq!(decide_pin(None, "ab"), PinDecision::PinFirst);
        assert_eq!(decide_pin(Some(""), "ab"), PinDecision::PinFirst);
    }
    #[test]
    fn the_same_certificate_matches_whatever_the_case() {
        assert_eq!(decide_pin(Some("ABCD"), "abcd"), PinDecision::Match);
    }
    #[test]
    fn a_different_certificate_is_refused() {
        assert_eq!(decide_pin(Some("abcd"), "abce"), PinDecision::Mismatch);
    }
    #[test]
    fn fingerprints_are_sha256_hex() {
        assert_eq!(fingerprint(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}

/// Turns a connection error into something a person can act on.
fn explain(e: &str) -> String {
    let low = e.to_lowercase();
    if low.contains("timed out") || low.contains("timeout") {
        return "Nothing answered on the LAN. Check the IP and that the printer is on the same Wi-Fi.".into();
    }
    if low.contains("refused")
        || low.contains("not authorized")
        || low.contains("bad user name")
        || low.contains("bad username")
        || low.contains("password")
    {
        return "The access code was refused. On the printer: Settings → LAN, and copy the access code.".into();
    }
    if low.contains("dns") {
        return "That address doesn’t resolve. Use the printer’s IP address.".into();
    }
    if low.contains("connection refused") {
        return "Nothing is listening on port 8883. Check the IP and that LAN mode is on.".into();
    }
    format!("Couldn’t reach the printer ({e}).")
}
