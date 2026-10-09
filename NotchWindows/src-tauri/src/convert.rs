//! Convert (Ultimate): the native half of the converter. The page (services/convert.js) does every conversion it can
//! by itself (images, text, Markdown, CSV / JSON / Excel tables, Word text, audio to WAV); this side does the rest:
//!
//! - Office documents through Word, PowerPoint or Excel when they are installed (the same apps you'd use by hand),
//!   or LibreOffice (free) when they aren't;
//! - audio and video through FFmpeg, when it's installed;
//! - TIFF and HEIC pictures through Windows' own image decoders, so the page can carry on with them;
//! - PDF pages to pictures through Windows' own PDF renderer;
//! - zipping and unzipping.
//!
//! Paths reach PowerShell as environment variables, never pasted into a script, so no file name can break one.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Serialize, Default)]
pub struct Tools {
    pub word: bool,
    pub powerpoint: bool,
    pub excel: bool,
    pub libreoffice: bool,
    pub ffmpeg: bool,
}

/// Which helper apps this PC has.
#[tauri::command]
pub async fn convert_tools() -> Tools {
    tauri::async_runtime::spawn_blocking(|| Tools {
        word: has_com("Word.Application"),
        powerpoint: has_com("PowerPoint.Application"),
        excel: has_com("Excel.Application"),
        libreoffice: soffice().is_some(),
        ffmpeg: ffmpeg().is_some(),
    })
    .await
    .unwrap_or_default()
}

#[cfg(windows)]
fn has_com(prog_id: &str) -> bool {
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, HKEY, HKEY_CLASSES_ROOT, KEY_READ};
    let mut key = HKEY::default();
    let path = HSTRING::from(format!("{prog_id}\\CLSID"));
    unsafe {
        let ok = RegOpenKeyExW(HKEY_CLASSES_ROOT, &path, Some(0), KEY_READ, &mut key).is_ok();
        if ok {
            let _ = RegCloseKey(key);
        }
        ok
    }
}
#[cfg(not(windows))]
fn has_com(_: &str) -> bool {
    false
}

fn soffice() -> Option<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|v| std::env::var_os(v))
        .map(|d| PathBuf::from(d).join("LibreOffice").join("program").join("soffice.exe"))
        .find(|p| p.exists())
}

fn ffmpeg() -> Option<PathBuf> {
    let mut places: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).map(|d| d.join("ffmpeg.exe")).collect())
        .unwrap_or_default();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        places.push(PathBuf::from(local).join("Microsoft").join("WinGet").join("Links").join("ffmpeg.exe"));
    }
    for v in ["ProgramFiles", "ProgramData"] {
        if let Some(d) = std::env::var_os(v) {
            places.push(PathBuf::from(&d).join("ffmpeg").join("bin").join("ffmpeg.exe"));
            places.push(PathBuf::from(&d).join("chocolatey").join("bin").join("ffmpeg.exe"));
        }
    }
    if let Some(home) = std::env::var_os("USERPROFILE") {
        places.push(PathBuf::from(home).join("scoop").join("shims").join("ffmpeg.exe"));
    }
    places.into_iter().find(|p| p.is_file())
}

/// Choose files to convert (several at once).
#[tauri::command]
pub async fn convert_pick(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().set_title("Choose files to convert").pick_files(move |p| {
        let _ = tx.send(p);
    });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten()).await.map_err(|e| e.to_string())?;
    Ok(picked.unwrap_or_default().into_iter().map(|p| p.to_string()).collect())
}

