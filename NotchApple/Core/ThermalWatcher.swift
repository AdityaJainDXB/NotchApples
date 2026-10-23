//
//  ThermalWatcher.swift
//  Notch Apple
//
//  "Hot: slowing down": when the Mac gets hot enough that macOS starts holding the processor back (a long export, a
//  build, a game), a small amber mark shows beside the closed notch, red when it is critical. It goes away by itself
//  when the Mac cools down. It only listens to the system's own thermal notification: no polling, no permissions.
//

import AppKit

@MainActor
final class ThermalWatcher: ObservableObject {
    static let shared = ThermalWatcher()
    static let key = "notch.heatWarning"

    @Published private(set) var state = ProcessInfo.processInfo.thermalState
    private var observer: NSObjectProtocol?

    var enabled: Bool { UserDefaults.standard.object(forKey: Self.key) as? Bool ?? true }

    func start() {
        guard observer == nil else { return }
        observer = NotificationCenter.default.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated {
                ThermalWatcher.shared.state = ProcessInfo.processInfo.thermalState
                LiveActivityCenter.shared.recompute()
            }
        }
        state = ProcessInfo.processInfo.thermalState
    }

    /// Shown only while the Mac is actually being slowed down (serious or critical), never for "fair".
    var liveActivity: LiveActivity? {
        guard enabled else { return nil }
        switch state {
        case .serious: return LiveActivity(symbol: "thermometer.high", label: "Hot", tint: .systemOrange, dotOnly: false)
        case .critical: return LiveActivity(symbol: "thermometer.high", label: "Too hot", tint: .systemRed, dotOnly: false)
        default: return nil
        }
    }
}

/// Keeps the notch's own windows out of screenshots, screen recordings and screen sharing when switched on (so a
/// notification, the clipboard or a message in the notch never shows up in a meeting or a recording).
@MainActor
enum CapturePrivacy {
    static let key = "privacy.hideNotchFromCapture"
    static var on: Bool { UserDefaults.standard.bool(forKey: key) }
    /// Applies the setting to every notch window that is open now (new ones read it when they are made).
    static func apply() {
        for w in NSApp.windows where w is NotchPanel || w.level.rawValue > NSWindow.Level.statusBar.rawValue {
            w.sharingType = on ? .none : .readOnly
        }
    }
}
