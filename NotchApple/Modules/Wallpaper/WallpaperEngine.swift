//
//  WallpaperEngine.swift
//  Notch apple
//
//  Live wallpaper (Pro): plays your video, silently and on a loop, behind your desktop icons on every display and on every
//  desktop (Space). It is a borderless window at the desktop's own level, so it sits above the system wallpaper and below
//  everything else.
//
//  Lock screen: macOS lets no app play video there. So when the wallpaper starts, a still picture from the video is set as
//  the system wallpaper (the lock screen and login window show it), and the original wallpaper is put back when you turn
//  it off.
//
//  Battery and heat: the video pauses on battery (unless you say otherwise), in Low Power Mode, when the screen sleeps or
//  is locked, and whenever windows completely cover a display's wallpaper, because then nobody can see it. See WallpaperLogic.
//

import AppKit
import AVFoundation
import IOKit.ps
import SwiftUI

@MainActor
final class WallpaperEngine: ObservableObject {
    static let shared = WallpaperEngine()

    @AppStorage("wallpaper.on") var isOn = false { didSet { apply() } }
    @AppStorage("wallpaper.selected") var selectedID = "" { didSet { apply() } }
    /// Pause on battery (on by default: a 4K video all day is a lot of power).
    @AppStorage("wallpaper.pauseOnBattery") var pauseOnBattery = true { didSet { reevaluate() } }
    /// Set a still picture from the video as the system wallpaper, so the lock screen shows it.
    @AppStorage("wallpaper.lockStill") var lockStill = true { didSet { if running { Task { await syncStill() } } } }
    @AppStorage("wallpaper.restore") private var restoreRaw = ""

    @Published private(set) var running = false
    @Published private(set) var playing = false
    @Published private(set) var note: String?

    private var windows: [WallpaperWindow] = []
    private var startedID = ""
    private var observers: [NSObjectProtocol] = []
    private var distributed: [NSObjectProtocol] = []
    private var timer: Timer?
    private var screensAsleep = false, screenLocked = false

    var current: WallpaperItem? { WallpaperLibrary.shared.item(selectedID) }
    private var allowed: Bool { isOn && Entitlements.shared.canUse(.liveWallpaper) && current != nil }

    func choose(_ id: String?) { selectedID = id ?? "" }

    /// Starts, restarts or stops to match the switch, the choice and the licence. Safe to call often.
    func apply() {
        if allowed {
            if !running || startedID != selectedID { start() }
        } else if running {
            stop()
        }
    }

    // MARK: Start and stop

    private func start() {
        teardownWindows()
        guard let item = current else { return }
        startedID = item.id
        let url = WallpaperLibrary.fileURL(item)
        windows = NSScreen.screens.map { WallpaperWindow(screen: $0, url: url) }
        running = true
        note = nil
        observe()
        reevaluate()
        Task { await syncStill() }
    }

    func stop() {
        teardownWindows()
        for o in observers { NotificationCenter.default.removeObserver(o) }
        for o in distributed { DistributedNotificationCenter.default().removeObserver(o) }
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        observers = []; distributed = []
        timer?.invalidate(); timer = nil
        restoreDesktops()
        running = false; playing = false; startedID = ""
    }

    private func teardownWindows() {
        windows.forEach { $0.shutDown() }
        windows = []
    }

    // MARK: Watching the Mac