/// A file's bytes, as base64, for the conversions the page does itself.
#[tauri::command]
pub async fn convert_read(path: String) -> Result<String, String> {
    use base64::Engine;
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&path).map_err(|_| "That file can't be read. Has it moved?")?;
        if meta.len() > 400 * 1024 * 1024 {
            return Err("That file is larger than 400 MB.".to_string());
        }
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Writes what the page made.
#[tauri::command]
pub async fn convert_write(path: String, data: String) -> Result<(), String> {
    use base64::Engine;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
        std::fs::write(&path, bytes).map_err(|e| format!("Couldn't save it: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A private temp folder for two-step jobs (Markdown through a web page, slides through a PDF).
#[tauri::command]
pub fn convert_temp_dir() -> Result<String, String> {
    let dir = std::env::temp_dir().join("Notch apple convert");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// Where a converted file goes: next to the original ("Report.pdf"), never over anything ("Report (2).pdf"), or in
/// Downloads when that folder can't be written to. `ext` empty means a folder ("Report slides").
#[tauri::command]
pub fn convert_target(input: String, ext: String, suffix: Option<String>) -> String {
    target(Path::new(&input), &ext, suffix.as_deref().unwrap_or("")).to_string_lossy().to_string()
}

pub fn target(input: &Path, ext: &str, suffix: &str) -> PathBuf {
    let stem = input.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Converted".into());
    let mut dir = input.parent().map(Path::to_path_buf).unwrap_or_default();
    if !writable(&dir) {
        dir = std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join("Downloads")).unwrap_or_else(std::env::temp_dir);
    }
    let name = |n: u32| {
        let base = if n < 2 { format!("{stem}{suffix}") } else { format!("{stem}{suffix} ({n})") };
        if ext.is_empty() { base } else { format!("{base}.{ext}") }
    };
    let mut n = 1;
    loop {
        let p = dir.join(name(n));
        if !p.exists() && p != input {
            return p;
        }
        n += 1;
    }
}

fn writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".notch-convert-{}", std::process::id()));
    let ok = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

/// Runs one native conversion. `engine` says how: word, powerpoint, excel, soffice, ffmpeg, wic, zip, unzip or pdfpages.
/// `format` is the app's own number for the format (Office), or the target extension.
#[tauri::command]
pub async fn convert_run(engine: String, input: String, output: String, format: String, from: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run(&engine, &input, &output, &format, from.as_deref().unwrap_or("")))
        .await
        .map_err(|e| e.to_string())?
}

fn run(engine: &str, input: &str, output: &str, format: &str, from: &str) -> Result<String, String> {
    if !Path::new(input).exists() {
        return Err("That file has moved or been deleted.".into());
    }
    match engine {
        "word" => powershell(WORD, input, output, format, 600).map(|_| output.to_string()),
        "powerpoint" => powershell(POWERPOINT, input, output, format, 600).map(|_| output.to_string()),
        "excel" => powershell(EXCEL, input, output, format, 600).map(|_| output.to_string()),
        "wic" => powershell(WIC, input, output, format, 60).map(|_| output.to_string()),
        "zip" => powershell(ZIP, input, output, format, 1800).map(|_| output.to_string()),
        "unzip" => powershell(UNZIP, input, output, format, 1800).map(|_| output.to_string()),
        "soffice" => libreoffice(input, output, format, from),
        "ffmpeg" => run_ffmpeg(input, output, format),
        "pdfpages" => pdf_pages(input, output, format),
        _ => Err(format!("Unknown converter {engine}")),
    }
}

// ---- Office, through the apps themselves

const WORD: &str = r#"$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject Word.Application
$app.Visible = $false; $app.DisplayAlerts = 0
try {
  $doc = $app.Documents.Open($env:NA_IN, $false, $true, $false)
  $doc.SaveAs2($env:NA_OUT, [int]$env:NA_FMT)
  $doc.Close(0)
} finally { $app.Quit() }"#;

const POWERPOINT: &str = r#"$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject PowerPoint.Application
try {
  $deck = $app.Presentations.Open($env:NA_IN, -1, 0, 0)
  $deck.SaveAs($env:NA_OUT, [int]$env:NA_FMT)
  $deck.Close()
} finally { $app.Quit() }"#;

const EXCEL: &str = r#"$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject Excel.Application
$app.Visible = $false; $app.DisplayAlerts = $false
try {
  $book = $app.Workbooks.Open($env:NA_IN, 0, $true)
  if ($env:NA_FMT -eq 'pdf') { $book.ExportAsFixedFormat(0, $env:NA_OUT) } else { $book.SaveAs($env:NA_OUT, [int]$env:NA_FMT) }
  $book.Close($false)
} finally { $app.Quit() }"#;

