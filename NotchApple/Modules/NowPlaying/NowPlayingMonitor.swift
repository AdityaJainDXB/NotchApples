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
    @StateObject private var sleep = MusicSleepTimer.shared
    /// The lyrics view (cover, progress and big scrolling lyrics), opened by clicking the song's title.
    @State private var showLyrics = false
    @AppStorage("nowPlaying.cassette") private var cassette = false

    var body: some View {
        if showLyrics, monitor.current?.title.isEmpty == false {
            NowPlayingLyricsView { withAnimation(.easeInOut(duration: 0.2)) { showLyrics = false } }
                .transition(.opacity)
        } else {
            player
        }
    }

    private var player: some View {
        HStack(spacing: 18) {
            if cassette {
                CassetteView(monitor: monitor).frame(width: 200)
            } else {
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
            }

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
                    // Click the song to see its lyrics, Spotify-style.
                    VStack(alignment: .leading, spacing: 6) {
                        Text(now.title).font(.title2.bold()).foregroundStyle(.white).lineLimit(2)
                        Text([now.artist, monitor.album].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.title3).foregroundStyle(Theme.textSecondary).lineLimit(1)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { withAnimation(.easeInOut(duration: 0.2)) { showLyrics = true } }
                    .help("Show the lyrics")
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
                    IconButton(systemImage: cassette ? "photo.fill" : "recordingtape", help: cassette ? "Back to the cover" : "Cassette mode") { withAnimation(Theme.spring) { cassette.toggle() } }
                    if monitor.current?.title.isEmpty == false {
                        IconButton(systemImage: "quote.bubble.fill", help: "Lyrics") { withAnimation(.easeInOut(duration: 0.2)) { showLyrics = true } }
                    }
                    Menu {
                        ForEach([15, 30, 45, 60, 90], id: \.self) { m in Button("Pause in \(m) minutes") { sleep.start(minutes: m) } }
                        if sleep.endsAt != nil { Divider(); Button("Cancel the sleep timer") { sleep.cancel() } }
                    } label: {
                        if let end = sleep.endsAt { Label { Text(end, style: .timer).monospacedDigit() } icon: { Image(systemName: "moon.zzz.fill") } }
                        else { Image(systemName: "moon.zzz") }
                    }
                    .menuStyle(.borderlessButton).fixedSize().help("Sleep timer: pause the music after a while")
                }
                .padding(.top, 4)
                if monitor.current?.title.isEmpty == false { BalanceRow() }
                SideLyricsRow()
                BrowserMediaBar()
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

/// Left / right speaker balance for whatever is playing: slide left and all the sound goes to the left speaker.
/// It snaps to the middle near the centre. Uses the output's own balance (as in System Settings → Sound).
private struct BalanceRow: View {
    @ObservedObject private var audio = AudioDeviceController.shared

    var body: some View {
        if audio.balanceSupported {
            HStack(spacing: 6) {
                Image(systemName: "speaker.wave.1.fill").font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
                Text("L").font(.system(size: 10, weight: .bold)).foregroundStyle(audio.balance < 0.45 ? .white : Theme.textSecondary)
                Slider(value: Binding(get: { Double(audio.balance) },
                                      set: { v in audio.setBalance(Float(abs(v - 0.5) < 0.04 ? 0.5 : v)) }), in: 0...1)
                    .controlSize(.mini).frame(width: 130)
                Text("R").font(.system(size: 10, weight: .bold)).foregroundStyle(audio.balance > 0.55 ? .white : Theme.textSecondary)
                Text(label).font(.system(size: 10).monospacedDigit()).foregroundStyle(Theme.textSecondary).frame(width: 62, alignment: .leading)
                if abs(audio.balance - 0.5) > 0.01 {
                    Button("Centre") { audio.setBalance(0.5) }.buttonStyle(.plain)
                        .font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.accentBright)
                }
            }
            .help("Speaker balance: slide left to send the sound to the left speaker, right for the right")
        } else {
            Color.clear.frame(height: 0).onAppear { audio.refreshBalance() }
        }
    }

    private var label: String {
        let b = audio.balance
        if abs(b - 0.5) < 0.01 { return "Centre" }
        if b <= 0.005 { return "All left" }
        if b >= 0.995 { return "All right" }
        return b < 0.5 ? "\(Int(((0.5 - b) * 200).rounded()))% left" : "\(Int(((b - 0.5) * 200).rounded()))% right"
    }
}

/// Spotify-style lyrics inside the notch: the cover and the song on the left with a progress bar and controls,
/// big synced lyrics on the right that scroll with the song, over a blurred copy of the cover.
private struct NowPlayingLyricsView: View {
    let close: () -> Void
    @ObservedObject private var monitor = NowPlayingMonitor.shared
    @StateObject private var lyrics = LyricsModel.shared
    @ObservedObject private var entitlements = Entitlements.shared

    var body: some View {
        ZStack {
            if let art = monitor.artwork {
                Image(nsImage: art).resizable().aspectRatio(contentMode: .fill).blur(radius: 40).opacity(0.6)
            } else {
                Theme.accentGradient.opacity(0.5)
            }
            LinearGradient(colors: [.black.opacity(0.25), .black.opacity(0.6)], startPoint: .top, endPoint: .bottom)
            HStack(alignment: .top, spacing: 20) {
                song.frame(width: 210)
                lyricsColumn.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .padding(16)
        }
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .onAppear { lyrics.start() }
        .onDisappear { if !FullScreenLyrics.isOpen { lyrics.stop() } }
    }

    private var song: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Button(action: close) { Label("Player", systemImage: "chevron.left").font(.system(size: 11, weight: .semibold)) }
                    .buttonStyle(.plain).foregroundStyle(.white.opacity(0.85)).help("Back to the player")
                Spacer()
                IconButton(systemImage: "arrow.up.left.and.arrow.down.right", help: "Full-screen lyrics") {
                    AppDelegate.current?.notch?.closeNotch()
                    FullScreenLyrics.toggle()
                }
            }
            Group {
                if let art = monitor.artwork {
                    Image(nsImage: art).resizable().aspectRatio(contentMode: .fill)
                } else {
                    ZStack { Theme.accentGradient; Image(systemName: "music.note").font(.system(size: 34, weight: .semibold)).foregroundStyle(.white) }
                }
            }
            .frame(width: 96, height: 96)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .shadow(color: .black.opacity(0.4), radius: 10, y: 4)
            if let now = monitor.current {
                Text(now.title).font(.system(size: 15, weight: .bold)).foregroundStyle(.white).lineLimit(2)
                Text(now.artist).font(.system(size: 12)).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
            }
            ProgressRow()
            HStack(spacing: 4) {
                IconButton(systemImage: "backward.fill", help: "Previous track") { MediaControl.send(.previous) }
                IconButton(systemImage: monitor.current?.isPlaying == true ? "pause.fill" : "play.fill", help: "Play / pause") { monitor.playPause() }
                IconButton(systemImage: "forward.fill", help: "Next track") { MediaControl.send(.next) }
            }
        }
    }

    @ViewBuilder private var lyricsColumn: some View {
        if !entitlements.canUse(.lyrics) {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "quote.bubble.fill").font(.system(size: 26)).foregroundStyle(.white.opacity(0.8))
                Text("Synced lyrics are part of Pro").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                Text("They scroll with the song, line by line. The cover, progress and controls here are free.")
                    .font(.system(size: 12)).foregroundStyle(.white.opacity(0.75))
            }
        } else if !lyrics.lines.isEmpty {
            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(lyrics.lines.indices, id: \.self) { i in
                            let current = i == (lyrics.currentIndex ?? -1)
                            let past = i < (lyrics.currentIndex ?? -1)
                            Text(lyrics.lines[i].text.isEmpty ? "♪" : lyrics.lines[i].text)
                                .font(.system(size: current ? 22 : 19, weight: .heavy))
                                .foregroundStyle(current ? Color.white : Color.white.opacity(past ? 0.5 : 0.32))
                                .fixedSize(horizontal: false, vertical: true)
                                .id(i)
                        }
                    }
                    .padding(.vertical, 60)
                }
                .onAppear { if let i = lyrics.currentIndex { proxy.scrollTo(i, anchor: .center) } }
                .onChange(of: lyrics.currentIndex) { _, new in
                    if let new { withAnimation(.easeInOut(duration: 0.35)) { proxy.scrollTo(new, anchor: .center) } }
                }
            }
            .mask(LinearGradient(colors: [.clear, .black, .black, .clear], startPoint: .top, endPoint: .bottom))
        } else if let plain = lyrics.plain {
            ScrollView(showsIndicators: false) {
                Text(plain).font(.system(size: 16, weight: .bold)).foregroundStyle(.white.opacity(0.85))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            Text(lyrics.status.isEmpty ? "Finding lyrics…" : lyrics.status)
                .font(.system(size: 16, weight: .bold)).foregroundStyle(.white.opacity(0.7))
        }
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
