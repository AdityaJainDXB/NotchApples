//! Do It's Windows-only senses and hands (Ultimate): the UI Automation element tree and element actions (so the agent can
//! press real controls instead of guessing pixels), human-like pointer moves over the whole virtual desktop (so hover
//! tracking, menus and mixed-DPI multi-monitor setups work), the monitor the target window is on, and a plain answer when
//! the target window is elevated (admin) and our input would be ignored (UIPI). No tauri types here, so this file can be
//! type-checked on its own.
//!
//! UI Automation is COM and its objects must stay on one thread, so everything UIA runs on a single worker thread that
//! owns the automation object and the last tree's elements; commands reach it over a channel. Element ids handed to the
//! page are indexes into that cached list and are only valid until the next tree.

use serde::Serialize;

/// What the agent is about to act on: the foreground window, its monitor, and whether it would ignore our input.
#[derive(Serialize, Default, Clone)]
pub struct TargetInfo {
    pub title: String,
    /// The monitor the foreground window is on, in physical pixels.
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
    /// True when the window runs elevated (as administrator), so our input would be silently ignored (UIPI).
    pub elevated: bool,
}

/// One interactive element from the UI Automation tree.
#[derive(Serialize, Clone)]
pub struct TreeElement {
    pub id: usize,
    pub role: String,
    pub label: String,
    pub value: String,
    /// Physical pixels on the virtual desktop.
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub focused: bool,
    pub menu: bool,
    pub front: bool,
}

/// Where (x) lands on a 0–65535 absolute-input axis that spans the virtual desktop from `v0` for `span` pixels.
pub fn norm_axis(x: i32, v0: i32, span: i32) -> i32 {
    (((x - v0) as f64 * 65535.0 / span.max(1) as f64).round() as i32).clamp(0, 65535)
}

#[cfg(test)]
mod tests {
    #[test]
    fn absolute_moves_span_the_virtual_desktop() {
        assert_eq!(super::norm_axis(0, 0, 1920), 0);
        assert_eq!(super::norm_axis(1920, 0, 1920), 65535);
        assert_eq!(super::norm_axis(960, 0, 1920), 32768);
        assert_eq!(super::norm_axis(-1920, -1920, 3840), 0, "a monitor left of the primary starts at 0");
        assert_eq!(super::norm_axis(5000, 0, 1920), 65535, "out of range stays on the desktop");
        assert_eq!(super::norm_axis(10, 0, 0), 65535, "a zero-size desktop cannot divide by zero");
    }
}

#[cfg(windows)]
mod imp {
use super::{TargetInfo, TreeElement};


use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::mem::ManuallyDrop;
use windows::core::BSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, POINT, RECT};
use windows::Win32::System::Variant::{VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_BSTR, VT_I4};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTOPRIMARY};
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Threading::{OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationExpandCollapsePattern, IUIAutomationInvokePattern,
    IUIAutomationScrollPattern, IUIAutomationSelectionItemPattern, IUIAutomationTogglePattern, IUIAutomationValuePattern,
    TreeScope_Children, TreeScope_Descendants, TreeScope_Subtree, UIA_ExpandCollapsePatternId, UIA_InvokePatternId,
    UIA_MenuBarControlTypeId, UIA_MenuControlTypeId, UIA_MenuItemControlTypeId, UIA_NamePropertyId, UIA_ScrollPatternId,
    UIA_SelectionItemPatternId, UIA_TogglePatternId, UIA_ValuePatternId, ExpandCollapseState_Collapsed,
    ScrollAmount_SmallDecrement, ScrollAmount_SmallIncrement, ScrollAmount_NoAmount,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_MOVE, MOUSEEVENTF_VIRTUALDESK, MOUSEINPUT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    SetForegroundWindow, ShowWindow, GetSystemMetrics, SW_RESTORE, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
    SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, GetCursorPos,
};

/// A VARIANT holding a string (for UIA property conditions). The BSTR is handed to COM and not freed here:
/// a few dozen bytes per menu walk, released when the process ends.
fn variant_str(s: &str) -> VARIANT {
    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_BSTR,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: VARIANT_0_0_0 { bstrVal: ManuallyDrop::new(BSTR::from(s)) },
            }),
        },
    }
}