// TIFF, HEIC, JPEG XR and anything else Windows can open, to PNG for the page.
const WIC: &str = r#"$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
$in = [IO.File]::OpenRead($env:NA_IN)
try {
  $dec = [Windows.Media.Imaging.BitmapDecoder]::Create($in, [Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat, [Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
  $enc = New-Object Windows.Media.Imaging.PngBitmapEncoder
  $enc.Frames.Add($dec.Frames[0])
  $out = [IO.File]::Create($env:NA_OUT)
  try { $enc.Save($out) } finally { $out.Close() }
} finally { $in.Close() }"#;

const ZIP: &str = r#"$ErrorActionPreference = 'Stop'
Compress-Archive -LiteralPath $env:NA_IN -DestinationPath $env:NA_OUT -CompressionLevel Optimal"#;

const UNZIP: &str = r#"$ErrorActionPreference = 'Stop'
Expand-Archive -LiteralPath $env:NA_IN -DestinationPath $env:NA_OUT"#;

fn powershell(script: &str, input: &str, output: &str, format: &str, seconds: u64) -> Result<String, String> {
    let mut cmd = std::process::Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .env("NA_IN", input)
        .env("NA_OUT", output)
        .env("NA_FMT", format);
    crate::plugins::hide_window(&mut cmd);
    let text = crate::plugins::run_with_timeout(cmd, Duration::from_secs(seconds))?;
    if Path::new(output).exists() {
        Ok(text)
    } else {
        Err(friendly(&text))
    }
}

/// The useful line of a PowerShell error.
fn friendly(text: &str) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with("At line") && !l.starts_with('+'))
        .unwrap_or("It didn't work.");
    if line.contains("0x88982F50") || line.contains("component cannot be found") {
        return "Windows can't open this picture. For HEIC photos, install “HEIF Image Extensions” from the Microsoft Store.".into();
    }
    line.chars().take(300).collect()
}

// ---- LibreOffice

fn libreoffice(input: &str, output: &str, ext: &str, from: &str) -> Result<String, String> {
    let exe = soffice().ok_or("LibreOffice isn't installed.")?;
    let tmp = std::env::temp_dir().join(format!("notch-convert-{}-{}", std::process::id(), stamp()));
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("--headless").arg("--norestore");
    if from == "pdf" {
        cmd.arg("--infilter=writer_pdf_import");
    }
    // Its own profile, so an open LibreOffice window doesn't swallow the job.
    let profile = std::env::temp_dir().join("notch-convert-lo-profile");
    cmd.arg(format!("-env:UserInstallation=file:///{}", profile.to_string_lossy().replace('\\', "/")));
    cmd.arg("--convert-to").arg(ext).arg("--outdir").arg(&tmp).arg(input);
    crate::plugins::hide_window(&mut cmd);
    let log = crate::plugins::run_with_timeout(cmd, Duration::from_secs(600));
    let made = std::fs::read_dir(&tmp).ok().and_then(|mut d| d.find_map(|e| e.ok().map(|e| e.path())));
    let result = match made {
        Some(file) => std::fs::rename(&file, output)
            .or_else(|_| std::fs::copy(&file, output).map(|_| ()))
            .map(|_| output.to_string())
            .map_err(|e| e.to_string()),
        None => Err(format!("LibreOffice couldn't convert it. {}", log.unwrap_or_else(|e| e).lines().next().unwrap_or(""))),
    };
    let _ = std::fs::remove_dir_all(&tmp);
    result
}

fn stamp() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
}

// ---- FFmpeg

/// FFmpeg settings for each target: plain, widely playable choices.
pub fn ffmpeg_args(to: &str) -> Option<Vec<&'static str>> {
    let a: &[&str] = match to {
        "mp3" => &["-vn", "-c:a", "libmp3lame", "-q:a", "2"],
        "m4a" | "aac" => &["-vn", "-c:a", "aac", "-b:a", "192k"],
        "wav" => &["-vn", "-c:a", "pcm_s16le"],
        "aiff" => &["-vn", "-c:a", "pcm_s16be"],
        "flac" => &["-vn", "-c:a", "flac"],
        "ogg" => &["-vn", "-c:a", "libvorbis", "-q:a", "5"],
        "opus" => &["-vn", "-c:a", "libopus", "-b:a", "128k"],
        "wma" => &["-vn", "-c:a", "wmav2", "-b:a", "192k"],
        "mp4" | "m4v" | "mov" => &["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"],
        "mkv" => &["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k"],
        "webm" => &["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "33", "-row-mt", "1", "-c:a", "libopus", "-b:a", "128k"],
        "avi" => &["-c:v", "mpeg4", "-q:v", "3", "-c:a", "libmp3lame", "-q:a", "3"],
        "wmv" => &["-c:v", "wmv2", "-b:v", "2500k", "-c:a", "wmav2", "-b:a", "160k"],
        "gif" => &["-vf", "fps=12,scale='min(480,iw)':-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", "-loop", "0"],
        _ => return None,
    };
    Some(a.to_vec())
}

