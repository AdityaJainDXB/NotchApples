//
//  NotchBehavior.swift
//  Notch apple
//
//  How the notch opens, hides and responds (Settings → Notch):
//   • hover delay, fullscreen and screen-recording auto-hide (free);
//   • open-panel size with live preview, edge trigger zones, per-display tabs
//     and remappable gestures (Pro);
//   • optional sound and haptic cues (off by default).
//
//  Nothing here polls: fullscreen is re-checked only when the front app or the
//  Space changes, and edge zones are plain tracking areas.
//

import AppKit
import SwiftUI

// MARK: - Preferences

enum NotchPrefs {
    @AppStorage("notch.hoverDelay") static var hoverDelay = 0.15
    @AppStorage("notch.autoHideFullscreen") static var autoHideFullscreen = true
    /// Keep the notch on screen over full-screen apps (for Macs without a hardware notch, where it would
    /// otherwise vanish): overrides "Hide in fullscreen apps" and raises the window above full-screen Spaces.
    @AppStorage("notch.keepInFullscreen") static var keepInFullscreen = true
    @AppStorage("notch.autoHideRecording") static var autoHideRecording = false
    /// Expanded panel size (Pro). Defaults match the original fixed size.
    @AppStorage("notch.panelWidth") static var panelWidth = 740.0
    @AppStorage("notch.panelHeight") static var panelHeight = 420.0
    /// "off", "wide" (twice the notch) or "edge" (the whole top edge of the screen). Pro.
    @AppStorage("notch.edgeTrigger") static var edgeTrigger = "off"
    @AppStorage("notch.sounds") static var sounds = false
    @AppStorage("notch.haptics") static var haptics = false

    static let defaultSize = CGSize(width: 740, height: 420)
    static let widthRange: ClosedRange<Double> = 620...1000
    static let heightRange: ClosedRange<Double> = 360...600

    /// Set while a game that needs room (the Plane game) is open: the panel grows to at least this size.
    @MainActor static var bigGameOpen = false
    static let bigGameSize = CGSize(width: 960, height: 600)

    /// The panel size this Mac may use: custom sizes need Pro.
    @MainActor static var panelSize: CGSize {
        var size = defaultSize
        if Entitlements.shared.canUse(.notchResize) {
            size = CGSize(width: panelWidth.clamped(to: widthRange), height: panelHeight.clamped(to: heightRange))
        }
        if bigGameOpen { size = CGSize(width: max(size.width, bigGameSize.width), height: max(size.height, bigGameSize.height)) }
        return size
    }
}

extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self { min(max(self, range.lowerBound), range.upperBound) }
}

// MARK: - Cues

/// Optional sound and trackpad feedback when the notch opens and closes.
@MainActor
enum NotchFeedback {
    static func opened() { cue(sound: StylePrefs.openSound) }
    static func closed() { cue(sound: StylePrefs.closeSound) }
    static func tick() { if NotchPrefs.haptics { NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now) } }

    private static func cue(sound: String) {
        if NotchPrefs.haptics { NSHapticFeedbackManager.defaultPerformer.perform(StylePrefs.haptic, performanceTime: .now) }
        if NotchPrefs.sounds, let s = NSSound(named: sound) { s.volume = 0.35; s.play() }
    }
}

// MARK: - Fullscreen

/// Tells the controller when the front app is fullscreen on the notch's screen,
/// so the notch can step aside (videos, games, presentations).
@MainActor
final class FullscreenWatcher {
    var onChange: (Bool) -> Void = { _ in }
    var screen: () -> NSScreen? = { nil }
    private(set) var isFullscreen = false
    private var observers: [NSObjectProtocol] = []

