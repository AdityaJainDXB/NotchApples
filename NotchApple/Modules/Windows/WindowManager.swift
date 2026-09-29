//
//  WindowManager.swift
//  Notch apple
//
//  Moves and resizes other apps' windows through the Accessibility API
//  (the same approach as Rectangle or Magnet). Needs the Accessibility
//  permission in System Settings → Privacy & Security; nothing else.
//
//  Coordinates: AX uses a top-left origin on the primary display, AppKit a
//  bottom-left one. Everything public here takes AppKit rects and converts.
//

import AppKit
import ApplicationServices

/// A place on the screen a window can snap to, as fractions of the usable area.
enum SnapLayout: String, CaseIterable, Identifiable, Codable {
    case leftHalf, rightHalf, topHalf, bottomHalf, maximize, center, leftTwoThirds, rightTwoThirds
    case topLeft, topRight, bottomLeft, bottomRight, leftThird, centerThird, rightThird, almostMaximize

    var id: String { rawValue }

    var title: String {
        switch self {
        case .leftHalf: "Left half"
        case .rightHalf: "Right half"
        case .topHalf: "Top half"
        case .bottomHalf: "Bottom half"
        case .maximize: "Fill screen"
        case .center: "Center"
        case .leftTwoThirds: "Left two thirds"
        case .rightTwoThirds: "Right two thirds"
        case .topLeft: "Top left"
        case .topRight: "Top right"
        case .bottomLeft: "Bottom left"
        case .bottomRight: "Bottom right"
        case .leftThird: "Left third"
        case .centerThird: "Center third"
        case .rightThird: "Right third"
        case .almostMaximize: "Almost fill"
        }
    }

    /// Unit rect with a top-left origin (x, y, w, h), used both for snapping
    /// and for drawing the little preview tiles.
    var unit: CGRect {
        let t: CGFloat = 1.0 / 3
        switch self {
        case .leftHalf: return CGRect(x: 0, y: 0, width: 0.5, height: 1)
        case .rightHalf: return CGRect(x: 0.5, y: 0, width: 0.5, height: 1)
        case .topHalf: return CGRect(x: 0, y: 0, width: 1, height: 0.5)
        case .bottomHalf: return CGRect(x: 0, y: 0.5, width: 1, height: 0.5)
        case .maximize: return CGRect(x: 0, y: 0, width: 1, height: 1)
        case .center: return CGRect(x: 0.2, y: 0.15, width: 0.6, height: 0.7)
        case .almostMaximize: return CGRect(x: 0.05, y: 0.05, width: 0.9, height: 0.9)
        case .leftTwoThirds: return CGRect(x: 0, y: 0, width: 2 * t, height: 1)
        case .rightTwoThirds: return CGRect(x: t, y: 0, width: 2 * t, height: 1)
        case .topLeft: return CGRect(x: 0, y: 0, width: 0.5, height: 0.5)
        case .topRight: return CGRect(x: 0.5, y: 0, width: 0.5, height: 0.5)
        case .bottomLeft: return CGRect(x: 0, y: 0.5, width: 0.5, height: 0.5)
        case .bottomRight: return CGRect(x: 0.5, y: 0.5, width: 0.5, height: 0.5)
        case .leftThird: return CGRect(x: 0, y: 0, width: t, height: 1)
        case .centerThird: return CGRect(x: t, y: 0, width: t, height: 1)
        case .rightThird: return CGRect(x: 2 * t, y: 0, width: t, height: 1)
        }
    }

    /// The two rows of snap zones shown when a window is dragged to the notch.
    static let dropRows: [[SnapLayout]] = [
        [.leftHalf, .rightHalf, .topHalf, .bottomHalf, .leftTwoThirds, .rightTwoThirds, .maximize, .center],
        [.topLeft, .topRight, .bottomLeft, .bottomRight, .leftThird, .centerThird, .rightThird, .almostMaximize],
    ]
}

/// Ways to tile every visible window on a screen at once.
enum TileArrangement: String, CaseIterable, Identifiable {
    case sideBySide, columns, grid, mainAndStack, cascade

    var id: String { rawValue }

