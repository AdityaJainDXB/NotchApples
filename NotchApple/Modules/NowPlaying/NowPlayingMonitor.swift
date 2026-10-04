//
//  NowPlayingMonitor.swift
//  Notch apple
//
//  Tracks what's playing on the Mac: Apple Music, Spotify, Anghami, browsers,
//  podcasts, anything that shows in Control Center's Now Playing.
//
//  macOS keeps system-wide Now Playing (the private MediaRemote framework) to
//  Apple's own tools, so a tiny JavaScript-for-Automation script
//  (Resources/Scripts/nowplaying.js) runs inside /usr/bin/osascript, reads it
//  once a second and prints a line only when something changes. It stops
//  while the Mac is idle. If it can't run, Music's and Spotify's own
//  track-change broadcasts are used instead (no artwork then).
//
//  Choose a source (Automatic, Apple Music, Spotify or Anghami) in the tab.
//  While music plays, the closed notch shows the album cover and moving bars,
//  like the iPhone's Dynamic Island. Updates are mirrored to the widget.
//

import AppKit
import SwiftUI
import WidgetKit

final class NowPlayingMonitor: ObservableObject {
    static let shared = NowPlayingMonitor()

    enum Source: String, CaseIterable, Identifiable {
        case automatic, music, spotify, anghami
        var id: String { rawValue }
        var title: String {
            switch self {
            case .automatic: "Anything playing"
            case .music: "Apple Music"
            case .spotify: "Spotify"
            case .anghami: "Anghami"
            }
        }
        var bundleID: String? {
            switch self {
            case .automatic: nil
            case .music: "com.apple.Music"
            case .spotify: "com.spotify.client"
            case .anghami: "com.anghami.anghami"
            }
        }
    }

    /// Starts empty: a saved snapshot from last time could be long stale (it's only for the widget).
    @Published private(set) var current: NowPlayingSnapshot?

    // MARK: Default player

    /// Music apps offered as the default player (shown when installed), plus any app picked with "Other…".
    static let knownPlayers: [(id: String, name: String)] = [
        ("com.apple.Music", "Apple Music"), ("com.spotify.client", "Spotify"), ("com.anghami.anghami", "Anghami"),
        ("com.deezer.deezer-desktop", "Deezer"), ("com.tidal.desktop", "TIDAL"), ("com.amazon.music", "Amazon Music"),
        ("com.apple.podcasts", "Podcasts"),
    ]

    /// The app Play and Open Player start when nothing is playing.
    @AppStorage("nowPlaying.defaultPlayer") var defaultPlayer = "com.apple.Music" { didSet { objectWillChange.send() } }

