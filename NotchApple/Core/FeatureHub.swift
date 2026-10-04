//
//  FeatureHub.swift
//  Notch apple
//
//  Wires the 1.14 features into the closed notch and runs their light
//  background checks:
//   • registers each feature's "live activity" (timer, recording, download…)
//     with LiveActivityCenter, in priority order;
//   • a 30-second heartbeat for meeting reminders, rain alerts, accessory
//     battery and the mic / camera indicator;
//   • the notchapple:// URL scheme, so Apple Shortcuts (and anything else)
//     can drive the notch.
//
//  Small shared helpers live here too: notifications, paste-into-front-app
//  and media keys.
//

import AppKit
import SwiftUI
import UserNotifications

@MainActor
enum FeatureHub {
    private static var heartbeat: Timer?

    static func start() {
        let center = LiveActivityCenter.shared
        let settings = SettingsManager.shared
        center.providers = [
            { ScreenRecorder.shared.liveActivity },
            { VoiceNotesModel.shared.liveActivity },
            { settings.meetingAlert && Entitlements.shared.canUse(.meetingAlert) ? MeetingWatcher.shared.liveActivity : nil },
            { settings.timerEnabled ? CountdownTimer.shared.liveActivity : nil },
            { settings.downloadProgress && Entitlements.shared.canUse(.downloadProgress) ? DownloadWatcher.shared.liveActivity : nil },
            { settings.musicActivity && settings.nowPlayingEnabled ? NowPlayingMonitor.shared.liveActivity : nil },
            { settings.devicesEnabled && settings.privacyIndicator ? PrivacyMonitor.shared.liveActivity : nil },
            { settings.liveEnabled ? ScoresModel.shared.liveActivity : nil },
            { settings.f1Enabled ? F1Model.shared.liveActivity : nil },
            { settings.sportsEnabled ? (SportsModel.shared.liveActivity ?? MoreTeams.shared.rotatingActivity) : nil },
            { ExternalActivities.shared.liveActivity },
            { settings.liveEnabled ? FlightWatcher.shared.liveActivity : nil },
            { settings.marketsEnabled ? MarketsModel.shared.liveActivity : nil },
            { settings.toolsEnabled && settings.keepAwakeActivity ? KeepAwake.shared.liveActivity : nil },
        ]
        DownloadWatcher.shared.setEnabled(settings.downloadProgress && Entitlements.shared.canUse(.downloadProgress))
        registerURLScheme()
        ExternalActivities.shared.start()
        Power.start()
        heartbeat = Power.timer(30) { beat() }
        Power.onChange.append {
            heartbeat?.invalidate()
            heartbeat = Power.timer(30) { beat() }
            // Stop the pollers while idle; the next heartbeat restarts what's needed.
            if Power.isIdle {
                PrivacyMonitor.shared.setRunning(false)
                NotificationMirror.shared.setRunning(false)
                pauseMessenger()
            } else {
                resumeMessenger()
                beat()
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { beat() }
    }

    /// Cheap periodic checks; anything slow runs off the main thread inside each feature.
    private static func beat() {
        let s = SettingsManager.shared
        if s.meetingAlert && s.todayEnabled && Entitlements.shared.canUse(.meetingAlert) { MeetingWatcher.shared.check() }
        if s.rainAlert && s.todayEnabled && Entitlements.shared.canUse(.rainAlert) { RainWatcher.shared.checkIfDue() }
        if s.devicesEnabled {
            PrivacyMonitor.shared.setRunning(s.privacyIndicator)
            if s.accessoryBatteryAlert { DeviceBatteryModel.shared.refreshIfDue(every: 600) }
        } else {
            PrivacyMonitor.shared.setRunning(false)
        }
        NotificationMirror.shared.setRunning(s.alertsEnabled)
        if s.liveEnabled { ScoresModel.shared.refreshIfDue() }
        if s.f1Enabled { F1Model.shared.refreshIfDue() }
        if s.sportsEnabled { SportsModel.shared.refreshIfDue(); MoreTeams.shared.refreshIfDue() }
        if s.liveEnabled { FlightWatcher.shared.refreshIfDue() }
        if s.marketsEnabled { MarketsModel.shared.refreshIfDue() }
        DownloadWatcher.shared.setEnabled(s.downloadProgress && Entitlements.shared.canUse(.downloadProgress))
        LiveActivityCenter.shared.recompute()
    }

    // MARK: Messenger while idle

    /// Nearby discovery keeps Wi-Fi/Bluetooth busy and a room keeps a live connection, so both
    /// pause while the displays sleep (nobody can read messages then) and come back on wake.
    private static var messengerPaused = false

    private static func pauseMessenger() {
        guard !messengerPaused else { return }
        messengerPaused = true
        LocalP2PManager.shared.stop()
        if WebP2PManager.shared.room != nil { WebP2PManager.shared.leave(remember: true) }
    }

    private static func resumeMessenger() {
        guard messengerPaused else { return }
        messengerPaused = false
        let s = SettingsManager.shared
        guard s.messengerEnabled, Entitlements.shared.canUse(Feature.messenger) else { return }
        if s.messengerLocalDiscovery { LocalP2PManager.shared.start() }
        if let room = UserDefaults.standard.string(forKey: "messenger.activeRoom") { WebP2PManager.shared.join(room) }
    }

    // MARK: notchapple:// URL scheme

    private static func registerURLScheme() {
        NSAppleEventManager.shared().setEventHandler(URLHandler.shared, andSelector: #selector(URLHandler.handle(_:reply:)),
                                                     forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
    }

    /// notchapple://open/<tab>, toggle, close, hide, show, timer?minutes=5, stopwatch, focus/start, focus/stop,
    /// keepawake?minutes=30, keepawake/off, snippet?name=…, record, screenshot, activate?key=…,
    /// activity?id=…&title=…&text=…&symbol=…&progress=…&color=…&seconds=… and activity/end?id=… (Ultimate)
    static func handle(_ url: URL) {
        guard url.scheme == "notchapple" else { return }
        let parts = ([url.host ?? ""] + url.pathComponents.filter { $0 != "/" }).filter { !$0.isEmpty }
        // Links can come from any app or script, so repeated keys keep the first value instead of crashing.
        let query = Dictionary((URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [])
            .map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { first, _ in first })
        let delegate = AppDelegate.current
        switch parts.first ?? "" {
        case "open":
            let name = parts.dropFirst().first?.lowercased() ?? ""
            let tab = Module.allCases.first { $0.rawValue.lowercased() == name || $0.title.lowercased() == name }
            if let tab, tab.isTab { AppDelegate.showNotch(tab: tab) } else { delegate?.notch?.expand() }
        case "toggle": delegate?.toggleNotch()
        case "close": delegate?.notch?.closeNotch()
        case "hide": delegate?.notch?.setInvisible(true)
        case "show": delegate?.notch?.setInvisible(false)
        case "timer":
            let minutes = Double(query["minutes"] ?? "") ?? 5
            if parts.dropFirst().first == "stop" { CountdownTimer.shared.resetTimer() }
            else { CountdownTimer.shared.startTimer(seconds: minutes * 60) }
        case "stopwatch":
            parts.dropFirst().first == "stop" ? CountdownTimer.shared.pauseStopwatch() : CountdownTimer.shared.startStopwatch()
        case "focus":
            parts.dropFirst().first == "stop" ? FocusTimer.shared.pause() : FocusTimer.shared.start()
        case "keepawake":
            if parts.dropFirst().first == "off" { KeepAwake.shared.stop() }
            else { KeepAwake.shared.start(minutes: query["minutes"].flatMap(Int.init)) }
        case "snippet":
            if let name = query["name"], let s = SnippetStore.shared.items.first(where: { $0.title.caseInsensitiveCompare(name) == .orderedSame }) {
                PasteHelper.paste(s.text)
            }
        case "activate":
            // notchapple://activate?key=NTCH-…: fills in Settings → License; the user presses Unlock.
            if let key = query["key"], LicenseKey.looksLikeKey(key) {
                Entitlements.shared.pendingKey = key
                AppDelegate.openSettingsWindow(tab: .license)
            }
        case "activity":
            // Live Activities API (Ultimate): notchapple://activity?id=…&text=…, notchapple://activity/end?id=…
            ExternalActivities.shared.handle(query, end: parts.dropFirst().first == "end")
        case "record": ScreenRecorder.shared.toggle()
        case "screenshot": ScreenCaptureActions.shared.takeScreenshot()
        default: delegate?.toggleNotch()
        }
    }
}

final class URLHandler: NSObject {
    static let shared = URLHandler()
    @objc func handle(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        guard let string = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue, let url = URL(string: string) else { return }
        DispatchQueue.main.async { MainActor.assumeIsolated { FeatureHub.handle(url) } }
    }
}

// MARK: - Power

/// Battery-friendly scheduling. Everything that polls asks here first: nothing polls while the
/// displays are asleep or the user is switched out, and intervals double in Low Power Mode.
@MainActor
enum Power {
    private(set) static var isIdle = false
    private static var observers: [NSObjectProtocol] = []
    /// Called whenever idle / Low Power Mode changes, so pollers can re-tune.
    static var onChange: [() -> Void] = []

    static var lowPower: Bool { ProcessInfo.processInfo.isLowPowerModeEnabled }

    /// `base` seconds, doubled in Low Power Mode.
    static func interval(_ base: TimeInterval) -> TimeInterval { lowPower ? base * 2 : base }

    /// A repeating timer on the main run loop with generous tolerance, so macOS can batch wake-ups.
    static func timer(_ base: TimeInterval, _ block: @escaping () -> Void) -> Timer {
        let t = Timer(timeInterval: interval(base), repeats: true) { _ in MainActor.assumeIsolated { if !isIdle { block() } } }
        t.tolerance = interval(base) * 0.3
        RunLoop.main.add(t, forMode: .common)
        return t
    }

    static func start() {
        guard observers.isEmpty else { return }
        let ws = NSWorkspace.shared.notificationCenter
        let set: (Bool) -> (Notification) -> Void = { idle in { _ in
            MainActor.assumeIsolated {
                guard isIdle != idle else { return }
                isIdle = idle
                onChange.forEach { $0() }
            }
        } }
        for (name, idle) in [(NSWorkspace.screensDidSleepNotification, true), (NSWorkspace.willSleepNotification, true),
                             (NSWorkspace.sessionDidResignActiveNotification, true),
                             (NSWorkspace.screensDidWakeNotification, false), (NSWorkspace.didWakeNotification, false),
                             (NSWorkspace.sessionDidBecomeActiveNotification, false)] {
            observers.append(ws.addObserver(forName: name, object: nil, queue: .main, using: set(idle)))
        }
        observers.append(NotificationCenter.default.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { onChange.forEach { $0() } }
        })
    }
}

// MARK: - Helpers

enum Notifier {
    static func post(title: String, body: String) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            let send = {
                let content = UNMutableNotificationContent()
                content.title = title
                content.body = body
                center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
            }
            if settings.authorizationStatus == .notDetermined {
                center.requestAuthorization(options: [.alert, .sound]) { ok, _ in if ok { send() } }
            } else {
                send()
            }
        }
    }
}

