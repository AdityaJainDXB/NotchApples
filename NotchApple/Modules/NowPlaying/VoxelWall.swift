//
//  VoxelWall.swift
//  Notch Apple
//
//  Voxel Wall and Verse (issue #119): music-reactive 3D voxel worlds, and animated word-by-word lyrics.
//   • Screensaver: full screen on every display; keeps the Mac awake while it shows; any key, click or mouse move ends it.
//   • Music wallpaper: the same scene behind your desktop icons on every display.
//   • Scenes (VoxelWall.metal): Voxel Field, Spike Field, Infinite Tunnel, Voxel City. Colours: Ocean, Ember, Violet,
//     Monochrome, or taken from the album cover. Per-scene tuning: audio intensity and motion speed, and Energy Saver, a
//     silent prepared loop with no audio listening.
//   • Verse: the lyrics appear word by word, big, with the newest word on top of the last two, over grain and a glow in the
//     album's colours. Styles: Soft haze, Clear flow, Edge light. Or plain lines, or no lyrics.
//  The scene follows the real sound when the listen-only audio tap is allowed (MusicLevelMeter; nothing is recorded);
//  otherwise it pulses with a made-up beat while music plays. Lyrics come from LyricsModel (LRCLIB). Math: VoxelWallLogic.
//

import AppKit
import SwiftUI
import ImageIO

@MainActor
final class VoxelWall: ObservableObject {
    static let shared = VoxelWall()

    enum Scene: Int, CaseIterable, Identifiable {
        case field = 0, spikes, tunnel, city
        var id: Int { rawValue }
        var title: String { switch self { case .field: "Voxel Field"; case .spikes: "Spike Field"; case .tunnel: "Infinite Tunnel"; case .city: "Voxel City" } }
    }
    enum Palette: String, CaseIterable, Identifiable {
        case ocean, ember, violet, mono, album
        var id: String { rawValue }
        var title: String { switch self { case .ocean: "Ocean"; case .ember: "Ember"; case .violet: "Violet"; case .mono: "Monochrome"; case .album: "Album colours" } }
    }
    enum Lyrics: String, CaseIterable, Identifiable {
        case words, lines, off
        var id: String { rawValue }
        var title: String { switch self { case .words: "Word by word"; case .lines: "Whole lines"; case .off: "No lyrics" } }
    }
    enum VerseStyle: String, CaseIterable, Identifiable {
        case haze, clear, edge
        var id: String { rawValue }
        var title: String { switch self { case .haze: "Soft haze"; case .clear: "Clear flow"; case .edge: "Edge light" } }
    }

    @AppStorage("voxelWall.wallpaper") var wallpaperOn = false { didSet { applyWallpaper() } }
    @AppStorage("voxelWall.scene") var sceneRaw = Scene.field.rawValue { didSet { if wallpaperOn { syncLockScreen() } } }
    @AppStorage("voxelWall.palette") var paletteRaw = Palette.ocean.rawValue { didSet { if wallpaperOn { syncLockScreen() } } }
    @AppStorage("voxelWall.lyricsMode") var lyricsRaw = Lyrics.words.rawValue
    @AppStorage("voxelWall.verseStyle") var verseRaw = VerseStyle.haze.rawValue
    @AppStorage("voxelWall.intensity") var intensity = 1.0
    @AppStorage("voxelWall.speed") var speed = 1.0
    /// Energy Saver: a silent prepared loop, no audio listening.
    @AppStorage("voxelWall.energySaver") var energySaver = false
    /// Show only the lyrics (Verse) on its glow, without the voxel scene.
    @AppStorage("voxelWall.verseOnly") var verseOnly = false
    /// Lock screen: while the music wallpaper is on, a still of the scene is set as each display's desktop picture, which is what
    /// macOS shows on the lock screen (no app can play live graphics there). The original pictures come back when it is turned off.
    @AppStorage("voxelWall.lockScreen") var lockScreen = true { didSet { syncLockScreen() } }
    @AppStorage("voxelWall.lockRestore") private var lockRestoreRaw = ""
    @Published private(set) var screensaverOn = false

    var scene: Scene { Scene(rawValue: sceneRaw) ?? .field }
    var palette: Palette { Palette(rawValue: paletteRaw) ?? .ocean }
    var lyrics: Lyrics { Lyrics(rawValue: lyricsRaw) ?? .words }
    var verseStyle: VerseStyle { VerseStyle(rawValue: verseRaw) ?? .haze }

    /// True while any Voxel Wall is on screen: the lyrics model and the audio meter keep running for it.
    static var isShowing: Bool { shared.screensaverOn || shared.wallpaperOn }