    func start() {
        let nc = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didActivateApplicationNotification, NSWorkspace.activeSpaceDidChangeNotification] {
            observers.append(nc.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                // Spaces animate for ~0.3 s; check after they settle.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { MainActor.assumeIsolated { self?.check() } }
            })
        }
        check()
    }

    func check() {
        let now = NotchPrefs.autoHideFullscreen && !NotchPrefs.keepInFullscreen && Self.frontAppIsFullscreen(on: screen())
        guard now != isFullscreen else { return }
        isFullscreen = now
        onChange(now)
    }

    /// A normal-level window of the front app that covers the whole screen, menu bar included.
    static func frontAppIsFullscreen(on screen: NSScreen?) -> Bool {
        guard let screen, let app = NSWorkspace.shared.frontmostApplication,
              app.bundleIdentifier != Bundle.main.bundleIdentifier, app.bundleIdentifier != "com.apple.finder",
              let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
        else { return false }
        // CG window bounds are top-left based on the primary display.
        let primaryHeight = NSScreen.screens.first?.frame.height ?? screen.frame.height
        let target = CGRect(x: screen.frame.minX, y: primaryHeight - screen.frame.maxY, width: screen.frame.width, height: screen.frame.height)
        return list.contains { w in
            guard (w[kCGWindowOwnerPID as String] as? pid_t) == app.processIdentifier,
                  (w[kCGWindowLayer as String] as? Int) == 0,
                  let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { return false }
            let r = CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0)
            return abs(r.minX - target.minX) < 2 && abs(r.minY - target.minY) < 2
                && abs(r.width - target.width) < 2 && abs(r.height - target.height) < 2
        }
    }
}

// MARK: - Edge trigger zone (Pro)

/// A thin invisible strip along the top of the screen: resting the pointer there opens the notch,
/// so you don't have to hit the notch exactly.
final class EdgeTriggerView: NSView {
    var onEnter: () -> Void = {}
    var onExit: () -> Void = {}
    private var tracking: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(area)
        tracking = area
    }
    override func mouseEntered(with event: NSEvent) { onEnter() }
    override func mouseExited(with event: NSEvent) { onExit() }
    // Clicks fall through to the menu bar.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

// MARK: - Gestures

/// What a gesture does. The defaults are free; changing them needs Pro.
enum GestureAction: String, CaseIterable, Identifiable {
    case none, volume, track, switchTab, close, open, quickActions
    var id: String { rawValue }
    var title: String {
        switch self {
        case .none: "Nothing"
        case .volume: "Change volume"
        case .track: "Previous / next track"
        case .switchTab: "Switch tabs"
        case .close: "Close the notch"
        case .open: "Open the notch"
        case .quickActions: "Quick actions menu"
        }
    }
}

enum NotchGesture: String, CaseIterable, Identifiable {
    case closedScroll, closedSwipe, closedLongPress, openSwipe, openSwipeUp
    var id: String { rawValue }
    var title: String {
        switch self {
        case .closedScroll: "Two fingers up or down on the closed notch"
        case .closedSwipe: "Swipe sideways on the closed notch"
        case .closedLongPress: "Long-press the closed notch"
        case .openSwipe: "Swipe sideways on the open notch's tab bar"
        case .openSwipeUp: "Swipe up on the open notch's tab bar"
        }
    }
    var defaultAction: GestureAction {
        switch self {
        case .closedScroll: .volume
        case .closedSwipe: .track
        case .closedLongPress: .quickActions
        case .openSwipe: .switchTab
        case .openSwipeUp: .close
        }
    }
    /// Which actions make sense for this gesture.
    var choices: [GestureAction] {
        switch self {
        case .closedScroll: [.none, .volume, .open]
        case .closedSwipe: [.none, .track, .open]
        case .closedLongPress: [.none, .quickActions, .open]
        case .openSwipe: [.none, .switchTab, .track]
        case .openSwipeUp: [.none, .close]
        }
    }
    private var key: String { "gesture.\(rawValue)" }

    @MainActor var action: GestureAction {
        guard Entitlements.shared.canUse(.gestureRemap),
              let raw = UserDefaults.standard.string(forKey: key), let a = GestureAction(rawValue: raw) else { return defaultAction }
        return a
    }
    func set(_ a: GestureAction) { UserDefaults.standard.set(a.rawValue, forKey: key) }
    func storedAction() -> GestureAction { UserDefaults.standard.string(forKey: key).flatMap(GestureAction.init(rawValue:)) ?? defaultAction }
}

// MARK: - Per-display tabs (Pro)

/// Tabs hidden on a particular display, e.g. Messenger only on the laptop screen.
enum DisplayLayouts {
    private static let key = "notch.displayHiddenTabs"

