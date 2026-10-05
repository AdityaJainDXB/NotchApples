//! Pasting into the app you were using: Snippets, clipboard history and the AI
//! "Paste" button put text on the clipboard, give focus back to that app and
//! press Ctrl+V for you.

#[tauri::command]
pub async fn paste_text(text: String) -> Result<(), String> {
    crate::clip::clipboard_copy_text(text)?;
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(windows)]
        imp::paste();
    })
    .await
    .map_err(|e| e.to_string())
}

/// Presses Ctrl+V in the app you were using, with whatever is on the clipboard.
#[tauri::command]
pub async fn paste_now() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(windows)]
        imp::paste();
    })
    .await
    .map_err(|e| e.to_string())
}

/// Starts Windows voice typing (Win + H) in the focused text field.
#[tauri::command]
pub fn dictate() {
    #[cfg(windows)]
    imp::win_h();
}

#[cfg(windows)]
mod imp {
    use crate::watch::LAST_EXTERNAL;
    use std::sync::atomic::Ordering;
    use std::time::Duration;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_V,
    };
    use windows::Win32::UI::WindowsAndMessaging::{IsWindow, SetForegroundWindow};

    fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    pub fn win_h() {
        use windows::Win32::UI::Input::KeyboardAndMouse::{VK_H, VK_LWIN};
        let inputs = [key(VK_LWIN, false), key(VK_H, false), key(VK_H, true), key(VK_LWIN, true)];
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }

    pub fn paste() {
        let target = HWND(LAST_EXTERNAL.load(Ordering::Relaxed) as _);
        unsafe {
            if !target.0.is_null() && IsWindow(Some(target)).as_bool() {
                let _ = SetForegroundWindow(target);
            }
            // Let the app take focus (and the notch finish closing) first.
            std::thread::sleep(Duration::from_millis(180));
            let inputs = [key(VK_CONTROL, false), key(VK_V, false), key(VK_V, true), key(VK_CONTROL, true)];
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }
}
