//
//  NowPlayingMonitor.swift
//  Notch apple
//
//  Tracks what's playing in Apple Music and Spotify.
//
//  `MPNowPlayingInfoCenter` only exposes *this* app's own playback, and the
//  system-wide MediaRemote framework is private. Instead we listen to the
//  public distributed notifications Music and Spotify broadcast on every track
//  change — this works inside the App Sandbox and costs nothing. Each update
//  is mirrored into the App Group so the widget can show it too.
//

import SwiftUI
import WidgetKit

final class NowPlayingMonitor: ObservableObject {
    static let shared = NowPlayingMonitor()

    @Published private(set) var current: NowPlayingSnapshot? = SharedStore.nowPlaying

    private let sources: [(name: String, notification: String)] = [
        ("Music", "com.apple.Music.playerInfo"),
        ("Spotify", "com.spotify.client.PlaybackStateChanged"),
    ]

    func start() {
        let center = DistributedNotificationCenter.default()
        for source in sources {
            center.addObserver(forName: Notification.Name(source.notification), object: nil, queue: .main) { [weak self] note in
                self?.handle(note.userInfo ?? [:], source: source.name)
            }
        }
    }

    private func handle(_ info: [AnyHashable: Any], source: String) {
        let state = (info["Player State"] as? String) ?? ""
        let snapshot = NowPlayingSnapshot(
            title: (info["Name"] as? String) ?? current?.title ?? "",
            artist: (info["Artist"] as? String) ?? current?.artist ?? "",
            isPlaying: state == "Playing",
            source: source)
        current = snapshot
        SharedStore.nowPlaying = snapshot
        WidgetCenter.shared.reloadTimelines(ofKind: SharedStore.widgetKind)
    }

    /// Opens the source player so the user can control playback.
    func openPlayer() {
        let id = current?.source == "Spotify" ? "com.spotify.client" : "com.apple.Music"
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) {
            NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
        }
    }
}

struct NowPlayingView: View {
    @StateObject private var monitor = NowPlayingMonitor.shared

    var body: some View {
        HStack(spacing: 18) {
            ZStack {
                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.accentGradient)
                Image(systemName: monitor.current?.isPlaying == true ? "waveform" : "music.note")
                    .font(.system(size: 42, weight: .semibold)).foregroundStyle(.white)
                    .symbolEffect(.variableColor.iterative, isActive: monitor.current?.isPlaying == true)
            }
            .frame(width: 120, height: 120)
            .shadow(color: Theme.accent.opacity(0.5), radius: 16)

            VStack(alignment: .leading, spacing: 6) {
                if let now = monitor.current, !now.title.isEmpty {
                    Text(now.isPlaying ? "NOW PLAYING · \(now.source.uppercased())" : "PAUSED · \(now.source.uppercased())").sectionTitle()
                    Text(now.title).font(.title2.bold()).foregroundStyle(.white).lineLimit(2)
                    Text(now.artist).font(.title3).foregroundStyle(Theme.textSecondary).lineLimit(1)
                } else {
                    Text("Nothing playing").font(.title3.bold()).foregroundStyle(.white)
                    Text("Play something in Music or Spotify.").foregroundStyle(Theme.textSecondary)
                }
                HStack(spacing: 6) {
                    IconButton(systemImage: "backward.fill", help: "Previous track") { MediaControl.send(.previous) }
                    IconButton(systemImage: monitor.current?.isPlaying == true ? "pause.fill" : "play.fill", help: "Play / pause") { MediaControl.send(.playPause) }
                    IconButton(systemImage: "forward.fill", help: "Next track") { MediaControl.send(.next) }
                    Button("Open Player", action: monitor.openPlayer).buttonStyle(PurpleButtonStyle(prominent: false))
                }
                .padding(.top, 6)
            }
            .frame(maxWidth: 260, alignment: .leading)
            if SettingsManager.shared.showLyrics, monitor.current?.title.isEmpty == false {
                LyricsPanel()
            }
            Spacer(minLength: 0)
        }
        .frame(maxHeight: .infinity)
    }
}
