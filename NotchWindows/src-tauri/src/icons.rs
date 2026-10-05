//! Real app and file icons for the Launcher, Search and Shelf, from the same
//! shell icons Explorer shows. Returned as base64 PNGs and cached by path.

use std::collections::HashMap;
use std::sync::Mutex;

static CACHE: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

pub fn icon_for(path: &str) -> Option<String> {
    if let Ok(guard) = CACHE.lock() {
        if let Some(hit) = guard.as_ref().and_then(|c| c.get(path)) {
            return hit.clone();
        }
    }
    #[cfg(windows)]
    let icon = imp::extract(path);
    #[cfg(not(windows))]
    let icon: Option<String> = None;
    if let Ok(mut guard) = CACHE.lock() {
        guard.get_or_insert_with(HashMap::new).insert(path.to_string(), icon.clone());
    }
    icon
}

#[tauri::command]
pub async fn icons(paths: Vec<String>) -> HashMap<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_APARTMENTTHREADED);
        }
        paths
            .into_iter()
            .take(400)
            .filter_map(|p| icon_for(&p).map(|i| (p, i)))
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[cfg(windows)]
mod imp {
    use base64::Engine;
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use windows::Win32::UI::Shell::{SHGetFileInfoW, SHParseDisplayName, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_PIDL};
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

    pub fn extract(path: &str) -> Option<String> {
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut info = SHFILEINFOW::default();
        let ok = unsafe {
            if path.starts_with("shell:") {
                // Store apps have no file: ask the shell for its item instead.
                let mut pidl: *mut ITEMIDLIST = std::ptr::null_mut();
                if SHParseDisplayName(PCWSTR(wide.as_ptr()), None, &mut pidl, 0, None).is_err() || pidl.is_null() {
                    return None;
                }
                let r = SHGetFileInfoW(
                    PCWSTR(pidl as *const u16),
                    FILE_FLAGS_AND_ATTRIBUTES(0),
                    Some(&mut info),
                    std::mem::size_of::<SHFILEINFOW>() as u32,
                    SHGFI_PIDL | SHGFI_ICON | SHGFI_LARGEICON,
                );
                CoTaskMemFree(Some(pidl as _));
                r
            } else {
                SHGetFileInfoW(
                    PCWSTR(wide.as_ptr()),
                    FILE_FLAGS_AND_ATTRIBUTES(0),
                    Some(&mut info),
                    std::mem::size_of::<SHFILEINFOW>() as u32,
                    SHGFI_ICON | SHGFI_LARGEICON,
                )
            }
        };
        if ok == 0 || info.hIcon.is_invalid() {
            return None;
        }
        let png = to_png(info.hIcon);
        unsafe {
            let _ = DestroyIcon(info.hIcon);
        }
        png
    }

    fn to_png(icon: HICON) -> Option<String> {
        unsafe {
            let mut ii = ICONINFO::default();
            GetIconInfo(icon, &mut ii).ok()?;
            let color = ii.hbmColor;
            let mask = ii.hbmMask;
            let cleanup = || {
                if !color.is_invalid() {
                    let _ = DeleteObject(HGDIOBJ(color.0));
                }
                if !mask.is_invalid() {
                    let _ = DeleteObject(HGDIOBJ(mask.0));
                }
            };
            if color.is_invalid() {
                cleanup();
                return None;
            }
            let mut bm = BITMAP::default();
            if GetObjectW(HGDIOBJ(color.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut _)) == 0 {
                cleanup();
                return None;
            }
            let (w, h) = (bm.bmWidth, bm.bmHeight);
            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // top-down rows
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut pixels = vec![0u8; (w * h * 4) as usize];
            let dc = CreateCompatibleDC(None);
            let rows = GetDIBits(dc, color, 0, h as u32, Some(pixels.as_mut_ptr() as _), &mut bmi, DIB_RGB_COLORS);
            let _ = DeleteDC(dc);
            cleanup();
            if rows == 0 {
                return None;
            }
            // BGRA -> RGBA. Old icons have no alpha at all: make them opaque.
            let has_alpha = pixels.chunks(4).any(|p| p[3] != 0);
            for p in pixels.chunks_mut(4) {
                p.swap(0, 2);
                if !has_alpha {
                    p[3] = 255;
                }
            }
            let img = image::RgbaImage::from_raw(w as u32, h as u32, pixels)?;
            let mut out = std::io::Cursor::new(Vec::new());
            img.write_to(&mut out, image::ImageFormat::Png).ok()?;
            Some(base64::engine::general_purpose::STANDARD.encode(out.into_inner()))
        }
    }
}
