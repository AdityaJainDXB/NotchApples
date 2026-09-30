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
            { settings.meetingAlert ? MeetingWatcher.shared.liveActivity : nil },
            { settings.timerEnabled ? CountdownTimer.shared.liveActivity : nil },
            { settings.downloadProgress ? DownloadWatcher.shared.liveActivity : nil },
            { settings.devicesEnabled && settings.privacyIndicator ? PrivacyMonitor.shared.liveActivity : nil },
            { settings.liveEnabled ? ScoresModel.shared.liveActivity : nil },
            { settings.toolsEnabled && settings.keepAwakeActivity ? KeepAwake.shared.liveActivity : nil },
        ]
        DownloadWatcher.shared.setEnabled(settings.downloadProgress)
        registerURLScheme()
        let t = Timer(timeInterval: 30, repeats: true) { _ in MainActor.assumeIsolated { beat() } }
        RunLoop.main.add(t, forMode: .common)
        heartbeat = t
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { beat() }
    }

    /// Cheap periodic checks; anything slow runs off the main thread inside each feature.
    private static func beat() {
        let s = SettingsManager.shared
        if s.meetingAlert && s.todayEnabled { MeetingWatcher.shared.check() }
        if s.rainAlert && s.todayEnabled { RainWatcher.shared.checkIfDue() }
        if s.devicesEnabled {
            PrivacyMonitor.shared.setRunning(s.privacyIndicator)
            if s.accessoryBatteryAlert { DeviceBatteryModel.shared.refreshIfDue(every: 600) }
        } else {
            PrivacyMonitor.shared.setRunning(false)
        }
        NotificationMirror.shared.setRunning(s.alertsEnabled)
        if s.liveEnabled { ScoresModel.shared.refreshIfDue() }
        DownloadWatcher.shared.setEnabled(s.downloadProgress)
        LiveActivityCenter.shared.recompute()
    }

    // MARK: notchapple:// URL scheme

    private static func registerURLScheme() {
        NSAppleEventManager.shared().setEventHandler(URLHandler.shared, andSelector: #selector(URLHandler.handle(_:reply:)),
                                                     forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
    }

    /// notchapple://open/<tab>, toggle, close, hide, show, timer?minutes=5, stopwatch, focus/start, focus/stop,
    /// keepawake?minutes=30, keepawake/off, snippet?name=…, record, screenshot
    static func handle(_ url: URL) {
        guard url.scheme == "notchapple" else { return }
        let parts = ([url.host ?? ""] + url.pathComponents.filter { $0 != "/" }).filter { !$0.isEmpty }
        let query = Dictionary(uniqueKeysWithValues: (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [])
            .map { ($0.name, $0.value ?? "") })
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
