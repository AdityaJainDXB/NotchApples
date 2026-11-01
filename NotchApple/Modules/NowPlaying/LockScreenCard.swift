//
//  LockScreenCard.swift
//  Notch Apple
//
//  Music on the lock screen (experimental, off by default): while the Mac is locked and something is playing, a small card
//  at the top of every screen shows the song, the current lyric line (when lyrics are unlocked) and the battery, over the
//  lock screen. It reuses NowPlayingMonitor (what is playing) and LyricsModel (the lines) and wakes only on the system's
//  lock and unlock notifications and on track changes, never on a timer.
//

import AppKit
import Combine
import SwiftUI

/// Borderless, transparent, never takes focus or mouse events.
private final class LockCardPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class LockScreenCard: ObservableObject {
    static let shared = LockScreenCard()

    @AppStorage("nowPlaying.lockScreenCard") var isOn = false

    /// True from the system's "screen is locked" broadcast to its "screen is unlocked" one.
    @Published fileprivate(set) var locked = false

    private var panels: [LockCardPanel] = []
    private var observers: [NSObjectProtocol] = []
    private var cancellables: Set<AnyCancellable> = []

    private init() {}

    /// Starts or stops listening to match the switch. Safe to call often.
    func apply() {
        if isOn { startObserving() } else { stopObserving(); hide() }
    }

    private func startObserving() {
        guard observers.isEmpty else { return }
        let center = DistributedNotificationCenter.default()
        observers.append(center.addObserver(forName: NSNotification.Name("com.apple.screenIsLocked"), object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.locked = true; self?.refresh() }
        })
        observers.append(center.addObserver(forName: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.locked = false; self?.refresh() }
        })
        // A new song (or a pause) while the screen is locked.
        NowPlayingMonitor.shared.objectWillChange
            .sink { [weak self] _ in DispatchQueue.main.async { MainActor.assumeIsolated { self?.refresh() } } }
            .store(in: &cancellables)
        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .sink { [weak self] _ in MainActor.assumeIsolated { self?.place() } }
            .store(in: &cancellables)
    }

    private func stopObserving() {
        for token in observers { DistributedNotificationCenter.default().removeObserver(token) }
        observers.removeAll()
        cancellables.removeAll()
        locked = false
    }

    private func refresh() {
        let now = NowPlayingMonitor.shared.current
        let hasTrack = now?.isPlaying == true && now?.title.isEmpty == false
        if LockScreenLogic.shouldShow(enabled: isOn, locked: locked, hasTrack: hasTrack) {
            if Entitlements.shared.canUse(Feature.lyrics) { LyricsModel.shared.start() }
            present()
        } else {
            hide()
        }
    }

    /// One panel per screen, above the lock screen (the shielding level is what the lock screen itself sits at).
    private func present() {
        let screens = NSScreen.screens
        if panels.count != screens.count {
            hide()
            for _ in screens {
                let p = LockCardPanel(contentRect: NSRect(x: 0, y: 0, width: 420, height: 84),
                                      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
                p.isOpaque = false
                p.backgroundColor = .clear
                p.hasShadow = false
                p.ignoresMouseEvents = true
                p.level = NSWindow.Level(rawValue: Int(CGShieldingWindowLevel()) + 1)
                p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
                p.isReleasedWhenClosed = false
                p.hidesOnDeactivate = false
                p.canHide = false
                p.contentView = NSHostingView(rootView: LockScreenCardView())
                panels.append(p)
            }
        }
        place()
        for p in panels { p.orderFrontRegardless() }
    }

    private func hide() {
        for p in panels { p.orderOut(nil); p.contentView = nil }
        panels.removeAll()
    }

    /// Centred along the top edge of each screen, just under the notch.
    private func place() {
        for (panel, screen) in zip(panels, NSScreen.screens) {
            let size = panel.frame.size
            let top = screen.frame.maxY - (screen.safeAreaInsets.top > 0 ? screen.safeAreaInsets.top : 28) - 10
            let frame = NSRect(x: screen.frame.midX - size.width / 2, y: top - size.height, width: size.width, height: size.height)
            if panel.frame != frame { panel.setFrame(frame, display: true) }
        }
    }
}

private struct LockScreenCardView: View {
    @ObservedObject private var monitor = NowPlayingMonitor.shared
    @ObservedObject private var lyrics = LyricsModel.shared

    var body: some View {
        let lines = lyrics.lines, current = lyrics.currentIndex ?? -1
        let line = Entitlements.shared.canUse(Feature.lyrics) && current >= 0 && current < lines.count ? lines[current].text : ""
        HStack(spacing: 12) {
            Group {
                if let art = monitor.artwork {
                    Image(nsImage: art).resizable().scaledToFill()
                } else {
                    ZStack { Color.white.opacity(0.12); Image(systemName: "music.note").foregroundStyle(.white.opacity(0.7)) }
                }
            }
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(monitor.current?.title ?? "")
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                Text(line.isEmpty ? (monitor.current?.artist ?? "") : line)
                    .font(.system(size: 12, weight: line.isEmpty ? .regular : .medium))
                    .foregroundStyle(.white.opacity(line.isEmpty ? 0.6 : 0.9)).lineLimit(1)
                    .id(line)
                    .transition(.opacity)
            }
            .animation(.easeInOut(duration: 0.3), value: line)
            Spacer(minLength: 8)
            // The battery is read when the card appears and again every minute, not on a fast timer.
            TimelineView(.periodic(from: .now, by: 60)) { _ in
                if let b = LiveActivityCenter.battery() {
                    Label("\(b.percent)%", systemImage: b.charging ? "battery.100.bolt" : LiveActivityCenter.batterySymbol(b.percent))
                        .font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.85))
                        .labelStyle(.titleAndIcon)
                }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(width: 420, height: 84)
        .background(RoundedRectangle(cornerRadius: 26, style: .continuous).fill(Color.black.opacity(0.88)))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).strokeBorder(Color.white.opacity(0.1), lineWidth: 1))
    }
}

/// The switch in the Now Playing tab.
struct LockScreenCardRow: View {
    @ObservedObject private var hub = LockScreenCard.shared

    var body: some View {
        Toggle("Music on the lock screen (experimental)", isOn: Binding(get: { hub.isOn }, set: { hub.isOn = $0; hub.objectWillChange.send(); hub.apply() }))
            .toggleStyle(.switch).controlSize(.mini)
            .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            .help("While your Mac is locked and music plays, shows the song, the current lyric line and the battery at the top of the screen. Lyrics need Pro.")
    }
}
