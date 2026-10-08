use crate::protocol::*;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use rand::Rng;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const SERVICE_TYPE: &str = "_notchapple._tcp.local.";
const CHUNK: usize = 256 * 1024;

/// What the UI is told. `Changed` means "read the snapshot again".
#[derive(Clone, Debug)]
pub enum Notice {
    Changed,
    Received { name: String, from: String },
    Message { from: String, text: String },
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PeerView {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MessageView {
    pub from_me: bool,
    pub text: String,
    pub at: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ThreadView {
    pub id: String,
    pub peer_name: String,
    pub unread: u32,
    pub messages: Vec<MessageView>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub running: bool,
    pub code: String,
    pub status: String,
    pub device_name: String,
    pub username: String,
    pub peers: Vec<PeerView>,
    pub threads: Vec<ThreadView>,
    pub unread: u32,
    pub sending: bool,
    pub progress: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Outcome {
    Delivered,
    WrongCode,
    Locked,
    Unreachable(String),
    Failed(String),
}

#[derive(Clone, Copy, PartialEq)]
enum Decision {
    AcceptFile,
    AcceptMessage,
    Reject,
    Locked,
}

struct PeerInfo {
    name: String,
    addrs: Vec<SocketAddr>,
}

struct Thread {
    id: String,
    peer_name: String,
    unread: u32,
    messages: Vec<MessageView>,
}

struct State {
    running: bool,
    code: String,
    status: String,
    username: String,
    own_service: String,
    peers: BTreeMap<String, PeerInfo>,
    sessions: HashMap<String, Session>,
    threads: Vec<Thread>,
    limiter: AttemptLimiter,
    sending: bool,
    progress: Option<f64>,
}

struct Runtime {
    daemon: ServiceDaemon,
    port: u16,
}

struct Inner {
    state: Mutex<State>,
    downloads: PathBuf,
    default_name: String,
    notify: Box<dyn Fn(Notice) + Send + Sync>,
    stop: AtomicBool,
    runtime: Mutex<Option<Runtime>>,
}

#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}

fn new_code() -> String {
    format!("{:06}", rand::thread_rng().gen_range(0..1_000_000))
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// "Name-ab12" → "Name" (service names carry a short random suffix).
fn peer_display(id: &str) -> String {
    id.rfind('-').map_or(id.to_string(), |i| id[..i].to_string())
}

impl Engine {
    /// `downloads` is where received files go; `default_name` is this PC's name when no username is set.
    pub fn new(downloads: PathBuf, default_name: String, notify: impl Fn(Notice) + Send + Sync + 'static) -> Engine {
        Engine {
            inner: Arc::new(Inner {
                state: Mutex::new(State {
                    running: false,
                    code: new_code(),
                    status: "PairDrop is off".into(),
                    username: String::new(),
                    own_service: String::new(),
                    peers: BTreeMap::new(),
                    sessions: HashMap::new(),
                    threads: vec![],
                    limiter: AttemptLimiter::default(),
                    sending: false,
                    progress: None,
                }),
                downloads,
                default_name,
                notify: Box::new(notify),
                stop: AtomicBool::new(false),
                runtime: Mutex::new(None),
            }),
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        let s = self.inner.state.lock().unwrap();
        let device = display_name(&s.username, &self.inner.default_name);
        Snapshot {
            running: s.running,
            code: s.code.clone(),
            status: s.status.clone(),
            device_name: device,
            username: s.username.clone(),
            peers: s.peers.iter().map(|(id, p)| PeerView { id: id.clone(), name: p.name.clone() }).collect(),
            threads: s.threads.iter().map(|t| ThreadView { id: t.id.clone(), peer_name: t.peer_name.clone(), unread: t.unread, messages: t.messages.clone() }).collect(),
            unread: s.threads.iter().map(|t| t.unread).sum(),
            sending: s.sending,
            progress: s.progress,
        }
    }

    fn changed(&self) {
        (self.inner.notify)(Notice::Changed);
    }

    fn set_status(&self, text: impl Into<String>) {
        self.inner.state.lock().unwrap().status = text.into();
        self.changed();
    }

    pub fn device_name(&self) -> String {
        let s = self.inner.state.lock().unwrap();
        display_name(&s.username, &self.inner.default_name)
    }

    pub fn regenerate_code(&self) {
        self.inner.state.lock().unwrap().code = new_code();
        self.changed();
    }

    /// The port the listener is on (for tests and diagnostics).
    pub fn port(&self) -> Option<u16> {
        self.inner.runtime.lock().unwrap().as_ref().map(|r| r.port)
    }

    /// Changes the name other people see and restarts so the Bonjour name carries it.
    pub fn set_username(&self, name: &str) -> Result<(), String> {
        let cleaned = display_name(name, "");
        let (changed, running) = {
            let mut s = self.inner.state.lock().unwrap();
            let changed = s.username != cleaned;
            s.username = cleaned;
            (changed, s.running)
        };
        if changed && running {
            self.stop();
            let name = self.inner.state.lock().unwrap().username.clone();
            return self.start(&name);
        }
        self.changed();
        Ok(())
    }

    // ---------- lifecycle

    pub fn start(&self, username: &str) -> Result<(), String> {
        if self.inner.state.lock().unwrap().running {
            return Ok(());
        }
        let listener = TcpListener::bind(("0.0.0.0", 0)).map_err(|e| format!("Couldn't start PairDrop: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        self.inner.stop.store(false, Ordering::SeqCst);
        {
            let mut s = self.inner.state.lock().unwrap();
            s.username = display_name(username, "");
        }
        let device = self.device_name();
        let suffix: String = format!("{:04x}", rand::thread_rng().gen_range(0..0x10000u32));
        let mut base: String = device.chars().map(|c| if c == '.' { ' ' } else { c }).collect();
        while base.len() > 55 {
            base.pop();
        }
        let own = format!("{base}-{suffix}");
        self.inner.state.lock().unwrap().own_service = own.clone();

        // Accept loop.
        let engine = self.clone();
        thread::spawn(move || {
            while !engine.inner.stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let e = engine.clone();
                        thread::spawn(move || e.handle_incoming(stream));
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(80)),
                    Err(_) => thread::sleep(Duration::from_millis(200)),
                }
            }
        });

        // Bonjour: advertise, and browse for other copies.
        let mut note = None;
        match ServiceDaemon::new() {
            Ok(daemon) => {
                let host = format!("{}.local.", sanitize_host(&std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "notch-pc".into())));
                match ServiceInfo::new(SERVICE_TYPE, &own, &host, "", port, None::<HashMap<String, String>>) {
                    Ok(info) => {
                        if let Err(e) = daemon.register(info.enable_addr_auto()) {
                            note = Some(format!("Couldn't announce this PC on the network: {e}"));
                        }
                    }
                    Err(e) => note = Some(format!("Couldn't announce this PC on the network: {e}")),
                }
                match daemon.browse(SERVICE_TYPE) {
                    Ok(rx) => {
                        let engine = self.clone();
                        let own_name = own.clone();
                        thread::spawn(move || {
                            while let Ok(ev) = rx.recv() {
                                if engine.inner.stop.load(Ordering::SeqCst) {
                                    break;
                                }
                                match ev {
                                    ServiceEvent::ServiceResolved(info) => {
                                        let full = info.get_fullname().to_string();
                                        let Some(instance) = full.strip_suffix(&format!(".{SERVICE_TYPE}")) else { continue };
                                        if instance == own_name {
                                            continue;
                                        }
                                        let mut addrs: Vec<SocketAddr> = info
                                            .get_addresses()
                                            .iter()
                                            .filter(|ip| match ip {
                                                IpAddr::V4(_) => true,
                                                IpAddr::V6(v6) => (v6.segments()[0] & 0xffc0) != 0xfe80, // skip link-local IPv6: it needs a scope id
                                            })
                                            .map(|ip| SocketAddr::new(*ip, info.get_port()))
                                            .collect();
                                        addrs.sort_by_key(|a| (a.is_ipv6(), a.ip().to_string()));
                                        engine.inner.state.lock().unwrap().peers.insert(instance.to_string(), PeerInfo { name: peer_display(instance), addrs });
                                        engine.changed();
                                    }
                                    ServiceEvent::ServiceRemoved(_, full) => {
                                        if let Some(instance) = full.strip_suffix(&format!(".{SERVICE_TYPE}")) {
                                            engine.inner.state.lock().unwrap().peers.remove(instance);
                                            engine.changed();
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        });
                    }
                    Err(e) => note = Some(format!("Couldn't look for other devices: {e}")),
                }
                *self.inner.runtime.lock().unwrap() = Some(Runtime { daemon, port });
            }
            Err(e) => {
                note = Some(format!("Couldn't start device discovery: {e}"));
                *self.inner.runtime.lock().unwrap() = Some(Runtime { daemon: ServiceDaemon::new().map_err(|_| e.to_string())?, port });
            }
        }
        {
            let mut s = self.inner.state.lock().unwrap();
            s.running = true;
            s.status = note.unwrap_or_else(|| format!("Ready to receive as {device}"));
        }
        self.changed();
        Ok(())
    }

    pub fn stop(&self) {
        self.inner.stop.store(true, Ordering::SeqCst);
        if let Some(rt) = self.inner.runtime.lock().unwrap().take() {
            let _ = rt.daemon.shutdown();
        }
        {
            let mut s = self.inner.state.lock().unwrap();
            s.running = false;
            s.peers.clear();
            s.status = "PairDrop is off".into();
        }
        self.changed();
    }

    /// For tests: pretend a device was found at `addr`.
    pub fn add_peer(&self, id: &str, addr: SocketAddr) {
        self.inner.state.lock().unwrap().peers.insert(id.to_string(), PeerInfo { name: peer_display(id), addrs: vec![addr] });
        self.changed();
    }

    // ---------- receiving

    fn evaluate(&self, h: &Header) -> Decision {
        let (decision, notice) = {
            let mut s = self.inner.state.lock().unwrap();
            let now = Instant::now();
            if s.limiter.is_locked(now) {
                return Decision::Locked;
            }
            match h.kind {
                Kind::File => {
                    if h.code != s.code {
                        s.limiter.record_failure(now);
                        return Decision::Reject;
                    }
                    s.limiter.record_success();
                    s.status = format!("Receiving {} from {}…", safe_file_name(&h.file_name), h.sender);
                    (Decision::AcceptFile, None)
                }
                Kind::Hello => {
                    if h.code != s.code || h.sender_service.is_empty() || !is_valid_code(&h.reply_code) {
                        s.limiter.record_failure(now);
                        return Decision::Reject;
                    }
                    s.limiter.record_success();
                    let code = s.code.clone();
                    s.sessions.insert(
                        h.sender_service.clone(),
                        Session { peer_service: h.sender_service.clone(), peer_name: h.sender.clone(), send_code: h.reply_code.clone(), expect_code: code },
                    );
                    if !s.threads.iter().any(|t| t.id == h.sender_service) {
                        s.threads.push(Thread { id: h.sender_service.clone(), peer_name: h.sender.clone(), unread: 0, messages: vec![] });
                    }
                    s.status = format!("{} started a chat with you.", h.sender);
                    (Decision::AcceptMessage, Some(Notice::Message { from: h.sender.clone(), text: String::new() }))
                }
                Kind::Message => {
                    if !authorised(h, &s.sessions) {
                        s.limiter.record_failure(now);
                        return Decision::Reject;
                    }
                    let text = clamp_message(&h.text);
                    if text.is_empty() {
                        return Decision::AcceptMessage;
                    }
                    push_message(&mut s.threads, &h.sender_service, &h.sender, false, &text, true);
                    (Decision::AcceptMessage, Some(Notice::Message { from: h.sender.clone(), text }))
                }
            }
        };
        if let Some(n) = notice {
            (self.inner.notify)(n);
        }
        self.changed();
        decision
    }

    fn handle_incoming(&self, mut stream: TcpStream) {
        // The listener is non-blocking (so it can be stopped), and some systems hand that to every accepted
        // connection. Reads must wait for data, or a big upload is cut off the moment the sender pauses.
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_nodelay(true);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
        let mut len = [0u8; 4];
        if stream.read_exact(&mut len).is_err() {
            return;
        }
        let Some(n) = frame_length(len) else { return };
        let mut buf = vec![0u8; n];
        if stream.read_exact(&mut buf).is_err() {
            return;
        }
        let Some(h) = decode(&buf) else { return };
        match self.evaluate(&h) {
            Decision::Reject => {
                let _ = stream.write_all(&[0]);
            }
            Decision::Locked => {
                let _ = stream.write_all(&[2]);
            }
            Decision::AcceptMessage => {
                let _ = stream.write_all(&[1]);
            }
            Decision::AcceptFile => {
                if stream.write_all(&[1]).is_err() {
                    return;
                }
                let ok = self.receive_body(&mut stream, &h);
                let _ = stream.write_all(&[if ok { 1 } else { 0 }]);
            }
        }
        let _ = stream.flush();
    }

    /// Streams the file to a temporary name in Downloads, then moves it to a safe unused name.
    fn receive_body(&self, stream: &mut TcpStream, h: &Header) -> bool {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
        let part = self.inner.downloads.join(format!(".notchapple-{:016x}.part", rand::thread_rng().gen::<u64>()));
        let result = (|| -> Result<(), String> {
            std::fs::create_dir_all(&self.inner.downloads).map_err(|e| e.to_string())?;
            let mut file = std::fs::File::create(&part).map_err(|_| "Couldn't make room for the file.".to_string())?;
            let mut left = h.size;
            let mut buf = vec![0u8; CHUNK];
            while left > 0 {
                let want = left.min(CHUNK as u64) as usize;
                let got = stream.read(&mut buf[..want]).map_err(|_| "The connection dropped before the file finished.".to_string())?;
                if got == 0 {
                    return Err("The connection dropped before the file finished.".into());
                }
                file.write_all(&buf[..got]).map_err(|_| "The disk is full or not writable.".to_string())?;
                left -= got as u64;
            }
            file.flush().map_err(|e| e.to_string())
        })();
        match result {
            Ok(()) => {
                let base = safe_file_name(&h.file_name);
                let name = unique_name(&base, |n| self.inner.downloads.join(n).exists());
                let dest = self.inner.downloads.join(&name);
                if std::fs::rename(&part, &dest).is_err() {
                    let _ = std::fs::remove_file(&part);
                    self.set_status(format!("Couldn't save {base}."));
                    return false;
                }
                self.set_status(format!("Received {name} from {}. Saved to Downloads.", h.sender));
                (self.inner.notify)(Notice::Received { name, from: h.sender.clone() });
                true
            }
            Err(why) => {
                let _ = std::fs::remove_file(&part);
                self.set_status(format!("Receiving {} failed: {why}", safe_file_name(&h.file_name)));
                false
            }
        }
    }

    // ---------- sending

    fn targets(&self, peer: Option<&str>) -> Vec<(String, String, Vec<SocketAddr>)> {
        let s = self.inner.state.lock().unwrap();
        s.peers
            .iter()
            .filter(|(id, _)| peer.map_or(true, |p| p == id.as_str()))
            .map(|(id, p)| (id.clone(), p.name.clone(), p.addrs.clone()))
            .collect()
    }

    /// Sends files (folders are zipped) to whichever nearby device is showing `code`.
    pub fn send(&self, paths: Vec<PathBuf>, code: &str, peer: Option<&str>) {
        if paths.is_empty() || self.inner.state.lock().unwrap().sending {
            return;
        }
        if !is_valid_code(code) {
            return self.set_status("Type the 6-digit code shown on the other device.");
        }
        let targets = self.targets(peer);
        if targets.is_empty() {
            return self.set_status("No devices found. Make sure the other device has PairDrop open and is on the same Wi-Fi.");
        }
        {
            let mut s = self.inner.state.lock().unwrap();
            s.sending = true;
            s.progress = None;
        }
        let engine = self.clone();
        let code = code.to_string();
        thread::spawn(move || {
            engine.send_all(paths, &code, targets);
            let mut s = engine.inner.state.lock().unwrap();
            s.sending = false;
            s.progress = None;
            drop(s);
            engine.changed();
        });
    }

    fn send_all(&self, paths: Vec<PathBuf>, code: &str, targets: Vec<(String, String, Vec<SocketAddr>)>) {
        let (own_service, device) = {
            let s = self.inner.state.lock().unwrap();
            (s.own_service.clone(), display_name(&s.username, &self.inner.default_name))
        };
        let total = paths.len();
        let mut known: Option<usize> = None; // once one device accepts, the rest of the files go straight to it
        for (n, path) in paths.iter().enumerate() {
            let shown = path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
            let label = if total > 1 { format!("{shown} ({} of {total})", n + 1) } else { shown.clone() };
            self.set_status(format!("Preparing {label}…"));
            let Some((file, name, temporary)) = prepare(path) else {
                return self.set_status(format!("Couldn't read {shown}."));
            };
            let size = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
            let mut delivered = false;
            let mut saw_wrong = false;
            let mut last_problem: Option<String> = None;
            let order: Vec<usize> = known.map(|k| vec![k]).unwrap_or_else(|| (0..targets.len()).collect());
            for idx in order {
                let (_, peer_name, addrs) = &targets[idx];
                self.set_status(format!("Sending {label}…"));
                let mut h = Header::new(Kind::File, code, &device);
                h.file_name = name.clone();
                h.size = size;
                h.sender_service = own_service.clone();
                let this = self.clone();
                let outcome = transfer(addrs, &h, Some(&file), &move |p| {
                    this.inner.state.lock().unwrap().progress = Some(p);
                    this.changed();
                }, Duration::from_secs(15), Duration::from_secs(30));
                match outcome {
                    Outcome::Delivered => {
                        delivered = true;
                        known = Some(idx);
                        self.set_status(format!("Sent {label} to {peer_name}."));
                    }
                    Outcome::WrongCode => saw_wrong = true,
                    Outcome::Locked => {
                        if temporary { let _ = std::fs::remove_file(&file); }
                        return self.set_status(format!("{peer_name} is locked after too many wrong codes. Wait a minute and try again."));
                    }
                    Outcome::Unreachable(why) | Outcome::Failed(why) => last_problem = Some(why),
                }
                if delivered {
                    break;
                }
            }
            if temporary {
                let _ = std::fs::remove_file(&file);
            }
            if !delivered {
                return self.set_status(if saw_wrong {
                    format!("No device accepted code {code}. Check the code on the receiving device.")
                } else {
                    last_problem.unwrap_or_else(|| "Couldn't reach the other device. Check you're on the same Wi-Fi.".into())
                });
            }
        }
    }

    // ---------- chat

    /// Opens a private chat with whoever is showing `code`. The chat appears on both devices.
    pub fn start_chat(&self, code: &str, peer: Option<&str>) {
        if !is_valid_code(code) {
            return self.set_status("Type the 6-digit code shown on the other device.");
        }
        let targets = self.targets(peer);
        if targets.is_empty() {
            return self.set_status("No devices found on this Wi-Fi.");
        }
        let engine = self.clone();
        let code = code.to_string();
        thread::spawn(move || {
            let (own_service, device) = {
                let s = engine.inner.state.lock().unwrap();
                (s.own_service.clone(), display_name(&s.username, &engine.inner.default_name))
            };
            let mine = new_code(); // what they must put on messages to me
            let mut saw_wrong = false;
            for (id, name, addrs) in targets {
                let mut h = Header::new(Kind::Hello, &code, &device);
                h.sender_service = own_service.clone();
                h.reply_code = mine.clone();
                match transfer(&addrs, &h, None, &|_| {}, Duration::from_secs(15), Duration::from_secs(30)) {
                    Outcome::Delivered => {
                        {
                            let mut s = engine.inner.state.lock().unwrap();
                            s.sessions.insert(id.clone(), Session { peer_service: id.clone(), peer_name: name.clone(), send_code: code.clone(), expect_code: mine.clone() });
                            if !s.threads.iter().any(|t| t.id == id) {
                                s.threads.push(Thread { id: id.clone(), peer_name: name.clone(), unread: 0, messages: vec![] });
                            }
                        }
                        return engine.set_status(format!("Chat with {name} is open."));
                    }
                    Outcome::WrongCode => saw_wrong = true,
                    Outcome::Locked => return engine.set_status(format!("{name} is locked after too many wrong codes. Wait a minute.")),
                    _ => {}
                }
            }
            engine.set_status(if saw_wrong { format!("No device accepted code {code}. Check the code on the other device.") } else { "Couldn't reach the other device.".into() });
        });
    }

    pub fn send_message(&self, thread_id: &str, text: &str) {
        let text = clamp_message(text);
        if text.is_empty() {
            return;
        }
        let (session, addrs, own_service, device) = {
            let s = self.inner.state.lock().unwrap();
            let Some(session) = s.sessions.get(thread_id).cloned() else { return };
            (session, s.peers.get(thread_id).map(|p| p.addrs.clone()), s.own_service.clone(), display_name(&s.username, &self.inner.default_name))
        };
        let Some(addrs) = addrs else {
            return self.set_status(format!("{} isn't nearby right now.", session.peer_name));
        };
        let engine = self.clone();
        let thread_id = thread_id.to_string();
        thread::spawn(move || {
            let mut h = Header::new(Kind::Message, &session.send_code, &device);
            h.sender_service = own_service;
            h.text = text.clone();
            if transfer(&addrs, &h, None, &|_| {}, Duration::from_secs(15), Duration::from_secs(30)) == Outcome::Delivered {
                push_message(&mut engine.inner.state.lock().unwrap().threads, &thread_id, &session.peer_name, true, &text, false);
                engine.changed();
            } else {
                engine.set_status(format!("Couldn't deliver that message to {}.", session.peer_name));
            }
        });
    }

    pub fn mark_read(&self, thread_id: &str) {
        if let Some(t) = self.inner.state.lock().unwrap().threads.iter_mut().find(|t| t.id == thread_id) {
            t.unread = 0;
        }
        self.changed();
    }

    pub fn close_chat(&self, thread_id: &str) {
        {
            let mut s = self.inner.state.lock().unwrap();
            s.sessions.remove(thread_id);
            s.threads.retain(|t| t.id != thread_id);
        }
        self.changed();
    }
}

fn push_message(threads: &mut Vec<Thread>, id: &str, peer_name: &str, from_me: bool, text: &str, unread: bool) {
    let m = MessageView { from_me, text: text.to_string(), at: now_secs() };
    if let Some(t) = threads.iter_mut().find(|t| t.id == id) {
        t.messages.push(m);
        if unread {
            t.unread += 1;
        }
    } else {
        threads.push(Thread { id: id.to_string(), peer_name: peer_name.to_string(), unread: u32::from(unread), messages: vec![m] });
    }
}

fn sanitize_host(raw: &str) -> String {
    let s: String = raw.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' }).collect();
    if s.is_empty() { "notch-pc".into() } else { s }
}

/// A file as it is; a folder as a temporary zip (made with the `tar` that ships with Windows 10 and later, and macOS).
fn prepare(path: &Path) -> Option<(PathBuf, String, bool)> {
    let meta = std::fs::metadata(path).ok()?;
    let name = path.file_name()?.to_string_lossy().to_string();
    if !meta.is_dir() {
        std::fs::File::open(path).ok()?;
        return Some((path.to_path_buf(), name, false));
    }
    let zip = std::env::temp_dir().join(format!("{name}-{:06x}.zip", rand::thread_rng().gen_range(0..0xFFFFFFu32)));
    let status = std::process::Command::new("tar")
        .args(["-a", "-c", "-f"])
        .arg(&zip)
        .arg("-C")
        .arg(path.parent()?)
        .arg(&name)
        .status()
        .ok()?;
    status.success().then(|| (zip, format!("{name}.zip"), true))
}

/// One outgoing connection: header, wait for the answer, stream the file, wait for "saved". The timeouts are for
/// silence, not for the whole transfer, so a big file on a slow network still gets through.
pub fn transfer(addrs: &[SocketAddr], header: &Header, file: Option<&Path>, progress: &dyn Fn(f64), handshake: Duration, stall: Duration) -> Outcome {
    let Some(frame) = encode(header) else { return Outcome::Failed("That's too long to send.".into()) };
    let mut last = String::from("No address to try.");
    let mut stream = None;
    for addr in addrs {
        match TcpStream::connect_timeout(addr, Duration::from_secs(5)) {
            Ok(s) => {
                stream = Some(s);
                break;
            }
            Err(e) => last = format!("Couldn't connect: {e}"),
        }
    }
    let Some(mut s) = stream else { return Outcome::Unreachable(last) };
    let _ = s.set_nodelay(true);
    let _ = s.set_write_timeout(Some(stall));
    let _ = s.set_read_timeout(Some(handshake));
    if let Err(e) = s.write_all(&frame) {
        return Outcome::Unreachable(format!("Send failed: {e}"));
    }
    let mut answer = [0u8; 1];
    match s.read_exact(&mut answer) {
        Ok(()) => {}
        Err(e) if matches!(e.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock) => return Outcome::Unreachable("The other device didn't answer.".into()),
        Err(_) => return Outcome::Unreachable("No answer from the other device.".into()),
    }
    match answer[0] {
        1 => {}
        2 => return Outcome::Locked,
        0 => return Outcome::WrongCode,
        _ => return Outcome::Unreachable("No answer from the other device.".into()),
    }
    let Some(path) = file else { return Outcome::Delivered }; // a chat frame: accepted means delivered
    let Ok(mut f) = std::fs::File::open(path) else { return Outcome::Failed("Couldn't read the file.".into()) };
    let size = header.size;
    let mut sent: u64 = 0;
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = match f.read(&mut buf) {
            Ok(n) => n,
            Err(e) => return Outcome::Failed(format!("Couldn't read the file: {e}")),
        };
        if n == 0 {
            break;
        }
        if let Err(e) = s.write_all(&buf[..n]) {
            return Outcome::Failed(if matches!(e.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock) { "The transfer stalled.".into() } else { format!("Send failed: {e}") });
        }
        sent += n as u64;
        progress(if size > 0 { (sent as f64 / size as f64).min(1.0) } else { 1.0 });
    }
    if sent != size {
        return Outcome::Failed("The file changed while it was being sent.".into());
    }
    let _ = s.set_read_timeout(Some(stall.max(Duration::from_secs(60))));
    let mut ack = [0u8; 1];
    match s.read_exact(&mut ack) {
        // An explicit 0 means the receiver failed. Older versions just close the connection once they have saved the
        // file, so a closed connection after every byte was sent counts as delivered.
        Ok(()) if ack[0] == 0 => Outcome::Failed("The other device couldn't save the file.".into()),
        Ok(()) => Outcome::Delivered,
        Err(e) if matches!(e.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock) => Outcome::Unreachable("The other device didn't confirm it saved the file.".into()),
        Err(_) => Outcome::Delivered,
    }
}