/// A VARIANT holding an i32 (for UIA control-type conditions).
fn variant_i4(n: i32) -> VARIANT {
    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_I4,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: VARIANT_0_0_0 { lVal: n },
            }),
        },
    }
}

fn pause(ms: u64) {
    std::thread::sleep(std::time::Duration::from_millis(ms));
}

// ---- the pointer, moved like a hand --------------------------------------------------------------------------------

/// One absolute pointer move over the whole virtual desktop (all monitors, any DPI), in physical pixels.
pub fn move_pointer(x: i32, y: i32) {
    unsafe {
        let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1);
        let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN).max(1);
        let nx = super::norm_axis(x, vx, vw);
        let ny = super::norm_axis(y, vy, vh);
        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: nx,
                    dy: ny,
                    mouseData: 0,
                    dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

/// Moves the pointer to (x, y) the way a person would: several small steps with short pauses, so menus, hover
/// tracking and tooltips see real movement instead of a teleport. Ends with a short dwell.
pub fn glide_pointer(x: i32, y: i32) {
    let mut from = POINT::default();
    unsafe {
        let _ = GetCursorPos(&mut from);
    }
    let (dx, dy) = ((x - from.x) as f64, (y - from.y) as f64);
    let dist = (dx * dx + dy * dy).sqrt();
    let steps = (dist / 60.0).ceil().clamp(1.0, 14.0) as i32;
    for k in 1..=steps {
        let t = k as f64 / steps as f64;
        // Ease out: fast at first, slowing near the target, like a hand.
        let e = 1.0 - (1.0 - t) * (1.0 - t);
        move_pointer(from.x + (dx * e).round() as i32, from.y + (dy * e).round() as i32);
        pause(12);
    }
    move_pointer(x, y);
    pause(100); // dwell, so the control under the pointer notices the hover
}

// ---- the target window ---------------------------------------------------------------------------------------------


fn window_title(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

fn process_elevated(pid: u32) -> bool {
    unsafe {
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return true; // we may not even look at it: treat as elevated
        };
        let mut token = HANDLE::default();
        let elevated = if OpenProcessToken(process, TOKEN_QUERY, &mut token).is_ok() {
            let mut info = TOKEN_ELEVATION::default();
            let mut got = 0u32;
            let ok = GetTokenInformation(token, TokenElevation, Some(&mut info as *mut _ as *mut _), std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut got).is_ok();
            let _ = CloseHandle(token);
            ok && info.TokenIsElevated != 0
        } else {
            true
        };
        let _ = CloseHandle(process);
        elevated
    }
}

/// Our own process: if Notch Apple itself runs elevated, UIPI never blocks it and `elevated` below is moot.
fn self_elevated() -> bool {
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(windows::Win32::System::Threading::GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut info = TOKEN_ELEVATION::default();
        let mut got = 0u32;
        let ok = GetTokenInformation(token, TokenElevation, Some(&mut info as *mut _ as *mut _), std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut got).is_ok();
        let _ = CloseHandle(token);
        ok && info.TokenIsElevated != 0
    }
}

/// The foreground window's title, its monitor (physical pixels) and whether it would ignore our input (elevated).
pub fn target_info() -> TargetInfo {
    unsafe {
        let hwnd = GetForegroundWindow();
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY);
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        let r = if GetMonitorInfoW(monitor, &mut info).as_bool() {
            info.rcMonitor
        } else {
            RECT { left: 0, top: 0, right: GetSystemMetrics(windows::Win32::UI::WindowsAndMessaging::SM_CXSCREEN), bottom: GetSystemMetrics(windows::Win32::UI::WindowsAndMessaging::SM_CYSCREEN) }
        };
        let mut pid = 0u32;
        if !hwnd.is_invalid() {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        let elevated = pid != 0 && !self_elevated() && process_elevated(pid);
        TargetInfo { title: window_title(hwnd), left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top, elevated }
    }
}

