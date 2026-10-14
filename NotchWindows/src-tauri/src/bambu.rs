//! The Bambu Lab tab's printer connection.
//!
//! Bambu Lab printers speak MQTT over TLS on the local network (port 8883, user `bblp`, password = the LAN
//! access code, certificate signed by the printer itself, so it can't be checked against any authority).
//! The web view can't open a raw socket, so this does: it connects, subscribes to `device/<serial>/report`,
//! and streams every report to the UI as an event. Each connection drives itself on its own thread. Stopping
//! (the tab closing, a printer removed, a reconnect) sets the connection's stop flag and sends a disconnect: its
//! thread then leaves quietly, WITHOUT telling the UI, so a connection that was replaced never reports itself
//! as "dropped" over the new one. Nothing here blocks the caller for long: a printer that is off or slow fails on
//! its own thread and tells the UI why (the UI decides whether to try again).

use std::sync::{Mutex, MutexGuard};
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
    /// Set (to "global" or "china") for a printer reached through the person's Bambu account instead of the LAN: the
    /// sign-in itself is read from the owner's private session file, never sent through the UI.
    #[serde(default)]
    pub cloud: Option<String>,
}

/// Bambu Cloud's MQTT brokers, one per account region. Nothing else is ever connected to with an account token.
pub fn cloud_host(region: &str) -> Option<&'static str> {
    match region {
        "global" => Some("us.mqtt.bambulab.com"),
        "china" => Some("cn.mqtt.bambulab.com"),
        _ => None,
    }
}

/// The signed-in account, kept in one small file in the app's private data folder (`bambu_cloud.json`). It holds the
/// account's numeric id and the access token Bambu issued: never the password, which is not kept anywhere.
#[derive(Deserialize, serde::Serialize, Clone, PartialEq, Debug)]
pub struct CloudSession {
    pub region: String,
    pub uid: String,
    pub token: String,
}

/// A Bambu serial: letters and digits only, 8 to 32 of them (it becomes part of an MQTT topic, so `+`, `#` and `/` must never get through).
pub fn valid_serial(s: &str) -> bool {
    (8..=32).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric())
}

fn valid_session(c: &CloudSession) -> Result<(), String> {
    if cloud_host(&c.region).is_none() { return Err("Unknown Bambu account region.".into()); }
    if c.uid.is_empty() || c.uid.len() > 20 || !c.uid.bytes().all(|b| b.is_ascii_digit()) { return Err("That doesn’t look like a Bambu account id.".into()); }
    if c.token.len() < 20 || c.token.len() > 8192 || c.token.bytes().any(|b| b.is_ascii_whitespace() || b.is_ascii_control()) { return Err("That doesn’t look like a Bambu sign-in token.".into()); }
    Ok(())
}

fn cloud_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("No private place to keep the sign-in: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("No private place to keep the sign-in: {e}"))?;
    Ok(dir.join("bambu_cloud.json"))
}

/// Writes the session to `path` (to a temporary file first, owner-only where the system supports it, then renamed in).
pub fn write_session(path: &PathBuf, c: &CloudSession) -> Result<(), String> {
    valid_session(c)?;
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string(c).map_err(|e| e.to_string())?;
    let done = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut o = std::fs::OpenOptions::new();
        o.write(true).create(true).truncate(true);
        #[cfg(unix)]
        { use std::os::unix::fs::OpenOptionsExt; o.mode(0o600); }   // owner-only from the first byte
        o.open(&tmp)?.write_all(text.as_bytes())?;
        std::fs::rename(&tmp, path)
    })();
    if let Err(e) = done { let _ = std::fs::remove_file(&tmp); return Err(e.to_string()); }
    Ok(())
}

pub fn read_session(path: &PathBuf) -> Result<Option<CloudSession>, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("couldn’t read the saved sign-in: {e}")),
    };
    let c: CloudSession = serde_json::from_str(&text).map_err(|_| "the saved sign-in is damaged: sign in again".to_string())?;
    valid_session(&c)?;
    Ok(Some(c))
}

/// Keeps the account sign-in (after the UI has signed in with the account's own password, once, in memory).
#[tauri::command]
pub fn bambu_cloud_save(app: AppHandle, region: String, uid: String, token: String) -> Result<(), String> {
    write_session(&cloud_file(&app)?, &CloudSession { region, uid, token })
}

/// Bambu's account API for a region.
pub fn cloud_api(region: &str) -> Option<&'static str> {
    match region { "global" => Some("https://api.bambulab.com"), "china" => Some("https://api.bambulab.cn"), _ => None }
}