    private var saverWindows: [NSWindow] = []
    private var wallWindows: [NSWindow] = []
    private var monitors: [Any] = []
    private var startedAwake = false
    private var screenObserver: NSObjectProtocol?
    private var bands: [Double] = [0, 0, 0, 0]
    private var lastBandsTime = 0.0

    private init() {}

    // MARK: Screensaver

    func startScreensaver() {
        guard !screensaverOn else { return }
        screensaverOn = true
        for screen in NSScreen.screens {
            let w = SaverWindow(screen: screen, content: VoxelWallScene(mode: .screensaver))
            w.makeKeyAndOrderFront(nil)
            saverWindows.append(w)
        }
        NSApp.activate(ignoringOtherApps: true)
        NSCursor.setHiddenUntilMouseMoves(true)
        // Keep the Mac awake while the screensaver shows, unless Keep Awake was already on (then leave it as it was).
        if !KeepAwake.shared.isOn { KeepAwake.shared.start(minutes: nil); startedAwake = true }
        startFeeds()
        let started = Date()
        let end: (NSEvent) -> NSEvent? = { [weak self] event in
            guard Date().timeIntervalSince(started) > 1.0 else { return event }   // ignore the click that started it
            if event.type == .mouseMoved, abs(event.deltaX) + abs(event.deltaY) < 8 { return event }
            self?.stopScreensaver()
            return nil
        }
        if let m = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown, .mouseMoved, .scrollWheel], handler: end) { monitors.append(m) }
    }

    func stopScreensaver() {
        guard screensaverOn else { return }
        screensaverOn = false
        monitors.forEach(NSEvent.removeMonitor); monitors = []
        saverWindows.forEach { $0.orderOut(nil) }; saverWindows = []
        if startedAwake { KeepAwake.shared.stop(); startedAwake = false }
        stopFeedsIfIdle()
    }

    // MARK: Music wallpaper

    func applyWallpaper() {
        wallWindows.forEach { $0.orderOut(nil) }; wallWindows = []
        if let o = screenObserver { NotificationCenter.default.removeObserver(o); screenObserver = nil }
        syncLockScreen()
        guard wallpaperOn else { stopFeedsIfIdle(); return }
        for screen in NSScreen.screens {
            let w = WallWindow(screen: screen, content: VoxelWallScene(mode: .wallpaper))
            w.orderFrontRegardless()
            wallWindows.append(w)
        }
        startFeeds()
        screenObserver = NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { if self?.wallpaperOn == true { self?.applyWallpaper() } }
        }
    }

    // MARK: Lock screen

    /// Sets (or puts back) the lock-screen picture to match the music wallpaper and the lock-screen switch.
    func syncLockScreen() {
        guard wallpaperOn && lockScreen else { restoreDesktops(); return }
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Notch apple/VoxelWall", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var restore = (try? JSONDecoder().decode([String: String].self, from: Data(lockRestoreRaw.utf8))) ?? [:]
        let (a, b) = colours(artwork: NowPlayingMonitor.shared.artwork)
        for screen in NSScreen.screens {
            let size = screen.frame.size
            let still = Rectangle().fill(.black).frame(width: size.width, height: size.height)
                .colorEffect(ShaderLibrary.voxelWall(.boundingRect, .float(37.5), .float4(0.7, 0.45, 0.35, 0.6), .float(Float(scene.rawValue)), .float(Float(intensity)), .color(a), .color(b)))
            let r = ImageRenderer(content: still); r.scale = screen.backingScaleFactor
            guard let cg = r.cgImage else { continue }
            let key = Self.screenKey(screen)
            // A new file name each time, so macOS doesn't keep showing an old cached picture.
            let url = dir.appendingPathComponent("lock-\(key)-\(Int(Date().timeIntervalSince1970)).png")
            guard let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else { continue }
            CGImageDestinationAddImage(dest, cg, nil)
            guard CGImageDestinationFinalize(dest) else { continue }
            if restore[key] == nil, let old = NSWorkspace.shared.desktopImageURL(for: screen), !old.path.contains("Notch apple/VoxelWall") { restore[key] = old.absoluteString }
            try? NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [.imageScaling: NSNumber(value: NSImageScaling.scaleProportionallyUpOrDown.rawValue), .allowClipping: NSNumber(value: true)])
        }
        lockRestoreRaw = (try? String(data: JSONEncoder().encode(restore), encoding: .utf8)) ?? ""
        // Old stills: keep only the newest per display.
        if let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.creationDateKey]) {
            let current = Set(NSScreen.screens.compactMap { NSWorkspace.shared.desktopImageURL(for: $0)?.lastPathComponent })
            for f in files where f.lastPathComponent.hasPrefix("lock-") && !current.contains(f.lastPathComponent) { try? FileManager.default.removeItem(at: f) }
        }
    }

    /// Puts each display's own desktop picture back.
    private func restoreDesktops() {
        guard let saved = try? JSONDecoder().decode([String: String].self, from: Data(lockRestoreRaw.utf8)), !saved.isEmpty else { return }
        for screen in NSScreen.screens {
            if let s = saved[Self.screenKey(screen)], let url = URL(string: s), FileManager.default.fileExists(atPath: url.path) {
                try? NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [:])
            }
        }
        lockRestoreRaw = ""
    }

    private static func screenKey(_ s: NSScreen) -> String {
        (s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber).map { "\($0)" } ?? "main"
    }

    // MARK: What drives the scene

    func startFeeds() {
        LyricsModel.shared.start()
        if !energySaver, SettingsManager.shared.musicBarsFollowAudio { MusicLevelMeter.shared.resetFailure(); MusicLevelMeter.shared.start() }
    }

    private func stopFeedsIfIdle() {
        guard !Self.isShowing else { return }
        LyricsModel.shared.stop()
        if LiveActivityCenter.shared.current?.musicBars != true { MusicLevelMeter.shared.stop() }   // the notch's bars may still use it
    }

    /// The four band levels (bass … highs, 0…1) for this frame, eased; shared by every display's scene.
    func levels(time: Double) -> [Double] {
        guard time != lastBandsTime else { return bands }
        lastBandsTime = time
        let playing = NowPlayingMonitor.shared.current?.isPlaying == true
        let meter = MusicLevelMeter.shared
        let raw: [Double]
        if energySaver { raw = VoxelWallLogic.simulatedLevels(time: time, playing: true).map { $0 * 0.7 } }
        else if meter.isLive { raw = meter.nextFrame().map { Double($0) } }
        else { raw = VoxelWallLogic.simulatedLevels(time: time, playing: playing) }
        bands = VoxelWallLogic.easeBands(bands, toward: raw)
        return bands
    }

    /// The scene's two colours: the deep base and the bright highlight.
    func colours(artwork: NSImage?) -> (Color, Color) {
        switch palette {
        case .ocean: return (Color(red: 0.05, green: 0.55, blue: 0.56), Color(red: 0.93, green: 0.74, blue: 0.32))
        case .ember: return (Color(red: 0.62, green: 0.12, blue: 0.08), Color(red: 1.0, green: 0.72, blue: 0.3))
        case .violet: return (Color(red: 0.32, green: 0.16, blue: 0.78), Color(red: 1.0, green: 0.5, blue: 0.8))
        case .mono: return (Color(white: 0.38), Color(white: 0.96))
        case .album:
            if let art = artwork, let c = NotchTriggerView.accentColor(of: art) {
                let base = c.usingColorSpace(.sRGB) ?? c
                let light = NSColor(hue: base.hueComponent + 0.08, saturation: base.saturationComponent * 0.6, brightness: 1, alpha: 1)
                return (Color(nsColor: base), Color(nsColor: light))
            }
            return (Color(red: 0.05, green: 0.55, blue: 0.56), Color(red: 0.93, green: 0.74, blue: 0.32))
        }
    }
}

