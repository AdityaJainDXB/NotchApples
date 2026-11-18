//! Music levels for the Voxel Wall on Windows: a listen-only WASAPI loopback capture of what the PC plays (the default output
//! device), split into four bands (bass ~90 Hz, low-mids ~400 Hz, mids ~1.6 kHz, highs ~6 kHz) with band-pass filters, the same
//! split as the Mac's MusicLevelMeter. Nothing is recorded or saved: each block of samples is reduced to four numbers and dropped.
//! The capture starts when the Voxel Wall asks for levels and stops by itself a few seconds after it stops asking.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static LEVELS: Mutex<[f32; 4]> = Mutex::new([0.0; 4]);
static RUNNING: AtomicBool = AtomicBool::new(false);
static LIVE: AtomicBool = AtomicBool::new(false);
static LAST_ASK: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }

/// A biquad band-pass filter (RBJ cookbook, constant 0 dB peak gain).
#[derive(Clone, Copy)]
pub struct BandPass { b0: f32, b2: f32, a1: f32, a2: f32, x1: f32, x2: f32, y1: f32, y2: f32 }
impl BandPass {
    pub fn new(centre: f32, q: f32, rate: f32) -> Self {
        let w = 2.0 * std::f32::consts::PI * centre / rate;
        let alpha = w.sin() / (2.0 * q);
        let a0 = 1.0 + alpha;
        BandPass { b0: alpha / a0, b2: -alpha / a0, a1: -2.0 * w.cos() / a0, a2: (1.0 - alpha) / a0, x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 }
    }
    pub fn run(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1; self.x1 = x; self.y2 = self.y1; self.y1 = y;
        y
    }
}

/// Turns one block's band energies into 0…1 levels with a slowly falling peak, so quiet and loud songs both fill the range.
pub fn normalise(rms: [f32; 4], peaks: &mut [f32; 4]) -> [f32; 4] {
    let mut out = [0.0; 4];
    for i in 0..4 {
        peaks[i] = (peaks[i] * 0.995).max(rms[i]).max(0.002);
        out[i] = (rms[i] / peaks[i]).clamp(0.0, 1.0);
    }
    out
}

/// The levels for this frame: { live, bands }. `live` is false when the capture could not start (the scene then uses its
/// made-up beat). Asking keeps the capture running.
#[tauri::command]
pub fn voxel_levels() -> serde_json::Value {
    LAST_ASK.store(now_ms(), Ordering::Relaxed);
    if !RUNNING.swap(true, Ordering::SeqCst) {
        let _ = std::thread::Builder::new().name("voxel-levels".into()).spawn(|| {
            #[cfg(windows)]
            let _ = capture::run();
            LIVE.store(false, Ordering::Relaxed);
            RUNNING.store(false, Ordering::SeqCst);
        });
    }
    let l = *LEVELS.lock().unwrap();
    serde_json::json!({ "live": LIVE.load(Ordering::Relaxed), "bands": l })
}

#[cfg(windows)]
mod capture {
    use super::*;
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;

    pub fn run() -> windows::core::Result<()> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
            let format = client.GetMixFormat()?;
            let channels = (*format).nChannels.max(1) as usize;
            let rate = (*format).nSamplesPerSec as f32;
            let bits = (*format).wBitsPerSample;
            // 100 ms buffer, listen-only loopback of the shared mix.
            client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 1_000_000, 0, format, None)?;
            let capture: IAudioCaptureClient = client.GetService()?;
            client.Start()?;
            LIVE.store(true, Ordering::Relaxed);
            let centres = [90.0f32, 400.0, 1600.0, 6000.0];
            let mut filters: Vec<BandPass> = centres.iter().map(|c| BandPass::new(*c, 1.1, rate)).collect();
            let mut peaks = [0.02f32; 4];
            let mut acc = [0.0f32; 4];
            let mut count = 0usize;
            let block = (rate / 30.0) as usize;   // ~30 updates a second
            loop {
                if now_ms().saturating_sub(LAST_ASK.load(Ordering::Relaxed)) > 4000 { break; }   // nobody is watching: stop
                std::thread::sleep(std::time::Duration::from_millis(10));
                loop {
                    let packet = capture.GetNextPacketSize()?;
                    if packet == 0 { break; }
                    let mut data = std::ptr::null_mut();
                    let mut frames = 0u32;
                    let mut flags = 0u32;
                    capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None)?;
                    let silent = flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;
                    for f in 0..frames as usize {
                        let mut x = 0.0f32;
                        if !silent && !data.is_null() {
                            for c in 0..channels {
                                let i = f * channels + c;
                                x += if bits == 32 { *(data as *const f32).add(i) } else { *(data as *const i16).add(i) as f32 / 32768.0 };
                            }
                            x /= channels as f32;
                        }
                        for (k, filt) in filters.iter_mut().enumerate() { let y = filt.run(x); acc[k] += y * y; }
                        count += 1;
                        if count >= block {
                            let rms = [ (acc[0] / count as f32).sqrt(), (acc[1] / count as f32).sqrt(), (acc[2] / count as f32).sqrt(), (acc[3] / count as f32).sqrt() ];
                            *LEVELS.lock().unwrap() = normalise(rms, &mut peaks);
                            acc = [0.0; 4]; count = 0;
                        }
                    }
                    capture.ReleaseBuffer(frames)?;
                }
            }
            let _ = client.Stop();
            CoTaskMemFree(Some(format as *const _));
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn band_pass_passes_its_centre_and_cuts_far_away() {
        let rate = 48_000.0;
        let energy = |freq: f32| {
            let mut f = BandPass::new(400.0, 1.1, rate);
            let mut e = 0.0;
            for n in 0..48_000 { let y = f.run((2.0 * std::f32::consts::PI * freq * n as f32 / rate).sin()); if n > 4800 { e += y * y; } }
            e
        };
        assert!(energy(400.0) > 10.0 * energy(6000.0));
        assert!(energy(400.0) > 10.0 * energy(40.0));
    }
    #[test]
    fn levels_are_normalised_to_the_recent_peak() {
        let mut peaks = [0.02; 4];
        let l = normalise([0.5, 0.0, 0.25, 0.0], &mut peaks);
        assert_eq!(l[0], 1.0);
        assert!(l[1] < 0.01);
        let l2 = normalise([0.25, 0.0, 0.25, 0.0], &mut peaks);
        assert!(l2[0] > 0.45 && l2[0] < 0.55, "half the recent peak");
    }
}
