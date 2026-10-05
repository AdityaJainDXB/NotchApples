//! Keep Awake.
//!
//! Windows ties `SetThreadExecutionState` to the thread that called it: the
//! request ends when that thread exits, and a Tauri command can run on any
//! thread. So one long-lived thread owns the request for the whole session.

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

/// 0 off, 1 system only (the screen may turn off), 2 system and display.
static MODE: AtomicU8 = AtomicU8::new(0);

fn worker() -> &'static Mutex<Sender<u8>> {
    static TX: OnceLock<Mutex<Sender<u8>>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, rx) = channel::<u8>();
        let _ = std::thread::Builder::new().name("keep-awake".into()).spawn(move || {
            #[cfg(not(windows))]
            let mut child: Option<std::process::Child> = None;
            for mode in rx {
                #[cfg(windows)]
                apply(mode);
                #[cfg(not(windows))]
                {
                    if let Some(mut c) = child.take() {
                        let _ = c.kill();
                    }
                    if mode > 0 {
                        let flag = if mode == 2 { "-d" } else { "-i" };
                        child = std::process::Command::new("/usr/bin/caffeinate").arg(flag).spawn().ok();
                    }
                }
            }
        });
        Mutex::new(tx)
    })
}

#[cfg(windows)]
fn apply(mode: u8) {
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };
    let flags = match mode {
        0 => ES_CONTINUOUS,
        1 => ES_CONTINUOUS | ES_SYSTEM_REQUIRED,
        _ => ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED,
    };
    unsafe {
        SetThreadExecutionState(flags);
    }
}

/// `display`: also keep the screen on (otherwise only stop the PC sleeping).
#[tauri::command]
pub fn set_keep_awake(on: bool, display: Option<bool>) -> Result<(), String> {
    let mode = if !on { 0 } else if display.unwrap_or(true) { 2 } else { 1 };
    MODE.store(mode, Ordering::Relaxed);
    worker().lock().map_err(|e| e.to_string())?.send(mode).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn keep_awake_state() -> u8 {
    MODE.load(Ordering::Relaxed)
}