/// Full-screen window for the screensaver: above everything, takes keys so any key press ends it.
private final class SaverWindow: NSWindow {
    init(screen: NSScreen, content: some View) {
        super.init(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        level = .screenSaver
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        isOpaque = true; backgroundColor = .black; hasShadow = false; isReleasedWhenClosed = false
        acceptsMouseMovedEvents = true
        contentView = NSHostingView(rootView: content)
        setFrame(screen.frame, display: true)
    }
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

/// The music wallpaper: a borderless window at the desktop's level on every Space, under the icons, never clickable.
private final class WallWindow: NSWindow {
    init(screen: NSScreen, content: some View) {
        super.init(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        isOpaque = true; backgroundColor = .black; hasShadow = false
        ignoresMouseEvents = true; isReleasedWhenClosed = false; canHide = false
        contentView = NSHostingView(rootView: content)
        setFrame(screen.frame, display: true)
    }
}

// MARK: - The scene

struct VoxelWallScene: View {
    enum Mode { case screensaver, wallpaper, preview }
    let mode: Mode
    @ObservedObject private var wall = VoxelWall.shared
    @ObservedObject private var monitor = NowPlayingMonitor.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showHint = true

    var body: some View {
        let (a, b) = wall.colours(artwork: monitor.artwork)
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 3600)
            let bands = wall.levels(time: t)
            ZStack {
                if wall.verseOnly {
                    VerseBackdrop(time: t, bass: bands[0], a: a, b: b, style: wall.verseStyle)
                } else {
                    Rectangle().fill(.black)
                        .colorEffect(ShaderLibrary.voxelWall(.boundingRect, .float(t * wall.speed),
                                                             .float4(Float(bands[0]), Float(bands[1]), Float(bands[2]), Float(bands[3])),
                                                             .float(Float(wall.scene.rawValue)), .float(Float(wall.intensity)), .color(a), .color(b)))
                }
                lyrics(time: t, accent: b)
            }
        }
        .ignoresSafeArea()
        .overlay(alignment: .bottomLeading) { if mode != .preview { nowPlaying } }
        .overlay(alignment: .top) {
            if mode == .screensaver, showHint {
                Text("Press any key or move the mouse to exit").font(.system(size: 13, weight: .medium)).foregroundStyle(.white.opacity(0.6)).padding(.top, 40)
            }
        }
        .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 3) { withAnimation(.easeOut(duration: 1)) { showHint = false } } }
    }

    @ViewBuilder private func lyrics(time: Double, accent: Color) -> some View {
        switch wall.lyrics {
        case .off: EmptyView()
        case .lines: LyricLines(scale: mode == .preview ? 0.35 : 1)
        case .words: VerseWords(style: wall.verseStyle, accent: accent, scale: mode == .preview ? 0.35 : 1)
        }
    }

    @ViewBuilder private var nowPlaying: some View {
        if let now = monitor.current, !now.title.isEmpty {
            HStack(spacing: 12) {
                if let art = monitor.artwork { Image(nsImage: art).resizable().frame(width: 54, height: 54).clipShape(RoundedRectangle(cornerRadius: 8)) }
                VStack(alignment: .leading, spacing: 2) {
                    Text(now.title).font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
                    Text(now.artist).font(.system(size: 14)).foregroundStyle(.white.opacity(0.7))
                }
            }
            .padding(36)
        }
    }
}

