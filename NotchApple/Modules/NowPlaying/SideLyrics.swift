//
//  SideLyrics.swift
//  Notch apple
//
//  Lyrics on the side of your screen (Pro): a small click-through overlay that shows the current line of the
//  song big and bright with the line before and the next two dimmer, over every app and Space. It reuses
//  LyricsModel (LRCLIB lines + current line) and NowPlayingMonitor (what is playing).
//

import AppKit
import Combine
import SwiftUI

/// Borderless, transparent, never takes focus or mouse events.
private final class SideLyricsPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class SideLyrics: ObservableObject {
    static let shared = SideLyrics()

    @AppStorage("nowPlaying.sideLyrics") var isOn = false
    @AppStorage("nowPlaying.sideLyricsSide") var sideRaw = "left"

    /// What the overlay shows right now; drives the fade.
    @Published fileprivate(set) var visible = false

    private var panel: SideLyricsPanel?
    private var cancellables: Set<AnyCancellable> = []
    private let width: CGFloat = 340

    /// LyricsModel must keep ticking while the overlay is on, even if the Now Playing tab closes.
    static var keepsModelRunning: Bool {
        UserDefaults.standard.bool(forKey: "nowPlaying.sideLyrics") && Entitlements.shared.canUse(Feature.lyrics)
    }

    private init() {}

    /// Shows or hides the overlay to match the switch, the license and what is playing. Safe to call often.
    func apply() {
        let want = isOn && Entitlements.shared.canUse(Feature.lyrics)
        guard want else {
            if panel != nil { teardown() }
            return
        }
        if panel == nil { setUp() }
        LyricsModel.shared.start()
        place()
        updateVisibility()
    }

    private func setUp() {
        let p = SideLyricsPanel(contentRect: NSRect(x: 0, y: 0, width: width, height: 360),
                                styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = false
        p.ignoresMouseEvents = true
        p.level = .floating
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        p.isReleasedWhenClosed = false
        p.hidesOnDeactivate = false
        p.contentView = NSHostingView(rootView: SideLyricsView(hub: self))
        panel = p
        p.orderFrontRegardless()

        // Follow the song and the playback state; the lines themselves redraw through the view.
        LyricsModel.shared.objectWillChange
            .sink { [weak self] _ in DispatchQueue.main.async { MainActor.assumeIsolated { self?.updateVisibility() } } }
            .store(in: &cancellables)
        NowPlayingMonitor.shared.objectWillChange
            .sink { [weak self] _ in DispatchQueue.main.async { MainActor.assumeIsolated { self?.updateVisibility() } } }
            .store(in: &cancellables)
        NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)
            .sink { [weak self] _ in DispatchQueue.main.async { MainActor.assumeIsolated { self?.apply() } } }
            .store(in: &cancellables)
        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .sink { [weak self] _ in MainActor.assumeIsolated { self?.place() } }
            .store(in: &cancellables)
    }

    private func teardown() {
        cancellables.removeAll()
        panel?.orderOut(nil)
        panel?.contentView = nil
        panel = nil
        visible = false
    }

    private func updateVisibility() {
        let now = NowPlayingMonitor.shared.current
        let lyrics = LyricsModel.shared
        let show = now?.isPlaying == true && now?.title.isEmpty == false && !lyrics.lines.isEmpty
        if show != visible { withAnimation(.easeInOut(duration: 0.5)) { visible = show } }
    }

    /// Pins the panel to the left or right edge of the main screen, vertically centred.
    private func place() {
        guard let panel, let screen = NSScreen.main else { return }
        let area = screen.visibleFrame
        let height: CGFloat = 360
        let margin: CGFloat = 16
        let x = sideRaw == "right" ? area.maxX - width - margin : area.minX + margin
        let frame = NSRect(x: x, y: area.midY - height / 2, width: width, height: height)
        if panel.frame != frame { panel.setFrame(frame, display: true) }
    }
}

private struct SideLyricsView: View {
    @ObservedObject var hub: SideLyrics
    @ObservedObject private var lyrics = LyricsModel.shared

    var body: some View {
        let right = hub.sideRaw == "right"
        let lines = lyrics.lines
        let current = lyrics.currentIndex ?? -1
        let start = max(current - 1, 0)
        let end = min(start + 4, lines.count)
        VStack(alignment: right ? .trailing : .leading, spacing: 10) {
            if start < end {
                ForEach(start..<end, id: \.self) { n in
                    let isCurrent = n == current
                    Text(lines[n].text.isEmpty ? "♪" : lines[n].text)
                        .font(.system(size: isCurrent ? 26 : 17, weight: isCurrent ? .heavy : .semibold, design: .rounded))
                        .foregroundStyle(isCurrent ? Color.white : Color.white.opacity(n < current ? 0.4 : 0.5))
                        .multilineTextAlignment(right ? .trailing : .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .shadow(color: .black.opacity(0.7), radius: 6, y: 1)
                        .id(n)
                        .transition(.opacity)
                }
            }
        }
        .animation(.easeInOut(duration: 0.35), value: current)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: right ? .trailing : .leading)
        .padding(.horizontal, 6)
        .opacity(hub.visible ? 1 : 0)
    }
}

/// The switch (and side) in the Now Playing tab; locked with the Pro badge until lyrics are unlocked.
struct SideLyricsRow: View {
    @ObservedObject private var hub = SideLyrics.shared

    var body: some View {
        HStack(spacing: 8) {
            Toggle("Lyrics on the side of your screen", isOn: Binding(get: { hub.isOn }, set: { hub.isOn = $0; hub.objectWillChange.send(); hub.apply() }))
                .toggleStyle(.switch).controlSize(.mini)
                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            Picker("", selection: Binding(get: { hub.sideRaw }, set: { hub.sideRaw = $0; hub.objectWillChange.send(); hub.apply() })) {
                Text("Left").tag("left")
                Text("Right").tag("right")
            }
            .pickerStyle(.segmented).labelsHidden().controlSize(.mini).frame(width: 90)
            .disabled(!hub.isOn)
        }
        .requires(Feature.lyrics)
        .help("Shows the synced lyrics along the edge of the screen while music plays, over every app")
    }
}