    private func observe() {
        guard observers.isEmpty else { return }
        let nc = NotificationCenter.default, ws = NSWorkspace.shared.notificationCenter
        observers.append(nc.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { WallpaperEngine.shared.screensChanged() }
        })
        observers.append(nc.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { WallpaperEngine.shared.reevaluate() }
        })
        observers.append(nc.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: nil, queue: .main) { n in
            MainActor.assumeIsolated { if n.object is WallpaperWindow { WallpaperEngine.shared.reevaluate() } }
        })
        observers.append(ws.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { WallpaperEngine.shared.screensAsleep = true; WallpaperEngine.shared.reevaluate() }
        })
        observers.append(ws.addObserver(forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { WallpaperEngine.shared.screensAsleep = false; WallpaperEngine.shared.reevaluate() }
        })
        let dn = DistributedNotificationCenter.default()
        distributed.append(dn.addObserver(forName: NSNotification.Name("com.apple.screenIsLocked"), object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { WallpaperEngine.shared.screenLocked = true; WallpaperEngine.shared.reevaluate() }
        })
        distributed.append(dn.addObserver(forName: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { WallpaperEngine.shared.screenLocked = false; WallpaperEngine.shared.reevaluate() }
        })
        // Plugging in or unplugging has no easy notification, so look every 20 seconds as well.
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { _ in MainActor.assumeIsolated { WallpaperEngine.shared.reevaluate() } }
    }

    private func screensChanged() {
        guard running else { return }
        teardownWindows()
        if let item = current { windows = NSScreen.screens.map { WallpaperWindow(screen: $0, url: WallpaperLibrary.fileURL(item)) } }
        reevaluate()
    }

    private static var onBattery: Bool {
        guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let type = IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() as String? else { return false }
        return type == kIOPSBatteryPowerValue
    }

    /// Plays or pauses each display's video from what the Mac is doing right now.
    func reevaluate() {
        guard running else { return }
        var any = false
        for w in windows {
            let c = WallpaperLogic.Conditions(onBattery: Self.onBattery, lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled,
                                              pauseOnBattery: pauseOnBattery, screensAsleep: screensAsleep, screenLocked: screenLocked,
                                              covered: !w.occlusionState.contains(.visible))
            let play = WallpaperLogic.shouldPlay(c)
            w.setPlaying(play)
            if play { any = true }
        }
        if playing != any { playing = any }
        let why = Self.onBattery && pauseOnBattery ? "Paused on battery." : ProcessInfo.processInfo.isLowPowerModeEnabled ? "Paused in Low Power Mode." : nil
        if !any, note != why { note = why } else if any, note != nil { note = nil }
    }

    // MARK: The still picture for the lock screen

    private func syncStill() async {
        guard let item = current, running else { return }
        guard lockStill else { restoreDesktops(); return }
        let still = WallpaperLibrary.stillURL(item.id)
        if !FileManager.default.fileExists(atPath: still.path) {
            guard let image = await WallpaperLibrary.frame(of: WallpaperLibrary.fileURL(item), maxWidth: 3840) else { return }
            WallpaperLibrary.writeJPEG(image, to: still, quality: 0.92)
        }
        var restore = (try? JSONDecoder().decode([String: String].self, from: Data(restoreRaw.utf8))) ?? [:]
        for screen in NSScreen.screens {
            let key = Self.screenKey(screen)
            if restore[key] == nil, let old = NSWorkspace.shared.desktopImageURL(for: screen), !old.path.contains("Notch apple/Wallpapers") { restore[key] = old.absoluteString }
            try? NSWorkspace.shared.setDesktopImageURL(still, for: screen, options: [
                .imageScaling: NSNumber(value: NSImageScaling.scaleProportionallyUpOrDown.rawValue), .allowClipping: NSNumber(value: true)])
        }
        restoreRaw = (try? String(data: JSONEncoder().encode(restore), encoding: .utf8)) ?? ""
    }

    /// Puts each display's original wallpaper back.
    private func restoreDesktops() {
        guard let saved = try? JSONDecoder().decode([String: String].self, from: Data(restoreRaw.utf8)), !saved.isEmpty else { restoreRaw = ""; return }
        for screen in NSScreen.screens {
            if let s = saved[Self.screenKey(screen)], let url = URL(string: s), FileManager.default.fileExists(atPath: url.path) {
                try? NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [:])
            }
        }
        restoreRaw = ""
    }

    private static func screenKey(_ s: NSScreen) -> String {
        (s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber).map { "\($0)" } ?? s.localizedName
    }
}

/// One display's wallpaper: a borderless window at the desktop's level holding the looping video.
final class WallpaperWindow: NSWindow {
    private let player = AVQueuePlayer()
    private var looper: AVPlayerLooper?
    private let layer = AVPlayerLayer()

    init(screen: NSScreen, url: URL) {
        super.init(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        isOpaque = true; backgroundColor = .black; hasShadow = false
        ignoresMouseEvents = true; isReleasedWhenClosed = false; canHide = false
        setFrame(screen.frame, display: false)
        let view = NSView(frame: NSRect(origin: .zero, size: screen.frame.size))
        view.wantsLayer = true
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        layer.autoresizingMask = [.layerWidthSizable, .layerHeightSizable]
        view.layer?.addSublayer(layer)
        contentView = view
        player.isMuted = true
        player.volume = 0
        player.preventsDisplaySleepDuringVideoPlayback = false
        looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
        layer.player = player
        orderFrontRegardless()
    }

    func setPlaying(_ play: Bool) {
        if play { if player.rate == 0 { player.play() } } else if player.rate != 0 { player.pause() }
    }

    func shutDown() {
        player.pause()
        looper?.disableLooping()
        layer.player = nil
        orderOut(nil)
        close()
    }
}