/// Verse's background when the lyrics show on their own: a dark field with a slow glow in the album's colours, and grain.
private struct VerseBackdrop: View {
    let time: Double, bass: Double
    let a: Color, b: Color
    let style: VoxelWall.VerseStyle
    var body: some View {
        ZStack {
            Color.black
            RadialGradient(colors: [a.opacity(0.75), .clear], center: UnitPoint(x: 0.3 + 0.1 * sin(time * 0.2), y: 0.75), startRadius: 0, endRadius: 900)
            RadialGradient(colors: [b.opacity(0.35 + 0.3 * bass), .clear], center: UnitPoint(x: 0.75 + 0.08 * cos(time * 0.17), y: 0.2), startRadius: 0, endRadius: 700)
            if style == .edge {
                Rectangle().strokeBorder(LinearGradient(colors: [a, b, a], startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 10).blur(radius: 18).opacity(0.7 + 0.3 * bass)
            }
        }
        .colorEffect(ShaderLibrary.voxelGrain(.float(Float(time)), .float(0.09)))
    }
}

/// The lyrics, word by word: the newest word big, the two before it smaller above it (VoxelVerse look).
private struct VerseWords: View {
    let style: VoxelWall.VerseStyle
    let accent: Color
    var scale: CGFloat = 1
    @ObservedObject private var lyrics = LyricsModel.shared
    @ObservedObject private var monitor = NowPlayingMonitor.shared

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 15.0)) { _ in
            let words = currentWords()
            VStack(spacing: -10 * scale) {
                ForEach(Array(words.enumerated()), id: \.offset) { k, w in
                    let newest = k == words.count - 1
                    Text(w)
                        .font(.system(size: (newest ? 150 : 72) * scale, weight: .black, design: .serif))
                        .italic(style == .clear)
                        .foregroundStyle(newest ? accent : accent.opacity(0.55))
                        .shadow(color: accent.opacity(style == .clear ? 0.2 : 0.8), radius: style == .haze ? 30 : 10)
                        .blur(radius: style == .haze && !newest ? 1.5 : 0)
                        .transition(.asymmetric(insertion: .scale(scale: 1.4).combined(with: .opacity), removal: .opacity))
                        .id("\(lyrics.currentIndex ?? -1)-\(w)-\(k)")
                }
            }
            .animation(.spring(response: 0.35, dampingFraction: 0.7), value: words)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(60)
        }
    }

    private func currentWords() -> [String] {
        guard let i = lyrics.currentIndex, i < lyrics.lines.count else { return [] }
        let line = lyrics.lines[i]
        let words = line.text.split(separator: " ").map(String.init)
        let next = i + 1 < lyrics.lines.count ? lyrics.lines[i + 1].time : nil
        let pos = monitor.position ?? line.time
        let shown = VoxelWallLogic.wordsShown(lineStart: line.time, nextStart: next, position: pos, wordCount: words.count)
        return VoxelWallLogic.stack(words, shown: shown)
    }
}

