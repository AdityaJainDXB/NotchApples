//
//  DesktopWidgets.swift
//  Notch Apple
//
//  Desktop widgets (Ultimate): small panels on the desktop for the clock, your to-dos and Now Playing. They are ordinary
//  windows of this app, sitting just above the desktop icons and below every other window, so they never cover what you
//  are working on. Drag one to move it (the position is remembered); turn each on or off in Settings → Widget.
//  They only read what the app already has (the clock, your to-do list, the Now Playing monitor): nothing is sent anywhere.
//

import AppKit
import SwiftUI

@MainActor
final class DesktopWidgets: ObservableObject {
    static let shared = DesktopWidgets()

    @Published private(set) var enabled: [String]
    private var panels: [DesktopWidgetKind: NSPanel] = [:]
    private var screenObserver: NSObjectProtocol?
    private let key = "desktopWidgets.enabled"

    private init() { enabled = UserDefaults.standard.stringArray(forKey: key) ?? [] }

    var allowed: Bool { Entitlements.shared.canUse(.desktopWidgets) }
    func isOn(_ kind: DesktopWidgetKind) -> Bool { enabled.contains(kind.rawValue) }

    func set(_ kind: DesktopWidgetKind, on: Bool) {
        var list = Set(enabled)
        if on { list.insert(kind.rawValue) } else { list.remove(kind.rawValue) }
        enabled = DesktopWidgetKind.allCases.map(\.rawValue).filter(list.contains)
        UserDefaults.standard.set(enabled, forKey: key)
        refresh()
    }

    /// Called at launch, when the tier changes, and when a switch is flipped. Shows exactly the enabled widgets (or none if not allowed).
    func refresh() {
        let wanted = allowed ? DesktopWidgetLogic.enabled(enabled) : []
        for kind in DesktopWidgetKind.allCases where !wanted.contains(kind) { panels[kind]?.orderOut(nil); panels[kind] = nil }
        let visible = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame ?? .zero
        let sizes = wanted.map(\.defaultSize)
        for (i, kind) in wanted.enumerated() where panels[kind] == nil {
            let size = kind.defaultSize
            let saved = savedOrigin(kind)
            let origin = saved ?? DesktopWidgetLogic.defaultOrigin(index: i, sizes: sizes, in: visible)
            let fixed = DesktopWidgetLogic.onScreen(origin: origin, size: size, screens: NSScreen.screens.map(\.visibleFrame))
            let p = NSPanel(contentRect: CGRect(origin: fixed, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = true
            p.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)   // above the desktop, below every app window
            p.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
            p.isMovableByWindowBackground = true
            p.isReleasedWhenClosed = false
            p.hidesOnDeactivate = false
            p.contentView = NSHostingView(rootView: DesktopWidgetView(kind: kind).frame(width: size.width, height: size.height))
            NotificationCenter.default.addObserver(forName: NSWindow.didMoveNotification, object: p, queue: .main) { [weak self, weak p] _ in
                guard let self, let p else { return }
                Task { @MainActor in self.save(kind, origin: p.frame.origin) }
            }
            panels[kind] = p
            p.orderFrontRegardless()
        }
        if screenObserver == nil {
            // A screen was unplugged or resized: bring every widget back onto a screen that exists.
            screenObserver = NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.reposition() }
            }
        }
    }

    private func reposition() {
        let screens = NSScreen.screens.map(\.visibleFrame)
        for (_, p) in panels {
            let o = DesktopWidgetLogic.onScreen(origin: p.frame.origin, size: p.frame.size, screens: screens)
            if o != p.frame.origin { p.setFrameOrigin(o) }
        }
    }

    private func savedOrigin(_ kind: DesktopWidgetKind) -> CGPoint? {
        guard let a = UserDefaults.standard.array(forKey: "desktopWidgets.origin.\(kind.rawValue)") as? [Double], a.count == 2 else { return nil }
        return CGPoint(x: a[0], y: a[1])
    }
    private func save(_ kind: DesktopWidgetKind, origin: CGPoint) {
        UserDefaults.standard.set([Double(origin.x), Double(origin.y)], forKey: "desktopWidgets.origin.\(kind.rawValue)")
    }
}

private struct DesktopWidgetView: View {
    let kind: DesktopWidgetKind
    var body: some View {
        Group {
            switch kind {
            case .clock: ClockWidget()
            case .todo: TodoWidget()
            case .nowPlaying: NowPlayingWidget()
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.white.opacity(0.12), lineWidth: 1))
        .preferredColorScheme(.dark)
    }
}

private struct ClockWidget: View {
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            VStack(alignment: .leading, spacing: 2) {
                Text(ctx.date, format: .dateTime.hour().minute()).font(.system(size: 40, weight: .semibold, design: .rounded)).monospacedDigit()
                Text(ctx.date, format: .dateTime.weekday(.wide).day().month(.wide)).font(.system(size: 12)).foregroundStyle(.secondary)
            }
        }
    }
}

private struct TodoWidget: View {
    @ObservedObject private var store = TodoStore.shared
    var body: some View {
        let lines = DesktopWidgetLogic.todoLines(store.ordered)
        VStack(alignment: .leading, spacing: 5) {
            Text("To-do").font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
            if lines.shown.isEmpty { Text("All done").font(.system(size: 13)) }
            ForEach(lines.shown) { item in
                HStack(spacing: 6) {
                    Image(systemName: "circle").font(.system(size: 9)).foregroundStyle(.secondary)
                    Text(item.text).font(.system(size: 13)).lineLimit(1)
                }
            }
            if lines.more > 0 { Text("+\(lines.more) more").font(.system(size: 11)).foregroundStyle(.secondary) }
        }
    }
}

private struct NowPlayingWidget: View {
    @ObservedObject private var monitor = NowPlayingMonitor.shared
    var body: some View {
        let t = DesktopWidgetLogic.nowPlayingText(title: monitor.current?.title, artist: monitor.current?.artist, isPlaying: monitor.current?.isPlaying ?? false)
        HStack(spacing: 10) {
            Image(systemName: "music.note").font(.system(size: 22)).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(t.line1).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                if !t.line2.isEmpty { Text(t.line2).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1) }
            }
        }
    }
}

/// Settings → Widget: the switches (Ultimate).
struct DesktopWidgetsSettings: View {
    @ObservedObject private var widgets = DesktopWidgets.shared
    @ObservedObject private var entitlements = Entitlements.shared

    var body: some View {
        Section {
            ForEach(DesktopWidgetKind.allCases) { kind in
                Toggle(isOn: Binding(get: { widgets.isOn(kind) }, set: { widgets.set(kind, on: $0) })) {
                    Label(kind.title, systemImage: kind.symbol)
                }
                .disabled(!entitlements.canUse(.desktopWidgets))
            }
        } header: {
            HStack(spacing: 6) { Text("Desktop widgets"); if !entitlements.canUse(.desktopWidgets) { TierBadge(tier: .ultimate) } }
        } footer: {
            Text("Small panels on your desktop. They sit above the desktop and under your windows, and you can drag each one where you want it. They only show what the app already has, and nothing is sent anywhere.")
        }
    }
}
