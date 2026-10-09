//! Klick (Pro): tells the page when a key goes down or up anywhere on the PC, so it can play a mechanical keyboard
//! sound. Only while Klick is switched on, and only the kind of key (an ordinary key, the space bar or Enter) is
//! sent: which key it was, and anything you type, is never read, kept or sent anywhere. A held key repeats, but a
//! real switch only clicks once, so repeats are ignored.
//!
//! A low-level keyboard hook on its own thread. The hook only notices keys; it never blocks or changes them.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static ON: AtomicBool = AtomicBool::new(false);
static STARTED: AtomicBool = AtomicBool::new(false);
static APP: OnceLock<AppHandle> = OnceLock::new();

#[derive(Serialize, Clone)]
pub struct KeyEvent {
    pub down: bool,
    /// "key", "space" or "enter".
    pub kind: &'static str,
}

/// Switches the hook on or off (it is installed the first time Klick is switched on, then just ignored while off).
#[tauri::command]
pub fn klick_set(app: AppHandle, on: bool) {
    let _ = APP.set(app);
    ON.store(on, Ordering::Relaxed);
    if on && !STARTED.swap(true, Ordering::Relaxed) {
        #[cfg(windows)]
        hook::start(notify);
    }
}

fn notify(down: bool, kind: &'static str) {
    if !ON.load(Ordering::Relaxed) {
        return;
    }
    if let Some(app) = APP.get() {
        let _ = app.emit("klick", KeyEvent { down, kind });
    }
}

/// The Windows part, kept free of Tauri so it can be checked on its own.
#[cfg(windows)]
pub mod hook {
    use std::collections::HashSet;
    use std::sync::{Mutex, OnceLock};
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP,
        WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    type Notify = fn(bool, &'static str);
    static NOTIFY: OnceLock<Notify> = OnceLock::new();
    static HELD: Mutex<Option<HashSet<u32>>> = Mutex::new(None);

    pub fn start(notify: Notify) {
        let _ = NOTIFY.set(notify);
        std::thread::spawn(|| unsafe {
            // A low-level hook is called on this thread, which must keep pumping messages.
            if SetWindowsHookExW(WH_KEYBOARD_LL, Some(on_key), None, 0).is_err() {
                return;
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
        });
    }

    /// The kind of key, from its virtual-key code.
    pub fn kind(vk: u32) -> &'static str {
        match vk {
            0x20 => "space",
            0x0D => "enter",
            _ => "key",
        }
    }

    unsafe extern "system" fn on_key(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            let msg = wparam.0 as u32;
            let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
            let up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
            if down || up {
                let fresh = {
                    let mut held = HELD.lock().unwrap_or_else(|e| e.into_inner());
                    let set = held.get_or_insert_with(HashSet::new);
                    if down { set.insert(info.vkCode) } else { set.remove(&info.vkCode) }
                };
                if fresh {
                    if let Some(notify) = NOTIFY.get() {
                        notify(down, kind(info.vkCode));
                    }
                }
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }
}