/// Brings the first visible window whose title contains `name` (case-insensitive) to the front. Ok(title) on success.
pub fn focus_window(name: &str) -> Result<String, String> {
    struct Search {
        want: String,
        found: Option<HWND>,
    }
    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
        let search = unsafe { &mut *(lparam.0 as *mut Search) };
        if unsafe { IsWindowVisible(hwnd) }.as_bool() {
            let title = window_title(hwnd);
            if !title.is_empty() && title.to_lowercase().contains(&search.want) {
                search.found = Some(hwnd);
                return false.into();
            }
        }
        true.into()
    }
    let mut search = Search { want: name.trim().to_lowercase(), found: None };
    if search.want.is_empty() {
        return Err("No app name given.".into());
    }
    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut search as *mut _ as isize));
        let Some(hwnd) = search.found else {
            return Err(format!("No open window matches \"{}\".", name.trim()));
        };
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let _ = SetForegroundWindow(hwnd);
        pause(250);
        Ok(window_title(hwnd))
    }
}

// ---- UI Automation: the element tree and element actions ------------------------------------------------------------


enum Req {
    Tree(mpsc::Sender<Result<Vec<TreeElement>, String>>),
    /// (element id, action, value) → a short description of what was done, or why not.
    Act(usize, String, String, mpsc::Sender<Result<String, String>>),
    /// A menu path like ["File", "Export"] walked with UIA on the foreground window.
    Menu(Vec<String>, mpsc::Sender<Result<String, String>>),
}

static WORKER: OnceLock<Mutex<mpsc::Sender<Req>>> = OnceLock::new();

fn worker() -> mpsc::Sender<Req> {
    WORKER
        .get_or_init(|| {
            let (tx, rx) = mpsc::channel::<Req>();
            std::thread::Builder::new()
                .name("doit-uia".into())
                .spawn(move || uia_thread(rx))
                .expect("spawn uia thread");
            Mutex::new(tx)
        })
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|e| e.into_inner().clone())
}

fn ask<T: Send + 'static>(make: impl FnOnce(mpsc::Sender<Result<T, String>>) -> Req) -> Result<T, String> {
    let (tx, rx) = mpsc::channel();
    worker().send(make(tx)).map_err(|_| "The accessibility reader is not running.".to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(10)).map_err(|_| "Reading the UI took too long.".to_string())?
}

/// The interactive elements of the foreground window and any open menus. Call from any thread.
pub fn tree() -> Result<Vec<TreeElement>, String> {
    ask(Req::Tree)
}

/// Performs `action` ("invoke", "focus", "set_value", "select", "select_option", "expand", "toggle", "scroll_down", "scroll_up")
/// on element `id` from the last tree. Call from any thread.
pub fn element_action(id: usize, action: &str, value: &str) -> Result<String, String> {
    ask(|tx| Req::Act(id, action.into(), value.into(), tx))
}

/// Opens the foreground window's menu bar and walks `path` ("File", then "Export…"). Call from any thread.
pub fn menu_path(path: Vec<String>) -> Result<String, String> {
    ask(|tx| Req::Menu(path, tx))
}

struct Uia {
    automation: IUIAutomation,
    /// The elements handed out with the last tree, so an id can be acted on.
    cache: Vec<IUIAutomationElement>,
}

fn uia_thread(rx: mpsc::Receiver<Req>) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    let automation: Option<IUIAutomation> = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok() };
    let Some(automation) = automation else {
        // Answer every request with the same failure rather than hanging callers.
        while let Ok(req) = rx.recv() {
            let msg = "UI Automation is not available on this system.".to_string();
            match req {
                Req::Tree(tx) => drop(tx.send(Err(msg))),
                Req::Act(_, _, _, tx) | Req::Menu(_, tx) => drop(tx.send(Err(msg))),
            }
        }
        return;
    };
    let mut state = Uia { automation, cache: Vec::new() };
    while let Ok(req) = rx.recv() {
        match req {
            Req::Tree(tx) => drop(tx.send(read_tree(&mut state))),
            Req::Act(id, action, value, tx) => drop(tx.send(act(&state, id, &action, &value))),
            Req::Menu(path, tx) => drop(tx.send(walk_menu(&state, &path))),
        }
    }
}

fn bstr_of(e: &IUIAutomationElement, what: &str) -> String {
    unsafe {
        match what {
            "name" => e.CurrentName().map(|b| b.to_string()).unwrap_or_default(),
            _ => e.CurrentLocalizedControlType().map(|b| b.to_string()).unwrap_or_default(),
        }
    }
}