/// The lyrics as whole lines: the current one big, the lines around it dim.
private struct LyricLines: View {
    var scale: CGFloat = 1
    @ObservedObject private var lyrics = LyricsModel.shared
    var body: some View {
        VStack(spacing: 10 * scale) {
            if let i = lyrics.currentIndex, i < lyrics.lines.count {
                if i > 0 { Text(lyrics.lines[i - 1].text).font(.system(size: 22 * scale, weight: .semibold, design: .rounded)).foregroundStyle(.white.opacity(0.35)) }
                Text(lyrics.lines[i].text).font(.system(size: 54 * scale, weight: .heavy, design: .rounded)).foregroundStyle(.white)
                    .multilineTextAlignment(.center).padding(.horizontal, 80 * scale).id(i)
                    .transition(.asymmetric(insertion: .scale(scale: 0.85).combined(with: .opacity), removal: .opacity))
                if i + 1 < lyrics.lines.count { Text(lyrics.lines[i + 1].text).font(.system(size: 22 * scale, weight: .semibold, design: .rounded)).foregroundStyle(.white.opacity(0.35)) }
            }
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.8), value: lyrics.currentIndex)
    }
}

// MARK: - Controls in the Now Playing tab

struct VoxelWallRow: View {
    @ObservedObject private var wall = VoxelWall.shared
    @State private var tuning = false
    var body: some View {
        HStack(spacing: 8) {
            Button { wall.startScreensaver() } label: { Label("Voxel Wall", systemImage: "cube.fill").font(.system(size: 11, weight: .semibold)) }
                .buttonStyle(PurpleButtonStyle())
                .help("Full-screen voxel worlds that move with your music, with animated lyrics. Keeps the Mac awake; any key ends it.")
            Toggle("Music wallpaper", isOn: $wall.wallpaperOn).toggleStyle(.switch).controlSize(.mini)
                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                .help("The same scene behind your desktop icons")
            Button { tuning.toggle() } label: { Image(systemName: "slider.horizontal.3") }
                .buttonStyle(MetalPlainStyle()).help("Scene, colours, lyrics and tuning")
                .popover(isPresented: $tuning, arrowEdge: .bottom) { VoxelWallSettings().padding(14).frame(width: 340) }
        }
    }
}

struct VoxelWallSettings: View {
    @ObservedObject private var wall = VoxelWall.shared
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VoxelWallScene(mode: .preview).frame(height: 170).clipShape(RoundedRectangle(cornerRadius: 10))
            Picker("Scene", selection: $wall.sceneRaw) { ForEach(VoxelWall.Scene.allCases) { Text($0.title).tag($0.rawValue) } }
            Picker("Colours", selection: $wall.paletteRaw) { ForEach(VoxelWall.Palette.allCases) { Text($0.title).tag($0.rawValue) } }
            Picker("Lyrics", selection: $wall.lyricsRaw) { ForEach(VoxelWall.Lyrics.allCases) { Text($0.title).tag($0.rawValue) } }
            if wall.lyrics == .words {
                Picker("Lyric style", selection: $wall.verseRaw) { ForEach(VoxelWall.VerseStyle.allCases) { Text($0.title).tag($0.rawValue) } }.pickerStyle(.segmented)
                Toggle("Lyrics only (no voxel scene)", isOn: $wall.verseOnly)
            }
            LabeledContent("Audio intensity") { Slider(value: $wall.intensity, in: 0.2...2) }
            LabeledContent("Motion speed") { Slider(value: $wall.speed, in: 0.3...2.5) }
            Toggle("Show on the lock screen (a still of the scene, while the music wallpaper is on)", isOn: $wall.lockScreen)
            Toggle("Energy Saver (a silent loop, no audio listening)", isOn: Binding(get: { wall.energySaver }, set: { wall.energySaver = $0; if !$0 && VoxelWall.isShowing { wall.startFeeds() } }))
            Text("Follows what your Mac plays through a listen-only audio tap (System Audio Recording permission); nothing is recorded or sent. Lyrics come from LRCLIB.")
                .font(.system(size: 10)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(size: 12))
        .onAppear { wall.startFeeds() }
    }
}
