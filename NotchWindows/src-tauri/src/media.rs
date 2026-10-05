//! Now Playing, from Windows' own media controls (the ones in the volume
//! flyout). That covers Spotify, browsers playing YouTube or web players, the
//! Media Player app and most music apps, with no per-app setup.
//!
//! One thread owns the Windows media session manager. It reports changes as a
//! `media` event about once a second and runs play/pause/skip requests.

// Parts of this file only run on Windows; development builds elsewhere get stubs.
#![cfg_attr(not(windows), allow(dead_code, unused_imports))]

use serde::Serialize;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

#[derive(Serialize, Clone, PartialEq, Default, Debug)]
pub struct Media {
    pub title: String,
    pub artist: String,
    pub album: String,
    /// The app playing it, e.g. "Spotify.exe" or "MSEdge".
    pub app: String,
    pub playing: bool,
    pub position: f64,
    pub duration: f64,
    /// Cover art as a data: URL, when the app provides one.
    pub art: Option<String>,
    pub can_next: bool,
    pub can_previous: bool,
}

pub enum Command {
    Toggle,
    Next,
    Previous,
    Seek(f64),
}

fn sender() -> &'static Mutex<Option<Sender<Command>>> {
    static TX: OnceLock<Mutex<Option<Sender<Command>>>> = OnceLock::new();
    TX.get_or_init(|| Mutex::new(None))
}

static LATEST: Mutex<Option<Media>> = Mutex::new(None);

pub fn start(app: tauri::AppHandle) {
    let (tx, rx) = channel::<Command>();
    if let Ok(mut s) = sender().lock() {
        *s = Some(tx);
    }
    let _ = std::thread::Builder::new().name("media".into()).spawn(move || {
        #[cfg(windows)]
        imp::run(app, rx);
        #[cfg(not(windows))]
        {
            let _ = (app, rx);
        }
    });
}

fn send(cmd: Command) -> Result<(), String> {
    let guard = sender().lock().map_err(|e| e.to_string())?;
    guard.as_ref().ok_or("Media controls aren't available.")?.send(cmd).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn media_now() -> Option<Media> {
    LATEST.lock().ok().and_then(|m| m.clone())
}

#[tauri::command]
pub fn media_control(action: String, position: Option<f64>) -> Result<(), String> {
    match action.as_str() {
        "toggle" => send(Command::Toggle),
        "next" => send(Command::Next),
        "previous" => send(Command::Previous),
        "seek" => send(Command::Seek(position.unwrap_or(0.0))),
        _ => Err("Unknown media action.".into()),
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use base64::Engine;
    use std::sync::mpsc::{Receiver, RecvTimeoutError};
    use std::time::Duration;
    use tauri::Emitter;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    const TICKS: f64 = 10_000_000.0; // 100 ns units per second

    pub fn run(app: tauri::AppHandle, rx: Receiver<Command>) {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let manager = match Manager::RequestAsync().and_then(|op| op.join()) {
            Ok(m) => m,
            Err(_) => return, // e.g. Windows N without the Media Feature Pack
        };
        let mut last: Option<Media> = None;
        let mut art_for = String::new();
        let mut art: Option<String> = None;

        loop {
            match rx.recv_timeout(Duration::from_millis(1000)) {
                Ok(cmd) => {
                    if let Ok(session) = manager.GetCurrentSession() {
                        let _ = control(&session, cmd);
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }

            let now = manager.GetCurrentSession().ok().and_then(|s| read(&s, &mut art_for, &mut art).ok());
            if now != last {
                if let Ok(mut l) = LATEST.lock() {
                    *l = now.clone();
                }
                let _ = app.emit("media", now.clone());
                last = now;
            }
        }
    }

    fn control(session: &Session, cmd: Command) -> windows::core::Result<()> {
        match cmd {
            Command::Toggle => session.TryTogglePlayPauseAsync()?.join().map(|_| ()),
            Command::Next => session.TrySkipNextAsync()?.join().map(|_| ()),
            Command::Previous => session.TrySkipPreviousAsync()?.join().map(|_| ()),
            Command::Seek(seconds) => session.TryChangePlaybackPositionAsync((seconds * TICKS) as i64)?.join().map(|_| ()),
        }
    }

    fn read(session: &Session, art_for: &mut String, art: &mut Option<String>) -> windows::core::Result<Media> {
        let props = session.TryGetMediaPropertiesAsync()?.join()?;
        let info = session.GetPlaybackInfo()?;
        let controls = info.Controls()?;
        let playing = info.PlaybackStatus()? == Status::Playing;
        let title = props.Title()?.to_string();
        let artist = props.Artist()?.to_string();

        // The art only changes with the track, so it's read once per track.
        let key = format!("{title}\u{1}{artist}");
        if *art_for != key {
            *art_for = key;
            *art = props.Thumbnail().ok().and_then(|t| thumbnail(&t).ok());
        }

        let timeline = session.GetTimelineProperties()?;
        let duration = (timeline.EndTime()?.Duration - timeline.StartTime()?.Duration) as f64 / TICKS;
        let mut position = timeline.Position()?.Duration as f64 / TICKS;
        // The position is only updated now and then; move it on by the time since.
        if playing {
            if let Ok(updated) = timeline.LastUpdatedTime() {
                let now = now_ticks();
                if updated.UniversalTime > 0 && now > updated.UniversalTime {
                    position += (now - updated.UniversalTime) as f64 / TICKS;
                }
            }
        }
        if duration > 0.0 {
            position = position.clamp(0.0, duration);
        }

        Ok(Media {
            title,
            artist,
            album: props.AlbumTitle()?.to_string(),
            app: session.SourceAppUserModelId()?.to_string(),
            playing,
            position: position.max(0.0).round(),
            duration: duration.max(0.0).round(),
            art: art.clone(),
            can_next: controls.IsNextEnabled().unwrap_or(false),
            can_previous: controls.IsPreviousEnabled().unwrap_or(false),
        })
    }

    fn thumbnail(reference: &windows::Storage::Streams::IRandomAccessStreamReference) -> windows::core::Result<String> {
        let stream = reference.OpenReadAsync()?.join()?;
        let size = stream.Size()? as u32;
        if size == 0 || size > 8_000_000 {
            return Err(windows::core::Error::empty());
        }
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        reader.LoadAsync(size)?.join()?;
        let mut bytes = vec![0u8; size as usize];
        reader.ReadBytes(&mut bytes)?;
        let kind = stream.ContentType().map(|c| c.to_string()).unwrap_or_default();
        let mime = if kind.starts_with("image/") { kind } else { "image/png".into() };
        Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    }

    /// Now, in Windows' 100 ns ticks since 1601.
    fn now_ticks() -> i64 {
        let unix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as i64 / 100)
            .unwrap_or(0);
        unix + 116_444_736_000_000_000
    }
}