fn value_of(e: &IUIAutomationElement) -> String {
    unsafe {
        if let Ok(p) = e.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) {
            return p.CurrentValue().map(|b| b.to_string()).unwrap_or_default();
        }
        String::new()
    }
}

fn has_pattern(e: &IUIAutomationElement, id: windows::Win32::UI::Accessibility::UIA_PATTERN_ID) -> bool {
    unsafe { e.GetCurrentPattern(id).is_ok() }
}

/// Is this something the agent could press, pick, toggle, type into or scroll?
fn interactive(e: &IUIAutomationElement) -> bool {
    unsafe {
        if !e.CurrentIsEnabled().map(|b| b.as_bool()).unwrap_or(false) {
            return false;
        }
        if e.CurrentIsOffscreen().map(|b| b.as_bool()).unwrap_or(true) {
            return false;
        }
        e.CurrentIsKeyboardFocusable().map(|b| b.as_bool()).unwrap_or(false)
            || has_pattern(e, UIA_InvokePatternId)
            || has_pattern(e, UIA_SelectionItemPatternId)
            || has_pattern(e, UIA_TogglePatternId)
            || has_pattern(e, UIA_ExpandCollapsePatternId)
            || has_pattern(e, UIA_ValuePatternId)
    }
}

fn push_element(state: &mut Uia, out: &mut Vec<TreeElement>, e: IUIAutomationElement, focused: &Option<IUIAutomationElement>, menu: bool, front: bool) {
    unsafe {
        let r = e.CurrentBoundingRectangle().unwrap_or_default();
        if r.right <= r.left || r.bottom <= r.top {
            return;
        }
        let is_focused = focused
            .as_ref()
            .map(|f| state.automation.CompareElements(f, &e).map(|b| b.as_bool()).unwrap_or(false))
            .unwrap_or(false);
        out.push(TreeElement {
            id: out.len(),
            role: bstr_of(&e, "role"),
            label: bstr_of(&e, "name"),
            value: value_of(&e),
            x: r.left,
            y: r.top,
            w: r.right - r.left,
            h: r.bottom - r.top,
            focused: is_focused,
            menu,
            front,
        });
        state.cache.push(e);
    }
}

/// Walks `root` breadth-first with the control view, collecting interactive elements, up to `cap`.
fn collect(state: &mut Uia, out: &mut Vec<TreeElement>, root: &IUIAutomationElement, focused: &Option<IUIAutomationElement>, menu: bool, front: bool, cap: usize) {
    unsafe {
        let Ok(walker) = state.automation.ControlViewWalker() else { return };
        let mut queue: Vec<(IUIAutomationElement, usize)> = vec![(root.clone(), 0)];
        let mut seen = 0usize;
        while let Some((node, depth)) = queue.pop() {
            seen += 1;
            if out.len() >= cap || seen > 1200 || depth > 12 {
                return;
            }
            let mut child = walker.GetFirstChildElement(&node).ok();
            while let Some(c) = child {
                if interactive(&c) {
                    push_element(state, out, c.clone(), focused, menu, front);
                    if out.len() >= cap {
                        return;
                    }
                }
                let next = walker.GetNextSiblingElement(&c).ok();
                queue.insert(0, (c, depth + 1));
                child = next;
            }
        }
    }
}

fn read_tree(state: &mut Uia) -> Result<Vec<TreeElement>, String> {
    state.cache.clear();
    let mut out: Vec<TreeElement> = Vec::new();
    unsafe {
        let focused = state.automation.GetFocusedElement().ok();
        // Open menus and popups first: they are what the agent most likely wants right now.
        if let Ok(root) = state.automation.GetRootElement() {
            if let Ok(walker) = state.automation.ControlViewWalker() {
                let mut child = walker.GetFirstChildElement(&root).ok();
                let mut tops = 0;
                while let Some(c) = child {
                    tops += 1;
                    if tops > 64 {
                        break;
                    }
                    let next = walker.GetNextSiblingElement(&c).ok();
                    let ct = c.CurrentControlType().unwrap_or_default();
                    if ct == UIA_MenuControlTypeId {
                        push_element(state, &mut out, c.clone(), &focused, true, true);
                        collect(state, &mut out, &c, &focused, true, true, 200);
                    }
                    child = next;
                }
            }
        }
        // Then the foreground window.
        let hwnd = GetForegroundWindow();
        if !hwnd.is_invalid() {
            if let Ok(window) = state.automation.ElementFromHandle(hwnd) {
                collect(state, &mut out, &window, &focused, false, true, 400);
            }
        }
    }
    Ok(out)
}

