//
//  HotCorners.swift
//  Notch apple
//
//  Your own hot corners: push the pointer into a screen corner and Notch apple opens a website,
//  an app, a file or folder, runs a Shortcut, opens Mission Control or toggles the notch.
//  They work next to macOS's own hot corners (System Settings → Desktop & Dock), so set Apple's
//  to "–" for a corner you give to Notch apple.
//
//  Nothing polls: one mouse-moved monitor runs only while hot corners are on and a corner has an
//  action. A corner fires once per visit (move out and back to fire it again), after a short delay
//  so a flick across the screen doesn't trigger it, and optionally only while a modifier key is held.
//

import AppKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: - Model

enum HotCornerKind: String, CaseIterable, Identifiable {
    case none, website, app, file, shortcut, toggleNotch, missionControl
    var id: String { rawValue }
    var title: String {
        switch self {
        case .none: "Nothing"
        case .website: "Open a website"
        case .app: "Open an app"
        case .file: "Open a file or folder"
        case .shortcut: "Run a Shortcut"
        case .toggleNotch: "Open or close the notch"
        case .missionControl: "Mission Control"
        }
    }
}

/// What each corner does, stored in UserDefaults (so it's part of Settings backups).
enum HotCornerPrefs {
    static var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: "hotcorner.enabled") }
        set { UserDefaults.standard.set(newValue, forKey: "hotcorner.enabled") }
    }
    /// Seconds the pointer must rest in the corner.
    static var delay: Double {
        get { UserDefaults.standard.object(forKey: "hotcorner.delay") as? Double ?? 0.3 }
        set { UserDefaults.standard.set(newValue, forKey: "hotcorner.delay") }
    }
    /// "none", "option", "command", "control" or "shift": the key that must be held.
    static var modifier: String {
        get { UserDefaults.standard.string(forKey: "hotcorner.modifier") ?? "none" }
        set { UserDefaults.standard.set(newValue, forKey: "hotcorner.modifier") }
    }

    static func kind(_ c: HotCorner) -> HotCornerKind {
        HotCornerKind(rawValue: UserDefaults.standard.string(forKey: "hotcorner.\(c.rawValue).kind") ?? "") ?? .none
    }
    static func setKind(_ c: HotCorner, _ k: HotCornerKind) { UserDefaults.standard.set(k.rawValue, forKey: "hotcorner.\(c.rawValue).kind") }
    static func value(_ c: HotCorner) -> String { UserDefaults.standard.string(forKey: "hotcorner.\(c.rawValue).value") ?? "" }
    static func setValue(_ c: HotCorner, _ v: String) { UserDefaults.standard.set(v, forKey: "hotcorner.\(c.rawValue).value") }

    static var anyConfigured: Bool { HotCorner.allCases.contains { kind($0) != .none } }

    static var modifierFlag: NSEvent.ModifierFlags? {
        switch modifier {
        case "option": .option
        case "command": .command
        case "control": .control
        case "shift": .shift
        default: nil
        }
    }
}

// MARK: - Actions

enum HotCornerAction {
    @MainActor
    static func run(kind: HotCornerKind, value: String) {
        switch kind {
        case .none:
            return
        case .website:
            if let u = HotCornerURL.url(from: value) { NSWorkspace.shared.open(u) }
        case .app:
            guard !value.isEmpty else { return }
            NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: value), configuration: NSWorkspace.OpenConfiguration())
        case .file:
            guard !value.isEmpty else { return }
            NSWorkspace.shared.open(URL(fileURLWithPath: value))
        case .shortcut:
            let name = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { return }
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/shortcuts")
            p.arguments = ["run", name]
            try? p.run()
        case .toggleNotch:
            AppDelegate.current?.notch?.toggle()
        case .missionControl:
            NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Mission Control.app"))
        }
        NotchFeedback.tick()
    }
}

// MARK: - Watching the corners

@MainActor
final class HotCornerManager {
    static let shared = HotCornerManager()
    private var monitors: [Any] = []
    private var pending: (corner: HotCorner, work: DispatchWorkItem)?
    /// The corner already fired for this visit; cleared when the pointer leaves it.
    private var fired: HotCorner?

    /// Call at launch and whenever a hot-corner setting changes.
    func apply() {
        monitors.forEach(NSEvent.removeMonitor)
        monitors = []
        cancel()
        fired = nil
        guard HotCornerPrefs.enabled, HotCornerPrefs.anyConfigured else { return }
        let handler: (NSEvent) -> Void = { [weak self] _ in MainActor.assumeIsolated { self?.moved() } }
        if let g = NSEvent.addGlobalMonitorForEvents(matching: .mouseMoved, handler: handler) { monitors.append(g) }
        if let l = NSEvent.addLocalMonitorForEvents(matching: .mouseMoved, handler: { handler($0); return $0 }) { monitors.append(l) }
    }

    private func cancel() {
        pending?.work.cancel()
        pending = nil
    }