/// Asks Bambu about the signed-in account with the saved token: only `preference` (the account id) and `bind` (its printers)
/// can be asked, and the answer's text goes to the UI; the token itself never does.
#[tauri::command]
pub async fn bambu_cloud_get(app: AppHandle, what: String) -> Result<String, String> {
    let session = read_session(&cloud_file(&app)?)?.ok_or("Sign in with your Bambu account first.")?;
    let base = cloud_api(&session.region).ok_or("Unknown Bambu account region.")?;
    let path = match what.as_str() {
        "preference" => "/v1/design-user-service/my/preference",
        "bind" => "/v1/iot-service/api/user/bind",
        _ => return Err("Unknown request.".into()),
    };
    let res = crate::net::strict_client()
        .get(format!("{base}{path}"))
        .bearer_auth(&session.token)
        .timeout(Duration::from_secs(20))
        .send().await.map_err(crate::net::describe)?;
    let status = res.status().as_u16();
    if status == 401 || status == 403 { return Err("Bambu Cloud refused the saved sign-in. It has probably expired: sign in again under Bambu account.".into()); }
    if !res.status().is_success() { return Err(format!("Bambu answered {status}.")); }
    let text = res.text().await.map_err(crate::net::describe)?;
    if text.len() > 200_000 { return Err("Bambu's answer was unexpectedly large.".into()); }
    Ok(text)
}

/// Which region is signed in (the token itself never goes back to the UI), or nothing.
#[tauri::command]
pub fn bambu_cloud_status(app: AppHandle) -> Result<Option<String>, String> {
    Ok(read_session(&cloud_file(&app)?)?.map(|c| c.region))
}

/// Signs out: the saved token is deleted and every account-connected printer is disconnected.
#[tauri::command]
pub fn bambu_cloud_clear(pool: State<'_, Pool>, app: AppHandle, serials: Vec<String>) -> Result<(), String> {
    let path = cloud_file(&app)?;
    {   // the connections first, so nothing keeps using the token while it is being deleted
        let mut live = lock(&pool.inner);
        let (gone, keep): (Vec<Entry>, Vec<Entry>) = std::mem::take(&mut *live).into_iter().partition(|e| serials.iter().any(|s| s.trim() == e.serial));
        *live = keep;
        gone.into_iter().for_each(Entry::shut_down);
    }
    match std::fs::remove_file(&path) { Ok(()) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(e) => Err(format!("couldn’t delete the saved sign-in: {e}")) }
}

struct Entry {
    serial: String,
    /// Keeps the connection open and is how it is told to disconnect.
    client: Client,
    /// Set when this connection has been stopped or replaced: its thread must leave without reporting.
    stop: Arc<AtomicBool>,
}

impl Entry {
    fn shut_down(self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.client.try_disconnect();
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())   // a poisoned lock still has to let a stop through
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
    if !valid_serial(&serial) { return Err("That doesn’t look like a Bambu serial number.".into()); }   // it goes into an MQTT topic: no wildcards
    let topic = format!("device/{serial}/report");
    let pins = pin_file(&app)?;
    let mismatch = Arc::new(AtomicBool::new(false));
    let session = match &config.cloud {
        Some(region) => match read_session(&cloud_file(&app)?)? {
            Some(c) if &c.region == region => Some(c),
            _ => return Err("Your Bambu account sign-in is missing or has expired: sign in again under Printer Status → Bambu account.".into()),
        },
        None => None,
    };
    let (client, connection) = connect(&config, session, pins, mismatch.clone())?;
    let stop = Arc::new(AtomicBool::new(false));
    {
        let mut live = lock(&pool.inner);
        let (old, keep): (Vec<Entry>, Vec<Entry>) = std::mem::take(&mut *live).into_iter().partition(|e| e.serial == serial);
        *live = keep;
        old.into_iter().for_each(Entry::shut_down);
        live.push(Entry { serial: serial.clone(), client, stop: stop.clone() });
    }
    let pump = app.clone();
    let cloud = config.cloud.is_some();
    std::thread::spawn(move || drive(pump, serial, connection, mismatch, stop, cloud));
    Ok(topic)
}

/// Stops one printer (by serial), or every printer when no serial is given (the tab closing, or the settings being emptied).
#[tauri::command]
pub fn bambu_stop(pool: State<'_, Pool>, serial: Option<String>) {
    let mut live = lock(&pool.inner);
    let (gone, keep): (Vec<Entry>, Vec<Entry>) = std::mem::take(&mut *live)
        .into_iter()
        .partition(|e| serial.as_deref().map_or(true, |s| e.serial == s.trim()));
    *live = keep;
    gone.into_iter().for_each(Entry::shut_down);
}