fn element(state: &Uia, id: usize) -> Result<&IUIAutomationElement, String> {
    state.cache.get(id).ok_or_else(|| format!("There is no element {id} in the current list; read the screen again."))
}

fn act(state: &Uia, id: usize, action: &str, value: &str) -> Result<String, String> {
    let e = element(state, id)?;
    let name = bstr_of(e, "name");
    unsafe {
        match action {
            "focus" => {
                e.SetFocus().map_err(|err| err.to_string())?;
                Ok(format!("focused \"{name}\""))
            }
            "invoke" => {
                let _ = e.SetFocus();
                if let Ok(p) = e.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) {
                    p.Invoke().map_err(|err| err.to_string())?;
                    return Ok(format!("pressed \"{name}\""));
                }
                if let Ok(p) = e.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId) {
                    p.Toggle().map_err(|err| err.to_string())?;
                    return Ok(format!("toggled \"{name}\""));
                }
                if let Ok(p) = e.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId) {
                    p.Select().map_err(|err| err.to_string())?;
                    return Ok(format!("selected \"{name}\""));
                }
                if let Ok(p) = e.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId) {
                    p.Expand().map_err(|err| err.to_string())?;
                    return Ok(format!("opened \"{name}\""));
                }
                Err(format!("\"{name}\" cannot be pressed through accessibility; click it instead."))
            }
            "toggle" => {
                let p = e.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId).map_err(|_| format!("\"{name}\" is not a toggle."))?;
                p.Toggle().map_err(|err| err.to_string())?;
                Ok(format!("toggled \"{name}\""))
            }
            "set_value" => {
                let _ = e.SetFocus();
                let p = e
                    .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                    .map_err(|_| format!("\"{name}\" does not take a value; focus it and type instead."))?;
                p.SetValue(&BSTR::from(value)).map_err(|err| err.to_string())?;
                Ok(format!("set \"{name}\" to \"{value}\""))
            }
            "select" => {
                let p = e
                    .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
                    .map_err(|_| format!("\"{name}\" is not a selectable item."))?;
                p.Select().map_err(|err| err.to_string())?;
                Ok(format!("selected \"{name}\""))
            }
            "expand" => {
                let p = e
                    .GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId)
                    .map_err(|_| format!("\"{name}\" does not open."))?;
                p.Expand().map_err(|err| err.to_string())?;
                Ok(format!("opened \"{name}\""))
            }
            "select_option" => {
                // Open the control if it opens, then pick the named option among its items.
                if let Ok(p) = e.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId) {
                    if p.CurrentExpandCollapseState().unwrap_or(ExpandCollapseState_Collapsed) == ExpandCollapseState_Collapsed {
                        let _ = p.Expand();
                        pause(350);
                    }
                }
                let cond = state
                    .automation
                    .CreatePropertyCondition(UIA_NamePropertyId, &variant_str(value))
                    .map_err(|err| err.to_string())?;
                let item = e
                    .FindFirst(TreeScope_Subtree, &cond)
                    .map_err(|_| format!("No option called \"{value}\" in \"{name}\"."))?;
                if let Ok(p) = item.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId) {
                    p.Select().map_err(|err| err.to_string())?;
                } else if let Ok(p) = item.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) {
                    p.Invoke().map_err(|err| err.to_string())?;
                } else {
                    return Err(format!("\"{value}\" was found but cannot be picked through accessibility."));
                }
                Ok(format!("picked \"{value}\" in \"{name}\""))
            }
            "scroll_down" | "scroll_up" => {
                let p = e
                    .GetCurrentPatternAs::<IUIAutomationScrollPattern>(UIA_ScrollPatternId)
                    .map_err(|_| format!("\"{name}\" does not scroll through accessibility."))?;
                let amount = if action == "scroll_down" { ScrollAmount_SmallIncrement } else { ScrollAmount_SmallDecrement };
                p.Scroll(ScrollAmount_NoAmount, amount).map_err(|err| err.to_string())?;
                Ok(format!("scrolled \"{name}\""))
            }
            other => Err(format!("I don't know the element action \"{other}\".")),
        }
    }
}

