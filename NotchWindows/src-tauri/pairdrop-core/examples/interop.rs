//! Interop helper for scripts/run-pairdrop-interop.sh: the Windows engine against the Mac's Swift code.
//!   interop serve <downloadsDir>            starts an engine, prints "PORT n" and "CODE c", runs until killed
//!   interop send <port> <code> <file>       sends a file to 127.0.0.1:port
//!   interop hello <port> <code>             opens a chat
//!   interop message <port> <chatCode> <text> sends a chat message as service "Win-0001"
use pairdrop_core::protocol::*;
use pairdrop_core::{engine::transfer, Engine, Outcome};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let addr = |p: &str| -> SocketAddr { format!("127.0.0.1:{p}").parse().unwrap() };
    let done = |o: Outcome| {
        println!("RESULT {o:?}");
        std::process::exit(if o == Outcome::Delivered { 0 } else { 1 });
    };
    match a[1].as_str() {
        "serve" => {
            let e = Engine::new(PathBuf::from(&a[2]), "WinTest".into(), |n| {
                if let pairdrop_core::Notice::Message { from, text } = n {
                    if !text.is_empty() { println!("MESSAGE {from}: {text}"); }
                }
            });
            e.start("WinTest").unwrap();
            println!("PORT {}", e.port().unwrap());
            println!("CODE {}", e.snapshot().code);
            loop { std::thread::sleep(Duration::from_millis(200)); }
        }
        "send" => {
            let path = PathBuf::from(&a[4]);
            let mut h = Header::new(Kind::File, &a[3], "Win");
            h.file_name = path.file_name().unwrap().to_string_lossy().to_string();
            h.size = std::fs::metadata(&path).unwrap().len();
            h.sender_service = "Win-0001".into();
            done(transfer(&[addr(&a[2])], &h, Some(&path), &|_| {}, Duration::from_secs(10), Duration::from_secs(20)));
        }
        "hello" => {
            let mut h = Header::new(Kind::Hello, &a[3], "Win");
            h.sender_service = "Win-0001".into();
            h.reply_code = "654321".into();
            done(transfer(&[addr(&a[2])], &h, None, &|_| {}, Duration::from_secs(10), Duration::from_secs(20)));
        }
        "message" => {
            let mut h = Header::new(Kind::Message, &a[3], "Win");
            h.sender_service = "Win-0001".into();
            h.text = a[4].clone();
            done(transfer(&[addr(&a[2])], &h, None, &|_| {}, Duration::from_secs(10), Duration::from_secs(20)));
        }
        _ => { eprintln!("unknown mode"); std::process::exit(2); }
    }
}
