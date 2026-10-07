//! Screen brightness for the pill's gauge (laptop panels). Windows' display driver answers
//! `IOCTL_VIDEO_QUERY_DISPLAY_BRIGHTNESS` on `\\.\LCD` with the brightness set for plugged-in and for
//! battery; the one for the current power source is the level you see. Desktop monitors have no such
//! device, so there the gauge is simply unavailable. Read-only, nothing is changed or sent anywhere.

use serde::Serialize;

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct Brightness {
    pub available: bool,
    /// 0.0 to 1.0.
    pub level: f32,
}

/// The level for the current power source, as 0.0 to 1.0 (a driver can report up to 255; 100 is the cap).
pub fn pick(ac_online: bool, ac: u8, dc: u8) -> f32 {
    f32::from((if ac_online { ac } else { dc }).min(100)) / 100.0
}

#[tauri::command]
pub async fn brightness_state() -> Brightness {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(windows)]
        return imp::state();
        #[cfg(not(windows))]
        Brightness::default()
    })
    .await
    .unwrap_or_default()
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows::Win32::System::IO::DeviceIoControl;

    /// CTL_CODE(FILE_DEVICE_VIDEO = 0x23, 0x126, METHOD_BUFFERED, FILE_ANY_ACCESS)
    const IOCTL_VIDEO_QUERY_DISPLAY_BRIGHTNESS: u32 = 0x0023_0498;

    /// DISPLAY_BRIGHTNESS from ntddvdeo.h.
    #[repr(C)]
    #[derive(Default)]
    struct DisplayBrightness {
        policy: u8,
        ac: u8,
        dc: u8,
    }

    pub fn state() -> Brightness {
        let Ok(device) = std::fs::OpenOptions::new().read(true).open(r"\\.\LCD") else {
            return Brightness::default();
        };
        let mut out = DisplayBrightness::default();
        let mut returned = 0u32;
        let ok = unsafe {
            DeviceIoControl(
                HANDLE(device.as_raw_handle()),
                IOCTL_VIDEO_QUERY_DISPLAY_BRIGHTNESS,
                None,
                0,
                Some(&mut out as *mut DisplayBrightness as *mut core::ffi::c_void),
                std::mem::size_of::<DisplayBrightness>() as u32,
                Some(&mut returned),
                None,
            )
        };
        if ok.is_err() || returned < 3 {
            return Brightness::default();
        }
        let mut power = SYSTEM_POWER_STATUS::default();
        let ac_online = unsafe { GetSystemPowerStatus(&mut power) }.is_ok() && power.ACLineStatus == 1;
        Brightness { available: true, level: pick(ac_online, out.ac, out.dc) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_the_level_for_the_current_power_source() {
        assert_eq!(pick(true, 80, 40), 0.8);
        assert_eq!(pick(false, 80, 40), 0.4);
    }

    #[test]
    fn caps_odd_driver_values_at_100_percent() {
        assert_eq!(pick(true, 255, 0), 1.0);
        assert_eq!(pick(false, 0, 0), 0.0);
    }
}