    var title: String {
        switch self {
        case .sideBySide: "Split screen"
        case .columns: "3 columns"
        case .grid: "Grid (4 / 6 / 9)"
        case .mainAndStack: "Main + stack"
        case .cascade: "Cascade"
        }
    }

    var symbol: String {
        switch self {
        case .sideBySide: "rectangle.split.2x1"
        case .columns: "rectangle.split.3x1"
        case .grid: "rectangle.split.2x2"
        case .mainAndStack: "rectangle.leadinghalf.inset.filled"
        case .cascade: "square.stack.3d.down.right"
        }
    }

    /// Unit rects (top-left origin) for `count` windows, front-most first.
    func units(for count: Int) -> [CGRect] {
        guard count > 0 else { return [] }
        switch self {
        case .sideBySide:
            let n = min(count, 2)
            return (0..<n).map { CGRect(x: CGFloat($0) / CGFloat(n), y: 0, width: 1 / CGFloat(n), height: 1) }
        case .columns:
            let n = min(count, 3)
            return (0..<n).map { CGRect(x: CGFloat($0) / CGFloat(n), y: 0, width: 1 / CGFloat(n), height: 1) }
        case .grid:
            let n = min(count, 9)
            let cols = n <= 1 ? 1 : n <= 4 ? 2 : 3
            let rows = Int((Double(n) / Double(cols)).rounded(.up))
            return (0..<n).map { i in
                CGRect(x: CGFloat(i % cols) / CGFloat(cols), y: CGFloat(i / cols) / CGFloat(rows),
                       width: 1 / CGFloat(cols), height: 1 / CGFloat(rows))
            }
        case .mainAndStack:
            if count == 1 { return [CGRect(x: 0, y: 0, width: 1, height: 1)] }
            let stack = min(count - 1, 4)
            return [CGRect(x: 0, y: 0, width: 0.6, height: 1)] + (0..<stack).map {
                CGRect(x: 0.6, y: CGFloat($0) / CGFloat(stack), width: 0.4, height: 1 / CGFloat(stack))
            }
        case .cascade:
            let n = min(count, 8)
            return (0..<n).map { i in
                let o = CGFloat(n - 1 - i) * 0.035
                return CGRect(x: 0.08 + o, y: 0.06 + o, width: 0.6, height: 0.7)
            }
        }
    }
}

/// A window of another app, found through Accessibility.
struct ManagedWindow {
    let element: AXUIElement
    let pid: pid_t
    let appName: String
    let bundleID: String?
    let title: String
}

@MainActor
final class WindowManager: ObservableObject {
    static let shared = WindowManager()

    @Published private(set) var isTrusted = AXIsProcessTrusted()
    @Published private(set) var lastMessage: String?
    @Published private(set) var canRestore = false

    /// The last app that was active other than Notch apple, so notch buttons
    /// act on the window you were just using.
    private var lastOtherApp: NSRunningApplication?
    /// Frames before the last snap, so it can be undone.
    private var undo: (element: AXUIElement, frame: CGRect)?
    private var observer: NSObjectProtocol?