/// Copies text and pastes it into the app in front (the notch never takes focus from it).
@MainActor
enum PasteHelper {
    static func paste(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        AppDelegate.current?.notch?.closeNotch()
        // Without Accessibility we can't send ⌘V; the text is still on the clipboard.
        guard AXIsProcessTrusted() else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            let source = CGEventSource(stateID: .combinedSessionState)
            for down in [true, false] {
                let e = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: down)   // V
                e?.flags = .maskCommand
                e?.post(tap: .cghidEventTap)
            }
        }
    }
}

/// Play / pause / next / previous for whatever app owns the media keys (Music, Spotify, browsers…).
enum MediaControl {
    enum Key: Int32 { case playPause = 16, next = 17, previous = 18 }

    static func send(_ key: Key) {
        for down in [true, false] {
            let flags = NSEvent.ModifierFlags(rawValue: down ? 0xA00 : 0xB00)
            let data1 = Int((key.rawValue << 16) | ((down ? 0xA : 0xB) << 8))
            let event = NSEvent.otherEvent(with: .systemDefined, location: .zero, modifierFlags: flags, timestamp: 0,
                                           windowNumber: 0, context: nil, subtype: 8, data1: data1, data2: -1)
            event?.cgEvent?.post(tap: .cghidEventTap)
        }
    }
}