/// Which printers the app is connected to (Settings shows the count).
#[tauri::command]
pub fn bambu_running(pool: State<'_, Pool>) -> Vec<String> {
    lock(&pool.inner).iter().map(|e| e.serial.clone()).collect()
}

/// Opens the connection and subscribes. A problem here is reported to the UI by the driving thread, so
/// this only fails on a printer the settings describe wrongly.
fn connect(config: &Config, session: Option<CloudSession>, pins: PathBuf, mismatch: Arc<AtomicBool>) -> Result<(Client, Connection), String> {
    let serial = config.serial.trim();
    if serial.is_empty() { return Err("Add the printer’s serial number first.".into()); }
    let mut opts;
    if let Some(c) = session {
        // Through the account: Bambu's own broker, whose certificate is checked against the system's trusted authorities.
        let host = cloud_host(&c.region).ok_or("Unknown Bambu account region.")?;
        opts = MqttOptions::new(format!("notchapple-{}-{serial}", &c.uid), host, PORT);
        opts.set_credentials(format!("u_{}", c.uid), c.token);
        opts.set_transport(Transport::tls_with_default_config());
    } else {
        if config.access_code.trim().is_empty() || config.host.trim().is_empty() {
            return Err("Add the printer’s IP, access code and serial number first.".into());
        }
        opts = MqttOptions::new(format!("notchapple-{serial}"), config.host.trim(), PORT);   // one client id per printer, so connections never kick each other off;
        opts.set_credentials(USER, config.access_code.trim());
        opts.set_transport(Transport::Tls(TlsConfiguration::Rustls(printer_cert_config(pins, serial.to_string(), mismatch))));
    }
    opts.set_keep_alive(Duration::from_secs(KEEP_ALIVE));
    opts.set_clean_session(true);

    let (client, connection) = Client::new(opts, 8);
    // Subscribing before the first iteration is fine: what can't be sent yet is queued.
    client
        .subscribe(format!("device/{serial}/report"), QoS::AtMostOnce)
        .map_err(|e| format!("Couldn’t subscribe to the printer: {e}"))?;
    // Newer printers send only what changed until they are asked for everything once.
    let _ = client.publish(format!("device/{serial}/request"), QoS::AtMostOnce, false,
        r#"{"pushing":{"sequence_id":"0","command":"pushall"}}"#);
    Ok((client, connection))
}

/// What a connection's thread does: every report goes to the UI, and a connection that fails or ends on its
/// own emits a state so the tab can show it (a stopped or replaced one says nothing).
fn drive(app: AppHandle, serial: String, mut connection: Connection, mismatch: Arc<AtomicBool>, stop: Arc<AtomicBool>, cloud: bool) {
    for event in connection.iter() {
        if stop.load(Ordering::SeqCst) { return; }
        match event {
            Ok(Event::Incoming(Packet::Publish(p))) => {
                let _ = app.emit(EVENT_REPORT, serde_json::json!({
                    "serial": serial,
                    "payload": String::from_utf8_lossy(&p.payload).to_string(),
                }));
            }
            Ok(_) => {}
            Err(e) => {
                if stop.load(Ordering::SeqCst) { return; }
                let _ = app.emit(EVENT_STATE, serde_json::json!({ "serial": serial, "state": "failed", "message": if mismatch.load(Ordering::SeqCst) { PIN_MISMATCH.to_string() } else { explain(&e.to_string(), cloud) } }));
                return;
            }
        }
    }
    if !stop.load(Ordering::SeqCst) {
        let _ = app.emit(EVENT_STATE, serde_json::json!({ "serial": serial, "state": "dropped" }));
    }
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

/// One lock for the pin file: several printers connect at once, and a read-modify-write must not interleave.
static PIN_LOCK: Mutex<()> = Mutex::new(());

/// The remembered certificates. A missing file is an empty map; a file that exists but can't be read is an
/// error, so a damaged file can never quietly turn into "trust whatever you are shown".
fn read_pins(path: &PathBuf) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Default::default()),
        Err(e) => return Err(format!("couldn’t read the remembered certificates: {e}")),
    };
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Object(m)) if m.values().all(|v| v.is_string()) => Ok(m),
        _ => Err("the remembered-certificates file is damaged: choose “Trust new certificate” to start it afresh".into()),
    }
}