    var installedPlayers: [(id: String, name: String)] {
        var list = Self.knownPlayers.filter { NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0.id) != nil }
        if !list.contains(where: { $0.id == defaultPlayer }) { list.append((defaultPlayer, Self.appName(defaultPlayer))) }
        return list
    }

    var defaultPlayerName: String { installedPlayers.first { $0.id == defaultPlayer }?.name ?? Self.appName(defaultPlayer) }

    /// Lets you pick any app as the default player.
    @MainActor func chooseOtherPlayer() {
        let panel = NSOpenPanel()
        panel.directoryURL = URL(fileURLWithPath: "/Applications")
        panel.allowedContentTypes = [.application]
        panel.prompt = "Use as default player"
        NSApp.activate(ignoringOtherApps: true)
        if panel.runModal() == .OK, let url = panel.url, let id = Bundle(url: url)?.bundleIdentifier { defaultPlayer = id }
    }

    /// Play / pause. With nothing playing, opens your default player and starts it.
    @MainActor func playPause() {
        if current != nil, bundleID.map({ !NSRunningApplication.runningApplications(withBundleIdentifier: $0).isEmpty }) ?? true {
            MediaControl.send(.playPause)
            return
        }
        let id = source.bundleID ?? defaultPlayer
        let alreadyRunning = !NSRunningApplication.runningApplications(withBundleIdentifier: id).isEmpty
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) else { return }
        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        NSWorkspace.shared.openApplication(at: url, configuration: config) { _, _ in
            // Give a cold-started player time to load before pressing play.
            DispatchQueue.main.asyncAfter(deadline: .now() + (alreadyRunning ? 0.3 : 4)) { MediaControl.send(.playPause) }
        }
    }
    @Published private(set) var artwork: NSImage?
    @Published private(set) var album: String?
    @Published private(set) var duration: TimeInterval?
    @Published private(set) var bundleID: String?
    /// Position at `timestamp`, and the playback rate since then.
    private var elapsed: TimeInterval?
    private var timestamp: Date?
    private var rate: Double = 0

    @AppStorage("nowPlaying.source") var sourceRaw = Source.automatic.rawValue {
        didSet { objectWillChange.send(); lastLine = [:]; applyLatest() }
    }
    var source: Source { Source(rawValue: sourceRaw) ?? .automatic }

    private var bridge: Process?
    private var bridgeWorks = false
    private var buffer = Data()
    private var trackKey = ""
    private var lastLine: [String: Any] = [:]
    private var started = false

    /// Current playback position, extrapolated from the last update.
    var position: TimeInterval? {
        guard let elapsed else { return nil }
        guard current?.isPlaying == true, let timestamp else { return elapsed }
        return elapsed + Date.now.timeIntervalSince(timestamp) * max(rate, 0)
    }

    /// Album cover and moving bars beside the closed notch while music plays.
    @MainActor var liveActivity: LiveActivity? {
        guard let now = current, now.isPlaying, !now.title.isEmpty else { return nil }
        return LiveActivity(symbol: "music.note", label: nil, tint: NSColor(Theme.accentBright), artwork: artwork, musicBars: true)
    }

    func start() {
        guard !started else { return }
        started = true
        let center = DistributedNotificationCenter.default()
        for (name, notification) in [("Music", "com.apple.Music.playerInfo"), ("Spotify", "com.spotify.client.PlaybackStateChanged")] {
            center.addObserver(forName: Notification.Name(notification), object: nil, queue: .main) { [weak self] note in
                self?.handleBroadcast(note.userInfo ?? [:], source: name)
            }
        }
        SharedStore.nowPlaying = nil
        startBridge()
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                Power.onChange.append { [weak self] in
                    guard let self else { return }
                    Power.isIdle ? self.stopBridge() : self.startBridge()
                }
            }
        }
    }

    // MARK: MediaRemote bridge

    private func startBridge() {
        guard bridge == nil, let script = Bundle.main.url(forResource: "nowplaying", withExtension: "js") else { return }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        p.arguments = ["-l", "JavaScript", script.path, ProcessInfo.processInfo.isLowPowerModeEnabled ? "2" : "1"]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            DispatchQueue.main.async { self?.receive(data) }
        }
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let self, self.bridge === proc else { return }
                self.bridge = nil
                // Crashed or was killed: try again shortly (stopBridge clears `bridge` first, so no restart then).
                DispatchQueue.main.asyncAfter(deadline: .now() + 10) { self.startBridge() }
            }
        }
        do { try p.run(); bridge = p } catch { bridge = nil }
    }

    private func stopBridge() {
        let p = bridge
        bridge = nil
        p?.terminate()
    }

    private func receive(_ data: Data) {
        buffer.append(data)
        while let nl = buffer.firstIndex(of: 0x0A) {
            let line = buffer[buffer.startIndex..<nl]
            buffer.removeSubrange(buffer.startIndex...nl)
            guard let json = try? JSONSerialization.jsonObject(with: line) as? [String: Any], json["error"] == nil else { continue }
            bridgeWorks = true
            if let art = json["art"] as? String {
                artCache[Self.key(json)] = Data(base64Encoded: art).flatMap(NSImage.init(data:))
            }
            lastLine = json
            applyLatest()
        }
    }

    private var artCache: [String: NSImage?] = [:]
    private var artLookups: Set<String> = []

    /// Some players (Anghami, older Electron and web players) don't hand macOS a cover. Find it in
    /// Apple's free iTunes catalogue by title and artist instead, once per track.
    private func lookUpArtwork(key: String, title: String, artist: String) {
        guard !artLookups.contains(key) else { return }
        artLookups.insert(key)
        // Give the player a moment to send its own artwork first.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self, self.artCache[key] == nil else { return }
            let clean = { (s: String) in
                s.replacingOccurrences(of: #"\s*[\(\[][^\)\]]*[\)\]]"#, with: "", options: .regularExpression)
                    .components(separatedBy: CharacterSet(charactersIn: "&,")).first?.trimmingCharacters(in: .whitespaces) ?? s
            }
            var comps = URLComponents(string: "https://itunes.apple.com/search")!
            comps.queryItems = [.init(name: "term", value: "\(clean(title)) \(clean(artist))"), .init(name: "entity", value: "song"), .init(name: "limit", value: "1")]
            Task {
                struct Resp: Decodable { struct R: Decodable { let artworkUrl100: String? }; let results: [R] }
                guard let (data, _) = try? await URLSession.shared.data(from: comps.url!),
                      let small = (try? JSONDecoder().decode(Resp.self, from: data))?.results.first?.artworkUrl100,
                      let big = URL(string: small.replacingOccurrences(of: "100x100bb", with: "600x600bb")),
                      let (imgData, _) = try? await URLSession.shared.data(from: big),
                      let image = NSImage(data: imgData) else { return }
                await MainActor.run {
                    guard self.artCache[key] == nil else { return }
                    self.artCache[key] = image
                    if key == self.trackKey { self.artwork = image; self.refreshActivity() }
                }
            }
        }
    }

    private static func key(_ j: [String: Any]) -> String {
        [j["bundle"], j["title"], j["artist"], j["album"]].map { ($0 as? String) ?? "" }.joined(separator: "|")
    }

    private func applyLatest() {
        let j = lastLine
        let bundle = j["bundle"] as? String
        if let wanted = source.bundleID, bundle != wanted {
            // Another app is playing: keep the chosen app's last track, shown as paused.
            if bundleID == wanted, var c = current {
                if c.isPlaying { c.isPlaying = false; rate = 0; publish(c) }
            } else {
                clear()
            }
            return
        }
        guard bundle != nil else { if bridgeWorks && source == .automatic { clear() }; return }
        let title = (j["title"] as? String) ?? (j["file"] as? String).map { ($0 as NSString).deletingPathExtension } ?? ""
        let key = Self.key(j)
        if key != trackKey {
            trackKey = key
            if artCache.count > 20 { artCache = artCache.filter { $0.key == key } }
        }
        artwork = artCache[key] ?? nil
        if artCache[key] == nil, !title.isEmpty { lookUpArtwork(key: key, title: title, artist: (j["artist"] as? String) ?? "") }
        album = j["album"] as? String
        duration = j["duration"] as? Double
        elapsed = j["elapsed"] as? Double
        timestamp = (j["ts"] as? Double).map { Date(timeIntervalSince1970: $0) }
        rate = (j["rate"] as? Double) ?? ((j["playing"] as? Bool) == true ? 1 : 0)
        bundleID = bundle
        let appName = (j["app"] as? String) ?? Self.appName(bundle)
        publish(NowPlayingSnapshot(title: title, artist: (j["artist"] as? String) ?? "", isPlaying: (j["playing"] as? Bool) ?? false, source: appName))
    }

    private func clear() {
        guard current != nil else { return }
        artwork = nil; album = nil; duration = nil; elapsed = nil; bundleID = nil
        current = nil
        SharedStore.nowPlaying = nil
        WidgetCenter.shared.reloadTimelines(ofKind: SharedStore.widgetKind)
        refreshActivity()
    }

    private func publish(_ snapshot: NowPlayingSnapshot) {
        let changed = snapshot.title != current?.title || snapshot.isPlaying != current?.isPlaying || snapshot.artist != current?.artist
        current = snapshot
        if changed {
            SharedStore.nowPlaying = snapshot
            WidgetCenter.shared.reloadTimelines(ofKind: SharedStore.widgetKind)
        }
        refreshActivity()
    }

    private func refreshActivity() {
        MainActor.assumeIsolated { LiveActivityCenter.shared.recompute() }
    }

    private static func appName(_ bundle: String?) -> String {
        guard let bundle else { return "" }
        if let s = Source.allCases.first(where: { $0.bundleID == bundle }) { return s.title }
        return NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle)
            .map { FileManager.default.displayName(atPath: $0.path).replacingOccurrences(of: ".app", with: "") } ?? bundle
    }

    // MARK: Fallback: Music / Spotify broadcasts

    private func handleBroadcast(_ info: [AnyHashable: Any], source name: String) {
        guard !bridgeWorks else { return }
        if let wanted = source.bundleID, Source.allCases.first(where: { $0.bundleID == wanted })?.title.contains(name) == false { return }
        let state = (info["Player State"] as? String) ?? ""
        publish(NowPlayingSnapshot(
            title: (info["Name"] as? String) ?? current?.title ?? "",
            artist: (info["Artist"] as? String) ?? current?.artist ?? "",
            isPlaying: state == "Playing",
            source: name))
    }

    /// Opens the app that's playing (or the chosen source's app).
    func openPlayer() {
        let id = bundleID ?? source.bundleID ?? defaultPlayer
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) {
            NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
        }
        MainActor.assumeIsolated { AppDelegate.current?.notch?.closeNotch() }
    }
}

