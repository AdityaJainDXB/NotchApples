//! The live picture from a P1 or A1 printer's camera.
//!
//! These printers send a stream of JPEG pictures over TLS on port 6000 of the printer, after an 80-byte login (user `bblp`,
//! the LAN access code). The certificate is the printer's own, so the first one seen is remembered and a different one is
//! refused (the same pinning as the status connection). Only one camera is open at a time; closing the view, or opening
//! another, stops the thread. Nothing is saved: pictures are passed straight to the UI. The X1, P2 and H2 printers send H.264
//! over RTSPS instead; for those the UI offers the address to open in a video player (`rtsps_address`).

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use rumqttc::tokio_rustls::rustls::pki_types::ServerName;
use rumqttc::tokio_rustls::rustls::{ClientConnection, StreamOwned};
use tauri::{AppHandle, Emitter, State};

pub const PORT: u16 = 6000;
const MAX_FRAME: usize = 4 * 1024 * 1024;
pub const EVENT_FRAME: &str = "bambu:frame";
pub const EVENT_STATE: &str = "bambu:camera";

/// The 80 bytes that open the stream: a fixed 16-byte header, then the user name and the access code, each in 32 bytes.
pub fn auth_packet(user: &str, code: &str) -> Option<Vec<u8>> {
    let (u, c) = (user.as_bytes(), code.as_bytes());
    if u.is_empty() || u.len() > 32 || c.is_empty() || c.len() > 32 { return None; }
    let mut d = vec![0x40, 0, 0, 0, 0x00, 0x30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    d.extend_from_slice(u); d.extend(std::iter::repeat(0).take(32 - u.len()));
    d.extend_from_slice(c); d.extend(std::iter::repeat(0).take(32 - c.len()));
    Some(d)
}

/// Takes every complete picture off the front of `buf` (16-byte header, whose first four bytes little-endian are the size,
/// then the JPEG). `None` means the stream is not what it should be.
pub fn take_frames(buf: &mut Vec<u8>) -> Option<Vec<Vec<u8>>> {
    let mut frames = Vec::new();
    while buf.len() >= 16 {
        let size = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
        if size <= 4 || size > MAX_FRAME { return None; }
        if buf.len() < 16 + size { break; }
        let frame: Vec<u8> = buf[16..16 + size].to_vec();
        buf.drain(..16 + size);
        if frame[0] != 0xFF || frame[1] != 0xD8 || frame[frame.len() - 1] != 0xD9 { return None; }
        frames.push(frame);
    }
    Some(frames)
}

/// The address to open in a video player for the printers whose camera is a video stream.
pub fn rtsps_address(ip: &str, code: &str) -> Option<String> {
    if ip.is_empty() || code.is_empty() || !ip.chars().all(|c| c.is_ascii_digit() || c == '.' || c == ':') { return None; }
    let enc: String = code.bytes().map(|b| if b.is_ascii_alphanumeric() { (b as char).to_string() } else { format!("%{b:02X}") }).collect();
    Some(format!("rtsps://bblp:{enc}@{ip}:322/streaming/live/1"))
}

/// A usable host: an IP address or a plain hostname, nothing else.
pub fn valid_host(h: &str) -> bool {
    !h.is_empty() && h.len() <= 253 && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':')
}

#[derive(Default)]
pub struct CamPool { stop: Mutex<Option<Arc<AtomicBool>>> }

fn stop_current(pool: &CamPool) {
    if let Some(flag) = pool.stop.lock().unwrap_or_else(|e| e.into_inner()).take() { flag.store(true, Ordering::SeqCst); }
}

