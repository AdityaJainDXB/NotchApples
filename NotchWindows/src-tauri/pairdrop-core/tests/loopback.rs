//! Real transfers between two engines over TCP on this machine: a big file, an empty file, a folder, wrong codes and
//! the lockout, chat and who may send it, a device that never answers, a receiver that can't save, and an older
//! version's receiver. The last test checks discovery: two copies finding each other over Bonjour.

use pairdrop_core::protocol::*;
use pairdrop_core::{engine::transfer, Engine, Outcome};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

fn temp_dir(tag: &str) -> PathBuf {
    static N: AtomicUsize = AtomicUsize::new(0);
    let d = std::env::temp_dir().join(format!("pd-core-{tag}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// A started engine with its own Downloads folder, reachable at 127.0.0.1:port.
fn engine(tag: &str) -> (Engine, SocketAddr, PathBuf) {
    let downloads = temp_dir(tag);
    let e = Engine::new(downloads.clone(), format!("{tag}-pc"), |_| {});
    e.start(tag).unwrap();
    let addr: SocketAddr = format!("127.0.0.1:{}", e.port().unwrap()).parse().unwrap();
    (e, addr, downloads)
}

fn wait_for(what: &str, mut cond: impl FnMut() -> bool) {
    let t = Instant::now();
    while t.elapsed() < Duration::from_secs(20) {
        if cond() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("timed out waiting for: {what}");
}

fn file_header(code: &str, name: &str, size: u64) -> Header {
    let mut h = Header::new(Kind::File, code, "Tester");
    h.file_name = name.into();
    h.size = size;
    h.sender_service = "Tester-0001".into();
    h
}

fn send_file(to: SocketAddr, code: &str, name: &str, data: &[u8]) -> Outcome {
    let src = temp_dir("src").join(name);
    std::fs::write(&src, data).unwrap();
    transfer(&[to], &file_header(code, name, data.len() as u64), Some(&src), &|_| {}, Duration::from_secs(5), Duration::from_secs(10))
}

#[test]
fn a_small_file_arrives_intact() {
    let (rx, addr, dl) = engine("a");
    let code = rx.snapshot().code;
    assert_eq!(send_file(addr, &code, "note.txt", b"hello PairDrop\n"), Outcome::Delivered);
    assert_eq!(std::fs::read(dl.join("note.txt")).unwrap(), b"hello PairDrop\n");
    assert!(rx.snapshot().status.contains("Received note.txt"));
    rx.stop();
}

#[test]
fn an_empty_file_arrives_empty() {
    let (rx, addr, dl) = engine("b");
    let code = rx.snapshot().code;
    assert_eq!(send_file(addr, &code, "empty.txt", b""), Outcome::Delivered);
    assert_eq!(std::fs::read(dl.join("empty.txt")).unwrap().len(), 0);
    rx.stop();
}

#[test]
fn forty_megabytes_arrive_intact_with_progress() {
    let (rx, addr, dl) = engine("c");
    let code = rx.snapshot().code;
    let data: Vec<u8> = (0..40 * 1024 * 1024u32).map(|i| (i % 251) as u8).collect();
    let src = temp_dir("src").join("big.bin");
    std::fs::write(&src, &data).unwrap();
    let ticks = Arc::new(std::sync::Mutex::new(Vec::<f64>::new()));
    let t2 = ticks.clone();
    let out = transfer(&[addr], &file_header(&code, "big.bin", data.len() as u64), Some(&src), &move |p| t2.lock().unwrap().push(p), Duration::from_secs(5), Duration::from_secs(10));
    assert_eq!(out, Outcome::Delivered);
    assert!(std::fs::read(dl.join("big.bin")).unwrap() == data, "bytes differ");
    let t = ticks.lock().unwrap();
    assert!(t.len() > 10 && *t.last().unwrap() == 1.0 && t.windows(2).all(|w| w[0] <= w[1]));
    rx.stop();
}

#[test]
fn a_taken_name_gets_a_number_and_a_bad_name_is_made_safe() {
    let (rx, addr, dl) = engine("d");
    let code = rx.snapshot().code;
    assert_eq!(send_file(addr, &code, "a.txt", b"1"), Outcome::Delivered);
    assert_eq!(send_file(addr, &code, "a.txt", b"2"), Outcome::Delivered);
    assert_eq!(std::fs::read(dl.join("1-a.txt")).unwrap(), b"2");
    let h = file_header(&code, "../../escape.txt", 1);
    let src = temp_dir("src").join("x");
    std::fs::write(&src, b"x").unwrap();
    assert_eq!(transfer(&[addr], &h, Some(&src), &|_| {}, Duration::from_secs(5), Duration::from_secs(10)), Outcome::Delivered);
    assert!(dl.join("escape.txt").exists());
    rx.stop();
}

#[test]
fn a_wrong_code_is_refused_and_five_lock_even_the_right_one() {
    let (rx, addr, dl) = engine("e");
    let code = rx.snapshot().code;
    assert_eq!(send_file(addr, "000000", "x.txt", b"1"), Outcome::WrongCode);
    assert!(!dl.join("x.txt").exists());
    for _ in 0..4 {
        let _ = send_file(addr, "000000", "x.txt", b"1");
    }
    assert_eq!(send_file(addr, &code, "x.txt", b"1"), Outcome::Locked);
    rx.stop();
}

#[test]
fn a_folder_is_sent_as_a_zip() {
    let (rx, addr, dl) = engine("f");
    let (sender, _, _) = engine("f2");
    sender.add_peer("f-pc-ab12", addr);
    let folder = temp_dir("folder").join("Photos");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("one.txt"), "1").unwrap();
    sender.send(vec![folder], &rx.snapshot().code, None);
    wait_for("the zip to arrive", || dl.join("Photos.zip").exists() && !sender.snapshot().sending);
    assert!(std::fs::metadata(dl.join("Photos.zip")).unwrap().len() > 0);
    rx.stop();
    sender.stop();
}

#[test]
fn the_send_api_reports_what_happened() {
    let (rx, addr, dl) = engine("g");
    let (tx, _, _) = engine("g2");
    tx.add_peer("g-pc-1234", addr);
    let src = temp_dir("src").join("two.txt");
    std::fs::write(&src, "two").unwrap();
    tx.send(vec![src], &rx.snapshot().code, None);
    wait_for("the file", || dl.join("two.txt").exists() && !tx.snapshot().sending);
    assert!(tx.snapshot().status.starts_with("Sent two.txt to g-pc"), "{}", tx.snapshot().status);
    // A wrong code reads as a wrong code, not as "can't reach".
    let src2 = temp_dir("src").join("three.txt");
    std::fs::write(&src2, "3").unwrap();
    tx.send(vec![src2], "000001", None);
    wait_for("the wrong-code message", || tx.snapshot().status.contains("No device accepted code 000001") && !tx.snapshot().sending);
    rx.stop();
    tx.stop();
}

#[test]
fn chat_needs_the_code_then_works_both_ways() {
    let (a, a_addr, _) = engine("h");
    let (b, b_addr, _) = engine("h2");
    a.add_peer("h2-pc-bbbb", b_addr);
    b.add_peer("h-pc-aaaa", a_addr);
    // A messages B before any chat exists: refused.
    let rogue = Header { kind: Kind::Message, code: b.snapshot().code, sender: "A".into(), sender_service: "h-pc-aaaa".into(), text: "hi".into(), ..Default::default() };
    assert_eq!(transfer(&[b_addr], &rogue, None, &|_| {}, Duration::from_secs(5), Duration::from_secs(5)), Outcome::WrongCode);
    // Open the chat with B's code.
    a.start_chat(&b.snapshot().code, None);
    wait_for("the chat to open on both sides", || !a.snapshot().threads.is_empty() && !b.snapshot().threads.is_empty());
    let a_thread = a.snapshot().threads[0].id.clone();
    a.send_message(&a_thread, "hello there");
    wait_for("the message to arrive", || b.snapshot().threads.iter().any(|t| t.messages.iter().any(|m| m.text == "hello there")));
    assert_eq!(b.snapshot().unread, 1);
    b.mark_read(&b.snapshot().threads[0].id);
    assert_eq!(b.snapshot().unread, 0);
    a.stop();
    b.stop();
}

#[test]
fn a_silent_device_times_out_instead_of_hanging() {
    let silent = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = silent.local_addr().unwrap();
    std::thread::spawn(move || {
        let _held: Vec<_> = silent.incoming().take(1).filter_map(Result::ok).collect(); // accepts, never answers
        std::thread::sleep(Duration::from_secs(30));
    });
    let t = Instant::now();
    let src = temp_dir("src").join("s.txt");
    std::fs::write(&src, "s").unwrap();
    let out = transfer(&[addr], &file_header("123456", "s.txt", 1), Some(&src), &|_| {}, Duration::from_secs(2), Duration::from_secs(5));
    assert!(matches!(out, Outcome::Unreachable(_)), "{out:?}");
    assert!(t.elapsed() < Duration::from_secs(5));
}

#[test]
fn a_closed_port_is_unreachable() {
    let out = transfer(&["127.0.0.1:9".parse().unwrap()], &file_header("123456", "x", 0), None, &|_| {}, Duration::from_secs(2), Duration::from_secs(2));
    assert!(matches!(out, Outcome::Unreachable(_)), "{out:?}");
}

#[test]
fn a_receiver_that_cannot_save_is_reported_as_failed() {
    // Downloads is a file, so nothing can be written under it.
    let blocker = temp_dir("blk").join("not-a-folder");
    std::fs::write(&blocker, "x").unwrap();
    let rx = Engine::new(blocker, "z-pc".into(), |_| {});
    rx.start("z").unwrap();
    let addr: SocketAddr = format!("127.0.0.1:{}", rx.port().unwrap()).parse().unwrap();
    let out = send_file(addr, &rx.snapshot().code, "x.txt", b"abc");
    assert!(matches!(out, Outcome::Failed(_)), "{out:?}");
    rx.stop();
}

#[test]
fn an_older_receiver_that_just_closes_still_counts_as_delivered() {
    let old = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = old.local_addr().unwrap();
    let got = Arc::new(AtomicUsize::new(0));
    let g2 = got.clone();
    std::thread::spawn(move || {
        let (mut s, _) = old.accept().unwrap();
        let mut len = [0u8; 4];
        s.read_exact(&mut len).unwrap();
        let mut hdr = vec![0u8; frame_length(len).unwrap()];
        s.read_exact(&mut hdr).unwrap();
        let h = decode(&hdr).unwrap();
        s.write_all(&[1]).unwrap();
        let mut left = h.size as usize;
        let mut buf = vec![0u8; 65536];
        while left > 0 {
            let n = s.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            left -= n.min(left);
        }
        g2.store(h.size as usize - left, Ordering::SeqCst);
        // closes without confirming
    });
    let body = vec![7u8; 300_000];
    assert_eq!(send_file(addr, "123456", "old.bin", &body), Outcome::Delivered);
    wait_for("the old receiver to finish", || got.load(Ordering::SeqCst) == body.len());
}

#[test]
#[ignore = "needs multicast on the network, which CI machines may not allow: run with --include-ignored"]
fn two_copies_find_each_other_over_bonjour() {
    let (a, _, _) = engine("Alice");
    let (b, _, dl) = engine("Bob");
    wait_for("each copy to see the other", || a.snapshot().peers.iter().any(|p| p.name == "Bob") && b.snapshot().peers.iter().any(|p| p.name == "Alice"));
    let src = temp_dir("src").join("via-bonjour.txt");
    std::fs::write(&src, "found you").unwrap();
    a.send(vec![src], &b.snapshot().code, None);
    wait_for("the file to arrive through discovery", || dl.join("via-bonjour.txt").exists() && !a.snapshot().sending);
    assert_eq!(std::fs::read(dl.join("via-bonjour.txt")).unwrap(), b"found you");
    a.stop();
    b.stop();
}