    private func moved() {
        guard let corner = HotCornerGeometry.corner(at: NSEvent.mouseLocation, screens: NSScreen.screens.map(\.frame)) else {
            cancel(); fired = nil; return
        }
        guard corner != fired else { return }
        if pending?.corner == corner { return }
        cancel()
        guard HotCornerPrefs.kind(corner) != .none else { return }
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.pending = nil
                // Still in the same corner, and the modifier (if any) is still held.
                guard HotCornerGeometry.corner(at: NSEvent.mouseLocation, screens: NSScreen.screens.map(\.frame)) == corner,
                      self.modifierHeld() else { return }
                self.fired = corner
                HotCornerAction.run(kind: HotCornerPrefs.kind(corner), value: HotCornerPrefs.value(corner))
            }
        }
        pending = (corner, work)
        DispatchQueue.main.asyncAfter(deadline: .now() + max(HotCornerPrefs.delay, 0.05), execute: work)
    }

    private func modifierHeld() -> Bool {
        guard let flag = HotCornerPrefs.modifierFlag else { return true }
        return NSEvent.modifierFlags.contains(flag)
    }

}

// MARK: - Settings

/// Settings → Notch → Hot corners.
struct HotCornersSection: View {
    @State private var enabled = HotCornerPrefs.enabled
    @State private var delay = HotCornerPrefs.delay
    @State private var modifier = HotCornerPrefs.modifier
    @State private var refresh = 0

    var body: some View {
        Section {
            Toggle("Use my own hot corners", isOn: $enabled)
                .onChange(of: enabled) { _, v in HotCornerPrefs.enabled = v; HotCornerManager.shared.apply() }
            if enabled {
                ForEach(HotCorner.allCases) { corner in
                    CornerRow(corner: corner) { HotCornerManager.shared.apply() }
                }
                .id(refresh)
                Picker("Only while holding", selection: $modifier) {
                    Text("Nothing (always on)").tag("none")
                    Text("⌥ Option").tag("option")
                    Text("⌘ Command").tag("command")
                    Text("⌃ Control").tag("control")
                    Text("⇧ Shift").tag("shift")
                }
                .onChange(of: modifier) { _, v in HotCornerPrefs.modifier = v }
                LabeledContent("Wait before it fires") {
                    HStack {
                        Slider(value: $delay, in: 0.05...1.0, step: 0.05)
                            .frame(width: 160)
                            .onChange(of: delay) { _, v in HotCornerPrefs.delay = v }
                        Text(String(format: "%.2f s", delay)).monospacedDigit().foregroundStyle(.secondary).frame(width: 52, alignment: .trailing)
                    }
                }
                Button("Open Apple's hot corners…") {
                    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Desktop-Settings.extension")!)
                }
            }
        } header: {
            Text("Hot corners")
        } footer: {
            Text("Push the pointer into a corner to open a website, an app, a file, a Shortcut or Mission Control. Each corner fires once per visit; move out and back to fire it again. macOS's own hot corners still work too: in System Settings → Desktop & Dock → Hot Corners, set a corner to “–” if you give it to Notch apple.")
        }
    }
}

private struct CornerRow: View {
    let corner: HotCorner
    let changed: () -> Void
    @State private var kind: HotCornerKind
    @State private var value: String

    init(corner: HotCorner, changed: @escaping () -> Void) {
        self.corner = corner
        self.changed = changed
        _kind = State(initialValue: HotCornerPrefs.kind(corner))
        _value = State(initialValue: HotCornerPrefs.value(corner))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Picker(corner.title, selection: $kind) {
                ForEach(HotCornerKind.allCases) { Text($0.title).tag($0) }
            }
            .onChange(of: kind) { _, k in
                HotCornerPrefs.setKind(corner, k)
                value = ""; HotCornerPrefs.setValue(corner, "")
                changed()
            }
            switch kind {
            case .website:
                TextField("Website, e.g. youtube.com", text: $value)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: value) { _, v in HotCornerPrefs.setValue(corner, v) }
                if !value.isEmpty, HotCornerURL.url(from: value) == nil {
                    Text("That doesn't look like a web address.").font(.caption).foregroundStyle(.red)
                }
            case .shortcut:
                TextField("Name of the Shortcut", text: $value)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: value) { _, v in HotCornerPrefs.setValue(corner, v) }
            case .app:
                HStack {
                    Text(value.isEmpty ? "No app chosen" : FileManager.default.displayName(atPath: value))
                        .foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    Button("Choose app…") { choose(apps: true) }
                }
            case .file:
                HStack {
                    Text(value.isEmpty ? "Nothing chosen" : (value as NSString).lastPathComponent)
                        .foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    Button("Choose…") { choose(apps: false) }
                }
            case .none, .toggleNotch, .missionControl:
                EmptyView()
            }
        }
        .padding(.vertical, 2)
    }

    private func choose(apps: Bool) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = !apps
        panel.allowsMultipleSelection = false
        if apps {
            panel.allowedContentTypes = [.application]
            panel.directoryURL = URL(fileURLWithPath: "/Applications")
        }
        guard panel.runModal() == .OK, let url = panel.url else { return }
        value = url.path
        HotCornerPrefs.setValue(corner, url.path)
        changed()
    }
}