fn run_ffmpeg(input: &str, output: &str, to: &str) -> Result<String, String> {
    let exe = ffmpeg().ok_or("FFmpeg isn't installed.")?;
    let args = ffmpeg_args(to).ok_or(format!("FFmpeg can't make .{to} files here."))?;
    let mut cmd = std::process::Command::new(exe);
    cmd.args(["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i"]).arg(input).args(args).arg(output);
    crate::plugins::hide_window(&mut cmd);
    let log = crate::plugins::run_with_timeout(cmd, Duration::from_secs(3 * 3600))?;
    let ok = std::fs::metadata(output).map(|m| m.len() > 0).unwrap_or(false);
    if ok {
        Ok(output.to_string())
    } else {
        let _ = std::fs::remove_file(output);
        Err(format!("FFmpeg couldn't convert it. {}", log.lines().last().unwrap_or("")).trim().to_string())
    }
}

// ---- PDF pages to pictures, with Windows' own PDF renderer

#[cfg(windows)]
fn pdf_pages(input: &str, output: &str, to: &str) -> Result<String, String> {
    pdf::render(input, output, to == "jpg").map_err(|e| format!("Windows couldn't read that PDF ({e})."))?;
    Ok(output.to_string())
}
#[cfg(not(windows))]
fn pdf_pages(_: &str, _: &str, _: &str) -> Result<String, String> {
    Err("PDF pages can only be turned into pictures on Windows.".into())
}

/// Kept free of Tauri so it can be checked on its own.
#[cfg(windows)]
pub mod pdf {
    use windows::core::{Result, HSTRING};
    use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
    use windows::Graphics::Imaging::BitmapEncoder;
    use windows::Storage::{FileAccessMode, StorageFile};

    /// Every page of `input` as Page 1.png, Page 2.png… (or .jpg) in a new folder `output`, at twice the page's size.
    pub fn render(input: &str, output: &str, jpeg: bool) -> Result<u32> {
        std::fs::create_dir_all(output).map_err(|e| windows::core::Error::new(windows::core::HRESULT(-1), e.to_string()))?;
        let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(input))?.join()?;
        let doc = PdfDocument::LoadFromFileAsync(&file)?.join()?;
        let count = doc.PageCount()?;
        for i in 0..count {
            let page = doc.GetPage(i)?;
            let size = page.Size()?;
            let options = PdfPageRenderOptions::new()?;
            options.SetDestinationWidth((size.Width * 2.0) as u32)?;
            options.SetDestinationHeight((size.Height * 2.0) as u32)?;
            if jpeg {
                options.SetBitmapEncoderId(BitmapEncoder::JpegEncoderId()?)?;
            }
            let name = format!("Page {}.{}", i + 1, if jpeg { "jpg" } else { "png" });
            let path = std::path::Path::new(output).join(name);
            std::fs::write(&path, b"").map_err(|e| windows::core::Error::new(windows::core::HRESULT(-1), e.to_string()))?;
            let out = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))?.join()?;
            let stream = out.OpenAsync(FileAccessMode::ReadWrite)?.join()?;
            page.RenderWithOptionsToStreamAsync(&stream, &options)?.join()?;
            stream.Close()?;
        }
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_never_overwrite() {
        let dir = std::env::temp_dir().join(format!("convert-test-{}", stamp()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("Report.docx");
        std::fs::write(&input, b"x").unwrap();
        let first = target(&input, "pdf", "");
        assert_eq!(first.file_name().unwrap(), "Report.pdf");
        std::fs::write(&first, b"x").unwrap();
        assert_eq!(target(&input, "pdf", "").file_name().unwrap(), "Report (2).pdf");
        // Same extension as the original: never the original itself.
        assert_eq!(target(&input, "docx", "").file_name().unwrap(), "Report (2).docx");
        assert_eq!(target(&input, "", " slides").file_name().unwrap(), "Report slides");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ffmpeg_knows_every_media_target() {
        for t in ["mp3", "m4a", "wav", "aiff", "flac", "ogg", "opus", "mp4", "mov", "mkv", "webm", "avi", "gif"] {
            assert!(ffmpeg_args(t).is_some(), "{t}");
        }
        assert!(ffmpeg_args("docx").is_none());
    }
}