/// Writes the whole file or none of it (to a temporary file, then renamed over the old one).
fn write_pins(path: &PathBuf, pins: serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::Value::Object(pins).to_string()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Forgets a printer's remembered certificate (after a firmware update or reset): the next connection remembers the new one.
#[tauri::command]
pub fn bambu_trust_new(app: AppHandle, serial: String) -> Result<(), String> {
    let path = pin_file(&app)?;
    let _guard = lock(&PIN_LOCK);
    // A damaged file is exactly what this button is for: start afresh instead of failing.
    let mut pins = match read_pins(&path) {
        Ok(p) => p,
        Err(e) if e.contains("damaged") => Default::default(),   // exactly what this button is for
        Err(e) => return Err(e),                                 // a busy or unreadable file must not wipe the other printers' pins
    };
    pins.remove(serial.trim());
    write_pins(&path, pins)
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
        let _guard = lock(&PIN_LOCK);
        let mut pins = read_pins(&self.file).map_err(rustls::Error::General)?;
        match decide_pin(pins.get(&self.serial).and_then(|v| v.as_str()), &seen) {
            PinDecision::Match => Ok(ServerCertVerified::assertion()),
            PinDecision::PinFirst => {
                pins.insert(self.serial.clone(), serde_json::Value::String(seen));
                write_pins(&self.file, pins)
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
    fn only_bambus_own_brokers_are_known() {
        assert_eq!(cloud_host("global"), Some("us.mqtt.bambulab.com"));
        assert_eq!(cloud_host("china"), Some("cn.mqtt.bambulab.com"));
        assert_eq!(cloud_host("evil.example.com"), None);
        assert_eq!(cloud_host(""), None);
    }
    fn sample() -> CloudSession { CloudSession { region: "global".into(), uid: "123456789".into(), token: "a".repeat(40) } }
    #[test]
    fn a_session_is_checked_before_it_is_kept() {
        assert!(valid_session(&sample()).is_ok());
        assert!(valid_session(&CloudSession { uid: "12a".into(), ..sample() }).is_err());
        assert!(valid_session(&CloudSession { uid: "".into(), ..sample() }).is_err());
        assert!(valid_session(&CloudSession { token: "short".into(), ..sample() }).is_err());
        assert!(valid_session(&CloudSession { token: "has space in it ".repeat(4), ..sample() }).is_err());
        assert!(valid_session(&CloudSession { region: "mars".into(), ..sample() }).is_err());
    }
    #[test]
    fn a_session_is_written_and_read_back_and_a_missing_file_is_no_session() {
        let dir = std::env::temp_dir().join(format!("notch-bambu-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bambu_cloud.json");
        assert_eq!(read_session(&path).unwrap(), None);
        write_session(&path, &sample()).unwrap();
        assert_eq!(read_session(&path).unwrap(), Some(sample()));
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600); }
        assert!(write_session(&path, &CloudSession { token: "x".into(), ..sample() }).is_err());
        std::fs::write(&path, "not json").unwrap();
        assert!(read_session(&path).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    fn only_bambus_account_api_is_known() {
        assert_eq!(cloud_api("global"), Some("https://api.bambulab.com"));
        assert_eq!(cloud_api("china"), Some("https://api.bambulab.cn"));
        assert_eq!(cloud_api("evil"), None);
    }
    #[test]
    fn serials_cannot_carry_mqtt_wildcards() {
        assert!(valid_serial("01P00A123456789"));
        assert!(!valid_serial("01P00A12+456789"));
        assert!(!valid_serial("01P00A12#456789"));
        assert!(!valid_serial("a/b/c/d/e/f/g/h"));
        assert!(!valid_serial("short"));
    }
    #[test]
    fn a_plain_outage_is_not_called_an_expired_sign_in() {
        assert!(explain("connection refused", true).contains("Check your internet"));
        assert!(!explain("connection refused", true).contains("sign in again"));
    }
    #[test]
    fn an_expired_sign_in_is_explained() {
        assert!(explain("Not authorized", true).contains("sign in again"));
        assert!(explain("Not authorized", false).contains("access code"));
    }
    #[test]
    fn fingerprints_are_sha256_hex() {
        assert_eq!(fingerprint(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}

/// Turns a connection error into something a person can act on.
fn explain(e: &str, cloud: bool) -> String {
    let low = e.to_lowercase();
    if cloud && (low.contains("not authorized") || low.contains("bad user") || low.contains("password")) {
        return "Bambu Cloud refused the saved sign-in. It has probably expired: sign in again under Bambu account.".into();
    }
    if cloud && (low.contains("refused") || low.contains("timed out") || low.contains("timeout") || low.contains("dns")) {
        return "Couldn’t reach Bambu Cloud. Check your internet connection; Notch Apple will try again.".into();
    }
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
