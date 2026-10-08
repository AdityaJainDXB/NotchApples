//! PairDrop for Notch apple: serverless file sharing and private chat on the local network. Speaks the same
//! protocol as the Mac app and advertises itself over Bonjour (`_notchapple._tcp`), so a Mac and a PC find each
//! other. No Tauri or Windows code in here, so it is tested on any machine (see tests/).

pub mod engine;
pub mod protocol;

pub use engine::{Engine, Notice, Outcome, Snapshot};