struct NowPlayingView: View {
    @StateObject private var monitor = NowPlayingMonitor.shared

    var body: some View {
        HStack(spacing: 18) {
            ZStack {
                if let art = monitor.artwork {
                    Image(nsImage: art).resizable().aspectRatio(contentMode: .fill)
                } else {
                    Theme.accentGradient
                    Image(systemName: monitor.current?.isPlaying == true ? "waveform" : "music.note")
                        .font(.system(size: 42, weight: .semibold)).foregroundStyle(.white)
                        .symbolEffect(.variableColor.iterative, isActive: monitor.current?.isPlaying == true)
                }
            }
            .frame(width: 128, height: 128)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .shadow(color: Theme.accent.opacity(0.5), radius: 16)
            .onTapGesture(perform: monitor.openPlayer)
            .help("Open the player")

            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    if let now = monitor.current, !now.title.isEmpty {
                        Text(now.isPlaying ? "NOW PLAYING · \(now.source.uppercased())" : "PAUSED · \(now.source.uppercased())").sectionTitle().lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    Menu {
                        Picker("Show", selection: $monitor.sourceRaw) {
                            ForEach(NowPlayingMonitor.Source.allCases) { Text($0.title).tag($0.rawValue) }
                        }
                        .pickerStyle(.inline)
                        Picker("Default player", selection: $monitor.defaultPlayer) {
                            ForEach(monitor.installedPlayers, id: \.id) { Text($0.name).tag($0.id) }
                        }
                        .pickerStyle(.inline)
                        Button("Other app…") { monitor.chooseOtherPlayer() }
                    } label: {
                        Label(monitor.source.title, systemImage: "music.note.list").font(.system(size: 11))
                    }
                    .menuStyle(.borderlessButton).fixedSize()
                    .help("Show anything playing on your Mac, or only one app")
                }
                if let now = monitor.current, !now.title.isEmpty {
                    Text(now.title).font(.title2.bold()).foregroundStyle(.white).lineLimit(2)
                    Text([now.artist, monitor.album].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.title3).foregroundStyle(Theme.textSecondary).lineLimit(1)
                    ProgressRow()
                } else {
                    Text("Nothing playing").font(.title3.bold()).foregroundStyle(.white)
                    Text(monitor.source == .automatic ? "Press play to start \(monitor.defaultPlayerName), or play something in any app." : "Play something in \(monitor.source.title).")
                        .foregroundStyle(Theme.textSecondary)
                }
                HStack(spacing: 6) {
                    IconButton(systemImage: "backward.fill", help: "Previous track") { MediaControl.send(.previous) }
                    IconButton(systemImage: monitor.current?.isPlaying == true ? "pause.fill" : "play.fill",
                               help: monitor.current == nil ? "Play in \(monitor.defaultPlayerName)" : "Play / pause") { monitor.playPause() }
                    IconButton(systemImage: "forward.fill", help: "Next track") { MediaControl.send(.next) }
                    Button("Open Player", action: monitor.openPlayer).buttonStyle(PurpleButtonStyle(prominent: false))
                }
                .padding(.top, 4)
            }
            .frame(maxWidth: 300, alignment: .leading)
            if SettingsManager.shared.showLyrics, Entitlements.shared.canUse(.lyrics), monitor.current?.title.isEmpty == false {
                LyricsPanel()
            }
            Spacer(minLength: 0)
        }
        .frame(maxHeight: .infinity)
    }
}

/// Elapsed / remaining with a progress bar, ticking once a second while visible.
private struct ProgressRow: View {
    @ObservedObject private var monitor = NowPlayingMonitor.shared

    var body: some View {
        if let duration = monitor.duration, duration > 0 {
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                let pos = min(monitor.position ?? 0, duration)
                VStack(spacing: 3) {
                    ProgressView(value: pos, total: duration).tint(Theme.accentBright)
                    HStack {
                        Text(Self.fmt(pos)); Spacer(); Text("-" + Self.fmt(duration - pos))
                    }
                    .font(.system(size: 10).monospacedDigit()).foregroundStyle(Theme.textSecondary)
                }
            }
            .padding(.top, 2)
        }
    }

    static func fmt(_ t: TimeInterval) -> String { String(format: "%d:%02d", Int(t) / 60, Int(t) % 60) }
}