    static func id(for screen: NSScreen) -> String {
        if let n = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
            // The display's serial/vendor survive reconnects better than its index.
            let d = CGDirectDisplayID(n.uint32Value)
            return "\(CGDisplayVendorNumber(d))-\(CGDisplayModelNumber(d))-\(CGDisplaySerialNumber(d))"
        }
        return screen.localizedName
    }

    static func hidden(on screen: NSScreen) -> Set<String> {
        let all = UserDefaults.standard.dictionary(forKey: key) as? [String: [String]] ?? [:]
        return Set(all[id(for: screen)] ?? [])
    }

    static func setHidden(_ tabs: Set<String>, on screen: NSScreen) {
        var all = UserDefaults.standard.dictionary(forKey: key) as? [String: [String]] ?? [:]
        all[id(for: screen)] = Array(tabs).sorted()
        UserDefaults.standard.set(all, forKey: key)
    }

    /// The screen the notch is on right now (set by the controller).
    @MainActor static var currentScreen: NSScreen?
}

// MARK: - Quick actions (long-press)

@MainActor
enum QuickActionsMenu {
    static func show(at point: NSPoint, in view: NSView) {
        let menu = NSMenu()
        func add(_ title: String, _ symbol: String, _ action: @escaping () -> Void) {
            let item = NSMenuItem(title: title, action: #selector(MenuTarget.run(_:)), keyEquivalent: "")
            item.target = MenuTarget.shared
            item.representedObject = action
            item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
            menu.addItem(item)
        }
        add("Timer for 5 minutes", "timer") { CountdownTimer.shared.startTimer(seconds: 300) }
        add("Start stopwatch", "stopwatch") { CountdownTimer.shared.startStopwatch() }
        add("Keep awake for 30 minutes", "cup.and.saucer.fill") { KeepAwake.shared.start(minutes: 30) }
        add("Take a screenshot", "camera.viewfinder") { ScreenCaptureActions.shared.takeScreenshot() }
        if Entitlements.shared.canUse(.dndToggle) {
            add(DNDToggle.isOn ? "Turn Do Not Disturb off" : "Turn Do Not Disturb on", "moon") { DNDToggle.toggle() }
        }
        add(DarkModeToggle.isDark ? "Switch to light mode" : "Switch to dark mode", DarkModeToggle.isDark ? "sun.max" : "moon.stars") { DarkModeToggle.toggle() }
        if Entitlements.shared.canUse(.micMute) {
            add(MicMute.shared.isMuted ? "Unmute microphone" : "Mute microphone", "mic.slash") { MicMute.shared.toggle() }
        }
        if Entitlements.shared.canUse(.aiCapture) {
            add("Ask AI about part of the screen", "sparkles") { CaptureManager.shared.captureToAI() }
        }
        menu.addItem(.separator())
        add("Hide the notch", "eye.slash") { AppDelegate.current?.notch?.setInvisible(true) }
        add("Settings…", "gearshape") { AppDelegate.openSettingsWindow() }
        NotchFeedback.tick()
        menu.popUp(positioning: nil, at: point, in: view)
    }

    private final class MenuTarget: NSObject {
        static let shared = MenuTarget()
        @objc func run(_ sender: NSMenuItem) { (sender.representedObject as? () -> Void)?() }
    }
}

// MARK: - Focus (through Shortcuts)

/// macOS doesn't tell apps when a Focus turns on, so a Shortcuts automation does:
/// "When Work Focus turns on → Open URL notchapple://focus?on=1&profile=Work" (and on=0 when it turns off).
/// While a Focus is on, the notch can stay quiet (no alerts or flashes) or step aside entirely,
/// and with Pro it can switch to the matching profile.
@MainActor
enum FocusBridge {
    @AppStorage("focus.active") static var isOn = false
    @AppStorage("focus.profile") static var profileName = ""
    /// "nothing", "hush" (default) or "hide".
    @AppStorage("focus.behavior") static var behavior = "hush"

    static var hushes: Bool { isOn && behavior != "nothing" }
    static var hides: Bool { isOn && behavior == "hide" }

    static func handle(_ q: [String: String]) {
        isOn = ["1", "true", "on", "yes"].contains((q["on"] ?? "1").lowercased())
        profileName = isOn ? (q["profile"] ?? "") : ""
        Profiles.shared.evaluate()
        AppDelegate.current?.notch?.updateAutoHide()
        LiveActivityCenter.shared.recompute()
    }
}
