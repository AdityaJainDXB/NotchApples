//! Audio, ported from the Mac's Audio tab: master volume and mute, the output
//! and input devices, microphone mute, and volume per app (Windows' own volume
//! mixer, through the documented Core Audio interfaces).

use serde::Serialize;

#[derive(Serialize, Default, Clone)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub default: bool,
}

#[derive(Serialize, Default, Clone)]
pub struct AppVolume {
    /// The app's name; sessions from the same app are grouped under it.
    pub name: String,
    pub volume: f32,
    pub muted: bool,
    pub active: bool,
}

#[derive(Serialize, Default)]
pub struct AudioState {
    pub available: bool,
    pub volume: f32,
    pub muted: bool,
    pub output: String,
    pub outputs: Vec<Device>,
    pub input: String,
    pub mic_muted: bool,
    pub apps: Vec<AppVolume>,
}

#[tauri::command]
pub async fn audio_state() -> AudioState {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(windows)]
        return imp::state().unwrap_or_default();
        #[cfg(not(windows))]
        AudioState::default()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn audio_set(what: String, value: f32, app: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        return imp::set(&what, value, app.as_deref()).map_err(|e| e.message().to_string());
        #[cfg(not(windows))]
        {
            let _ = (what, value, app);
            Err::<(), String>("Audio controls are Windows-only in this build.".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(windows)]
mod imp {
    use super::*;
    use windows::core::{Interface, GUID};
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Foundation::S_OK;
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eCapture, eCommunications, eConsole, eRender, AudioSessionStateActive, AudioSessionStateExpired, IAudioSessionControl2,
        IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};

    fn enumerator() -> windows::core::Result<IMMDeviceEnumerator> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
        }
    }

    fn name_of(device: &IMMDevice) -> String {
        unsafe {
            let Ok(store) = device.OpenPropertyStore(STGM_READ) else { return String::new() };
            let Ok(value) = store.GetValue(&PKEY_Device_FriendlyName) else { return String::new() };
            match PropVariantToStringAlloc(&value) {
                Ok(p) => {
                    let s = p.to_string().unwrap_or_default();
                    CoTaskMemFree(Some(p.0 as _));
                    s
                }
                Err(_) => String::new(),
            }
        }
    }

    fn id_of(device: &IMMDevice) -> String {
        unsafe {
            match device.GetId() {
                Ok(p) => {
                    let s = p.to_string().unwrap_or_default();
                    CoTaskMemFree(Some(p.0 as _));
                    s
                }
                Err(_) => String::new(),
            }
        }
    }

    fn sessions(device: &IMMDevice) -> windows::core::Result<Vec<(String, ISimpleAudioVolume, bool)>> {
        let mut out = Vec::new();
        unsafe {
            let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
            let list = manager.GetSessionEnumerator()?;
            for i in 0..list.GetCount()? {
                let Ok(control) = list.GetSession(i) else { continue };
                let state = control.GetState()?;
                if state == AudioSessionStateExpired {
                    continue;
                }
                let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };
                let name = if control2.IsSystemSoundsSession() == S_OK {
                    "System sounds".to_string()
                } else {
                    let pid = control2.GetProcessId().unwrap_or(0);
                    if pid == 0 {
                        continue;
                    }
                    match crate::watch::exe_path(pid) {
                        Some(path) => crate::watch::friendly_name(&path),
                        None => continue,
                    }
                };
                if let Ok(volume) = control.cast::<ISimpleAudioVolume>() {
                    out.push((name, volume, state == AudioSessionStateActive));
                }
            }
        }
        Ok(out)
    }

    pub fn state() -> windows::core::Result<AudioState> {
        let en = enumerator()?;
        let mut s = AudioState { available: true, ..Default::default() };
        unsafe {
            let output = en.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let endpoint: IAudioEndpointVolume = output.Activate(CLSCTX_ALL, None)?;
            s.volume = endpoint.GetMasterVolumeLevelScalar()?;
            s.muted = endpoint.GetMute()?.as_bool();
            s.output = name_of(&output);
            let default_id = id_of(&output);

            let all = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
            for i in 0..all.GetCount()? {
                if let Ok(d) = all.Item(i) {
                    let id = id_of(&d);
                    s.outputs.push(Device { default: id == default_id, name: name_of(&d), id });
                }
            }

            if let Ok(input) = en.GetDefaultAudioEndpoint(eCapture, eCommunications) {
                s.input = name_of(&input);
                if let Ok(mic) = input.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) {
                    s.mic_muted = mic.GetMute().map(|b| b.as_bool()).unwrap_or(false);
                }
            }

            // Group an app's sessions (a browser often has several) under one row.
            let mut apps: Vec<AppVolume> = Vec::new();
            for (name, volume, active) in sessions(&output)? {
                let level = volume.GetMasterVolume().unwrap_or(1.0);
                let muted = volume.GetMute().map(|b| b.as_bool()).unwrap_or(false);
                match apps.iter_mut().find(|a| a.name == name) {
                    Some(a) => a.active |= active,
                    None => apps.push(AppVolume { name, volume: level, muted, active }),
                }
            }
            apps.sort_by(|a, b| b.active.cmp(&a.active).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
            s.apps = apps;
        }
        Ok(s)
    }

    pub fn set(what: &str, value: f32, app: Option<&str>) -> windows::core::Result<()> {
        let en = enumerator()?;
        let nothing: *const GUID = std::ptr::null();
        unsafe {
            match what {
                "volume" | "mute" => {
                    let output = en.GetDefaultAudioEndpoint(eRender, eConsole)?;
                    let endpoint: IAudioEndpointVolume = output.Activate(CLSCTX_ALL, None)?;
                    if what == "volume" {
                        endpoint.SetMasterVolumeLevelScalar(value.clamp(0.0, 1.0), nothing)?;
                        if value > 0.0 {
                            endpoint.SetMute(false, nothing)?;
                        }
                    } else {
                        endpoint.SetMute(value > 0.5, nothing)?;
                    }
                }
                "mic-mute" => {
                    let input = en.GetDefaultAudioEndpoint(eCapture, eCommunications)?;
                    let endpoint: IAudioEndpointVolume = input.Activate(CLSCTX_ALL, None)?;
                    endpoint.SetMute(value > 0.5, nothing)?;
                }
                "app-volume" | "app-mute" => {
                    let output = en.GetDefaultAudioEndpoint(eRender, eConsole)?;
                    let wanted = app.unwrap_or("");
                    for (name, volume, _) in sessions(&output)? {
                        if name != wanted {
                            continue;
                        }
                        if what == "app-volume" {
                            volume.SetMasterVolume(value.clamp(0.0, 1.0), nothing)?;
                        } else {
                            volume.SetMute(value > 0.5, nothing)?;
                        }
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }
}