    private init() {
        refreshTrust()
        lastOtherApp = NSWorkspace.shared.frontmostApplication.flatMap { $0 == .current ? nil : $0 }
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  app != .current else { return }
            MainActor.assumeIsolated { WindowManager.shared.lastOtherApp = app }
        }
    }

    // MARK: Permission

    func refreshTrust() {
        isTrusted = AXIsProcessTrusted()
        #if DEBUG
        // Screenshot builds: show the full UI without the permission.
        if ProcessInfo.processInfo.environment["NOTCH_PREVIEW_WINDOWS"] != nil { isTrusted = true }
        #endif
    }

    /// Shows the system prompt, which also adds Notch apple to the Accessibility
    /// list, then opens that list and watches for the switch being turned on.
    func requestAccess() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        isTrusted = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
        if !isTrusted, let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
        watchForTrust()
    }

    /// Asks once per install, at launch, so Notch apple shows up in the list.
    func promptOnceIfNeeded() {
        let key = "windows.promptedFor.\(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "")"
        guard !AXIsProcessTrusted(), !UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(true, forKey: key)
        let option = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([option: true] as CFDictionary)
        watchForTrust()
    }

    private var trustTimer: Timer?

    /// Updates the UI by itself once the switch is turned on (no relaunch needed).
    private func watchForTrust() {
        trustTimer?.invalidate()
        var checks = 0
        trustTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { timer in
            MainActor.assumeIsolated {
                checks += 1
                WindowManager.shared.refreshTrust()
                if WindowManager.shared.isTrusted || checks > 300 { timer.invalidate() }
            }
        }
    }

    // MARK: Snapping

    /// Snaps the window you were last using (the front window of the front app).
    func snapFrontWindow(_ layout: SnapLayout) {
        guard ensureTrusted(), let window = frontWindow() else { return }
        snap(window, to: layout)
    }

    func snap(_ element: AXUIElement, to layout: SnapLayout) {
        guard ensureTrusted(), let current = frame(of: element) else { return }
        let screen = screen(containing: current)
        let target: CGRect
        if layout == .center {
            // Keep the size, just move to the middle (shrinking if it wouldn't fit).
            let area = screen.visibleFrame
            let size = CGSize(width: min(current.width, area.width - 2 * gap), height: min(current.height, area.height - 2 * gap))
            target = CGRect(x: area.midX - size.width / 2, y: area.midY - size.height / 2, width: size.width, height: size.height)
        } else {
            target = rect(for: layout.unit, on: screen)
        }
        undo = (element, current)
        canRestore = true
        setFrame(target, of: element)
    }

    /// Puts the last snapped window back where it was.
    func restoreLast() {
        guard let undo else { return }
        setFrame(undo.frame, of: undo.element)
        self.undo = nil
        canRestore = false
    }

    /// Moves the front window to the next display, keeping its relative place.
    func moveFrontWindowToNextScreen() {
        guard ensureTrusted(), let window = frontWindow(), let current = frame(of: window) else { return }
        let screens = NSScreen.screens
        guard screens.count > 1 else { flash("Only one display is connected."); return }
        let from = screen(containing: current)
        let index = screens.firstIndex(of: from) ?? 0
        let to = screens[(index + 1) % screens.count]
        let a = from.visibleFrame, b = to.visibleFrame
        let unit = CGRect(x: (current.minX - a.minX) / a.width, y: (current.minY - a.minY) / a.height,
                          width: current.width / a.width, height: current.height / a.height)
        undo = (window, current)
        canRestore = true
        setFrame(CGRect(x: b.minX + unit.minX * b.width, y: b.minY + unit.minY * b.height,
                        width: min(unit.width * b.width, b.width), height: min(unit.height * b.height, b.height)), of: window)
    }

    // MARK: Tiling

    /// Tiles the visible windows on the screen with the front window.
    func tile(_ arrangement: TileArrangement) {
        guard ensureTrusted() else { return }
        let screen = frontWindow().flatMap(frame(of:)).map(screen(containing:)) ?? NSScreen.main ?? NSScreen.screens[0]
        let windows = visibleWindows(on: screen)
        guard !windows.isEmpty else { flash("No windows to arrange on this screen."); return }
        let units = arrangement.units(for: windows.count)
        for (window, unit) in zip(windows, units) {
            setFrame(rect(for: unit, on: screen), of: window.element)
        }
        if windows.count > units.count {
            flash("Arranged the \(units.count) front-most windows.")
        }
        undo = nil
        canRestore = false
    }

    // MARK: Saved layouts

    /// Remembers where every visible window is, by app and title.
    func captureLayout(named name: String) -> SavedLayout? {
        guard ensureTrusted() else { return nil }
        let entries: [SavedLayout.Entry] = NSScreen.screens.flatMap { visibleWindows(on: $0) }.compactMap { w in
            guard let bundle = w.bundleID, let f = frame(of: w.element) else { return nil }
            return .init(bundleID: bundle, appName: w.appName, title: w.title,
                         x: f.minX, y: f.minY, width: f.width, height: f.height)
        }
        guard !entries.isEmpty else { flash("No windows to save."); return nil }
        return SavedLayout(name: name, entries: entries)
    }

    /// Moves windows back to a saved layout. Apps that aren't open are skipped.
    func apply(_ layout: SavedLayout) {
        guard ensureTrusted() else { return }
        var used = Set<CFHashCode>()
        var moved = 0
        for entry in layout.entries {
            guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == entry.bundleID }) else { continue }
            let candidates = windows(of: app).filter { !used.contains(CFHash($0.element)) }
            guard let match = candidates.first(where: { $0.title == entry.title }) ?? candidates.first else { continue }
            used.insert(CFHash(match.element))
            setFrame(CGRect(x: entry.x, y: entry.y, width: entry.width, height: entry.height), of: match.element)
            moved += 1
        }
        flash(moved == 0 ? "None of those apps are open." : "Moved \(moved) window\(moved == 1 ? "" : "s").")
    }

    // MARK: Window lookup

    /// The focused window of the front app (or of the app used before the notch opened).
    func frontWindow() -> AXUIElement? {
        let front = NSWorkspace.shared.frontmostApplication
        let app = (front == nil || front == .current) ? lastOtherApp : front
        guard let app else { flash("Click a window first, then snap it."); return nil }
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        if let focused: AXUIElement = attribute(axApp, kAXFocusedWindowAttribute) { return focused }
        if let main: AXUIElement = attribute(axApp, kAXMainWindowAttribute) { return main }
        flash("\(app.localizedName ?? "That app") has no window to snap.")
        return nil
    }

    /// The window under a point on screen (AppKit coordinates), e.g. the one being dragged.
    func window(at point: NSPoint) -> AXUIElement? {
        guard AXIsProcessTrusted() else { return nil }
        let ax = toAX(point)
        var element: AXUIElement?
        guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(ax.x), Float(ax.y), &element) == .success,
              let element else { return nil }
        var pid: pid_t = 0
        AXUIElementGetPid(element, &pid)
        guard pid != ProcessInfo.processInfo.processIdentifier else { return nil }
        if role(of: element) == kAXWindowRole { return element }
        return attribute(element, kAXWindowAttribute)
    }

    /// Standard, visible windows of one app.
    private func windows(of app: NSRunningApplication) -> [ManagedWindow] {
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        let list: [AXUIElement] = attribute(axApp, kAXWindowsAttribute) ?? []
        return list.compactMap { w in
            guard (attribute(w, kAXSubroleAttribute) as String?) == kAXStandardWindowSubrole,
                  (attribute(w, kAXMinimizedAttribute) as Bool?) != true else { return nil }
            return ManagedWindow(element: w, pid: app.processIdentifier, appName: app.localizedName ?? "",
                                 bundleID: app.bundleIdentifier, title: attribute(w, kAXTitleAttribute) ?? "")
        }
    }

    /// Visible windows on a screen, front-most first (using the window server's stacking order).
    private func visibleWindows(on screen: NSScreen) -> [ManagedWindow] {
        let me = ProcessInfo.processInfo.processIdentifier
        let apps = NSWorkspace.shared.runningApplications.filter {
            $0.activationPolicy == .regular && !$0.isHidden && $0.processIdentifier != me
        }
        var byPID: [pid_t: [ManagedWindow]] = [:]
        for app in apps { byPID[app.processIdentifier] = windows(of: app) }

        let info = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
        var result: [ManagedWindow] = []
        var taken = Set<CFHashCode>()
        for entry in info {
            guard (entry[kCGWindowLayer as String] as? Int) == 0,
                  let pid = entry[kCGWindowOwnerPID as String] as? pid_t,
                  let boundsDict = entry[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary),
                  let candidates = byPID[pid] else { continue }
            // Match the CG window to an AX window by its position and size.
            if let match = candidates.first(where: { w in
                !taken.contains(CFHash(w.element)) && axFrame(of: w.element).map { abs($0.minX - bounds.minX) < 4 && abs($0.minY - bounds.minY) < 4 && abs($0.width - bounds.width) < 4 } == true
            }) {
                taken.insert(CFHash(match.element))
                if let f = frame(of: match.element), screen.frame.contains(CGPoint(x: f.midX, y: f.midY)) {
                    result.append(match)
                }
            }
        }
        return result
    }

    // MARK: Geometry

    var gap: CGFloat { CGFloat(max(0, min(40, SettingsManager.shared.windowGap))) }

    /// Converts a top-left unit rect into an AppKit rect in the screen's usable area, with gaps.
    func rect(for unit: CGRect, on screen: NSScreen) -> CGRect {
        let area = screen.visibleFrame.insetBy(dx: gap / 2, dy: gap / 2)
        let x = area.minX + unit.minX * area.width
        let w = unit.width * area.width
        let h = unit.height * area.height
        let y = area.maxY - unit.minY * area.height - h
        return CGRect(x: x, y: y, width: w, height: h).insetBy(dx: gap / 2, dy: gap / 2).integral
    }

    private func screen(containing rect: CGRect) -> NSScreen {
        let center = CGPoint(x: rect.midX, y: rect.midY)
        return NSScreen.screens.first { $0.frame.contains(center) }
            ?? NSScreen.screens.max { $0.frame.intersection(rect).area < $1.frame.intersection(rect).area }
            ?? NSScreen.main ?? NSScreen.screens[0]
    }

    private var primaryHeight: CGFloat { NSScreen.screens.first?.frame.height ?? 0 }

    private func toAX(_ p: NSPoint) -> CGPoint { CGPoint(x: p.x, y: primaryHeight - p.y) }

    /// AppKit-coordinate frame of a window.
    func frame(of element: AXUIElement) -> CGRect? {
        axFrame(of: element).map { CGRect(x: $0.minX, y: primaryHeight - $0.maxY, width: $0.width, height: $0.height) }
    }

    private func axFrame(of element: AXUIElement) -> CGRect? {
        guard let posValue: AXValue = attribute(element, kAXPositionAttribute),
              let sizeValue: AXValue = attribute(element, kAXSizeAttribute) else { return nil }
        var pos = CGPoint.zero, size = CGSize.zero
        AXValueGetValue(posValue, .cgPoint, &pos)
        AXValueGetValue(sizeValue, .cgSize, &size)
        return CGRect(origin: pos, size: size)
    }

    private func setFrame(_ rect: CGRect, of element: AXUIElement) {
        var pos = CGPoint(x: rect.minX, y: primaryHeight - rect.maxY)
        var size = rect.size
        // Size, move, size again: apps clamp size to the screen they're on,
        // so the second pass fixes windows moving between displays.
        if let s = AXValueCreate(.cgSize, &size) { AXUIElementSetAttributeValue(element, kAXSizeAttribute as CFString, s) }
        if let p = AXValueCreate(.cgPoint, &pos) { AXUIElementSetAttributeValue(element, kAXPositionAttribute as CFString, p) }
        if let s = AXValueCreate(.cgSize, &size) { AXUIElementSetAttributeValue(element, kAXSizeAttribute as CFString, s) }
    }

    // MARK: AX helpers

    private func attribute<T>(_ element: AXUIElement, _ name: String) -> T? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success, let value else { return nil }
        return value as? T
    }

    private func role(of element: AXUIElement) -> String? { attribute(element, kAXRoleAttribute) }

    private func ensureTrusted() -> Bool {
        refreshTrust()
        if !isTrusted { flash("Allow Accessibility for Notch apple to move windows.") }
        return isTrusted
    }

    private func flash(_ message: String) {
        lastMessage = message
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            if self?.lastMessage == message { self?.lastMessage = nil }
        }
    }
}

private extension CGRect {
    var area: CGFloat { isNull ? 0 : width * height }
}

// MARK: - Saved layouts

struct SavedLayout: Identifiable, Codable, Equatable {
    struct Entry: Codable, Equatable {
        var bundleID: String
        var appName: String
        var title: String
        var x, y, width, height: CGFloat
    }

    var id = UUID()
    var name: String
    var entries: [Entry]
    var created = Date()
}

@MainActor
final class SavedLayoutStore: ObservableObject {
    static let shared = SavedLayoutStore()
    @Published private(set) var layouts: [SavedLayout] = []

    private let url: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Notch apple", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("window-layouts.json")
    }()

    private init() {
        if let data = try? Data(contentsOf: url), let saved = try? JSONDecoder().decode([SavedLayout].self, from: data) {
            layouts = saved
        }
    }

    func add(_ layout: SavedLayout) { layouts.insert(layout, at: 0); save() }
    func delete(_ layout: SavedLayout) { layouts.removeAll { $0.id == layout.id }; save() }

    private func save() {
        if let data = try? JSONEncoder().encode(layouts) { try? data.write(to: url, options: .atomic) }
    }
}