/// Finds a child (or descendant, two levels) called `title` under `root` and returns it.
fn find_named(state: &Uia, root: &IUIAutomationElement, title: &str) -> Result<IUIAutomationElement, String> {
    unsafe {
        let cond = state
            .automation
            .CreatePropertyCondition(UIA_NamePropertyId, &variant_str(title))
            .map_err(|err| err.to_string())?;
        root.FindFirst(TreeScope_Descendants, &cond).map_err(|_| format!("No menu item called \"{title}\"."))
    }
}

fn open_item(item: &IUIAutomationElement) -> Result<(), String> {
    unsafe {
        if let Ok(p) = item.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId) {
            p.Expand().map_err(|err| err.to_string())?;
            return Ok(());
        }
        if let Ok(p) = item.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) {
            p.Invoke().map_err(|err| err.to_string())?;
            return Ok(());
        }
        Err("That menu item cannot be opened through accessibility.".into())
    }
}

/// Walks a menu path on the foreground window: opens the bar item, then each submenu, and invokes the last item.
fn walk_menu(state: &Uia, path: &[String]) -> Result<String, String> {
    if path.is_empty() {
        return Err("The menu path is empty.".into());
    }
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return Err("No window is in front.".into());
        }
        let window = state.automation.ElementFromHandle(hwnd).map_err(|err| err.to_string())?;
        // The menu bar, when there is one; otherwise search the window (ribbon apps expose items differently).
        let mut scope = window.clone();
        if let Ok(cond) = state.automation.CreatePropertyCondition(
            windows::Win32::UI::Accessibility::UIA_ControlTypePropertyId,
            &variant_i4(UIA_MenuBarControlTypeId.0),
        ) {
            if let Ok(bar) = window.FindFirst(TreeScope_Children, &cond) {
                scope = bar;
            }
        }
        let mut current = find_named(state, &scope, &path[0])?;
        for (i, title) in path.iter().enumerate() {
            if i > 0 {
                // After opening the previous level, the submenu appears under the desktop root.
                pause(350);
                let root = state.automation.GetRootElement().map_err(|err| err.to_string())?;
                current = find_named(state, &root, title)?;
                let ct = current.CurrentControlType().unwrap_or_default();
                if ct != UIA_MenuItemControlTypeId && ct != UIA_MenuControlTypeId {
                    // Fine: some apps expose submenu entries as other types; take the named element anyway.
                }
            }
            if i + 1 == path.len() {
                if let Ok(p) = current.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) {
                    p.Invoke().map_err(|err| err.to_string())?;
                } else {
                    open_item(&current)?;
                }
            } else {
                open_item(&current)?;
            }
        }
        Ok(format!("opened menu {}", path.join(" > ")))
    }
}

}

#[cfg(windows)]
pub use imp::*;

// On other platforms (the Mac app has its own engine; cargo test runs on any host) these are inert stand-ins.
#[cfg(not(windows))]
mod stub {
    use super::{TargetInfo, TreeElement};
    const ONLY: &str = "Windows only.";
    pub fn move_pointer(_x: i32, _y: i32) {}
    pub fn glide_pointer(_x: i32, _y: i32) {}
    pub fn target_info() -> TargetInfo { TargetInfo::default() }
    pub fn focus_window(_name: &str) -> Result<String, String> { Err(ONLY.into()) }
    pub fn tree() -> Result<Vec<TreeElement>, String> { Err(ONLY.into()) }
    pub fn element_action(_id: usize, _action: &str, _value: &str) -> Result<String, String> { Err(ONLY.into()) }
    pub fn menu_path(_path: Vec<String>) -> Result<String, String> { Err(ONLY.into()) }
}

#[cfg(not(windows))]
pub use stub::*;
