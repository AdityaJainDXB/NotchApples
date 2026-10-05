//! Windows Hello lock, the Windows version of the Mac's Biometric Lock:
//! face, fingerprint or PIN before the notch opens.

#[tauri::command]
pub async fn hello_available() -> bool {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(windows)]
        return imp::available();
        #[cfg(not(windows))]
        false
    })
    .await
    .unwrap_or(false)
}

#[tauri::command]
pub async fn hello_verify(window: tauri::WebviewWindow, message: String) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        return tauri::async_runtime::spawn_blocking(move || imp::verify(hwnd, &message))
            .await
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = (window, message);
        Err("Windows Hello is only on Windows.".into())
    }
}

#[cfg(windows)]
mod imp {
    use windows::core::{factory, HSTRING};
    use windows_future::IAsyncOperation;
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;

    pub fn available() -> bool {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|op| op.join())
            .map(|a| a == UserConsentVerifierAvailability::Available)
            .unwrap_or(false)
    }

    pub fn verify(hwnd: isize, message: &str) -> Result<bool, String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>().map_err(|e| e.message().to_string())?;
        let op: IAsyncOperation<UserConsentVerificationResult> = unsafe {
            interop.RequestVerificationForWindowAsync(HWND(hwnd as _), &HSTRING::from(message))
        }
        .map_err(|e| e.message().to_string())?;
        let result = op.join().map_err(|e| e.message().to_string())?;
        Ok(result == UserConsentVerificationResult::Verified)
    }
}