#[tauri::command]
pub fn bambu_camera_stop(pool: State<'_, CamPool>) { stop_current(&pool); }

/// Opens the camera of one printer (closing any other). Problems come back as `bambu:camera` events from the thread.
#[tauri::command]
pub fn bambu_camera_start(pool: State<'_, CamPool>, app: AppHandle, host: String, access_code: String, serial: String) -> Result<(), String> {
    let host = host.trim().to_string();
    let code = access_code.trim().to_string();
    if !valid_host(&host) || !crate::bambu::valid_serial(serial.trim()) { return Err("The camera needs the printer’s address and serial number. Check them in Printer Status.".into()); }
    let auth = auth_packet("bblp", &code).ok_or("The camera needs the printer’s access code.")?;
    stop_current(&pool);
    let stop = Arc::new(AtomicBool::new(false));
    *pool.stop.lock().unwrap_or_else(|e| e.into_inner()) = Some(stop.clone());
    let pins = crate::bambu::pin_file(&app)?;
    let key = format!("cam-{}", serial.trim());
    std::thread::spawn(move || {
        let mismatch = Arc::new(AtomicBool::new(false));
        let end = |state: &str, message: &str| { let _ = app.emit(EVENT_STATE, serde_json::json!({ "serial": serial, "state": state, "message": message })); };
        let result = run(&app, &host, &auth, pins, key, mismatch.clone(), &stop, &serial);
        if stop.load(Ordering::SeqCst) { return; }
        match result {
            Ok(()) => end("ended", "The camera stopped. Press Camera to open it again."),
            Err(e) if mismatch.load(Ordering::SeqCst) => { let _ = e; end("failed", "The printer’s certificate changed, so the camera refused to connect. Use Trust new certificate in Printer Status.") }
            Err(e) => end("failed", &e),
        }
    });
    Ok(())
}

const NO_PICTURE: &str = "No picture came. Turn on the camera (and on some firmware “LAN Only Liveview”) in the printer’s settings. The X1, P2 and H2 printers send video this app cannot play yet: use Copy video address.";

fn run(app: &AppHandle, host: &str, auth: &[u8], pins: std::path::PathBuf, key: String, mismatch: Arc<AtomicBool>, stop: &Arc<AtomicBool>, serial: &str) -> Result<(), String> {
    let addr = (host, PORT).to_socket_addrs().map_err(|_| "That address doesn’t resolve. Use the printer’s IP address.".to_string())?.next().ok_or("That address doesn’t resolve.")?;
    let tcp = TcpStream::connect_timeout(&addr, Duration::from_secs(8)).map_err(|_| "Nothing answered on the printer’s camera port. Check the address and that the camera is on.".to_string())?;
    tcp.set_read_timeout(Some(Duration::from_millis(800))).ok();
    let config = crate::bambu::printer_cert_config(pins, key, mismatch);
    let name = ServerName::try_from(host.to_string()).map_err(|_| "That address can’t be used.".to_string())?;
    let conn = ClientConnection::new(config, name).map_err(|e| e.to_string())?;
    let mut tls = StreamOwned::new(conn, tcp);
    tls.write_all(auth).map_err(|e| e.to_string())?;
    let (mut buf, mut chunk) = (Vec::<u8>::new(), vec![0u8; 64 * 1024]);
    let (started, mut last_shown, mut any) = (Instant::now(), Instant::now() - Duration::from_secs(1), false);
    loop {
        if stop.load(Ordering::SeqCst) { return Ok(()); }
        match tls.read(&mut chunk) {
            Ok(0) => return Ok(()),
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                let frames = take_frames(&mut buf).ok_or("The printer sent something that is not a camera picture.")?;
                if let Some(newest) = frames.last() {
                    any = true;
                    if last_shown.elapsed() > Duration::from_millis(160) {
                        last_shown = Instant::now();
                        let b64 = base64::engine::general_purpose::STANDARD.encode(newest);
                        let _ = app.emit(EVENT_FRAME, serde_json::json!({ "serial": serial, "jpeg": b64 }));
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {
                if !any && started.elapsed() > Duration::from_secs(10) { return Err(NO_PICTURE.into()); }
            }
            Err(e) => return Err(if any { format!("The camera stopped ({e}).") } else { NO_PICTURE.into() }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn frame(j: &[u8]) -> Vec<u8> { let mut d = vec![j.len() as u8, (j.len() >> 8) as u8, (j.len() >> 16) as u8, 0]; d.extend([0u8; 12]); d.extend_from_slice(j); d }
    #[test]
    fn the_login_is_80_bytes_with_the_name_and_code_in_place() {
        let p = auth_packet("bblp", "12345678").unwrap();
        assert_eq!(p.len(), 80);
        assert_eq!(&p[..8], &[0x40, 0, 0, 0, 0, 0x30, 0, 0]);
        assert_eq!(&p[16..20], b"bblp"); assert_eq!(p[20], 0); assert_eq!(&p[48..56], b"12345678");
        assert!(auth_packet("bblp", "").is_none()); assert!(auth_packet("bblp", &"x".repeat(33)).is_none());
    }
    #[test]
    fn pictures_are_taken_whole_and_the_rest_waits() {
        let (a, b) = (vec![0xFF, 0xD8, 1, 2, 3, 0xFF, 0xD9], vec![0xFF, 0xD8, 9, 0xFF, 0xD9]);
        let mut buf = frame(&a); buf.extend_from_slice(&frame(&b)[..10]);
        assert_eq!(take_frames(&mut buf).unwrap(), vec![a]);
        buf.extend_from_slice(&frame(&b)[10..]);
        assert_eq!(take_frames(&mut buf).unwrap(), vec![b]); assert!(buf.is_empty());
    }
    #[test]
    fn a_stream_that_is_not_pictures_is_refused() {
        let mut junk = vec![0xFF, 0xFF, 0xFF, 0x7F]; junk.extend([0u8; 20]);
        assert!(take_frames(&mut junk).is_none());
        let mut not_jpeg = frame(&[1, 2, 3, 4, 5, 6, 7]);
        assert!(take_frames(&mut not_jpeg).is_none());
    }
    #[test]
    fn the_video_address_and_hosts() {
        assert_eq!(rtsps_address("192.168.1.100", "ab12cd34").unwrap(), "rtsps://bblp:ab12cd34@192.168.1.100:322/streaming/live/1");
        assert!(rtsps_address("evil.example.com", "x").is_none());
        assert_eq!(rtsps_address("10.0.0.2", "a@b/c").unwrap(), "rtsps://bblp:a%40b%2Fc@10.0.0.2:322/streaming/live/1");
        assert!(valid_host("192.168.1.5") && valid_host("printer.local") && !valid_host("a b") && !valid_host("a/b") && !valid_host(""));
    }
}
