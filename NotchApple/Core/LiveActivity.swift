//
//  LiveActivity.swift
//  Notch apple
//
//  Dynamic Island-style "live activities" for the CLOSED notch. The hardware
//  notch is a camera cutout with no pixels, so activities draw in two small
//  "ears" either side of it: an icon on the left, a short label on the right.
//
//  Sources, highest priority first:
//   0. System HUD — volume or brightness gauge for a moment after you change them.
//   1. Charging — shown for a few seconds when the charger is plugged / unplugged.
//   2. Focus timer — countdown while a session is running.
//   3. Short flashes from other features (low battery, rain, notifications…).
//   4. Ongoing activities from other features (timer, recording, downloads…),
//      registered in `providers`, checked in order.
//   5. Unread messages — a purple dot.
//

import AppKit
import IOKit.ps
import SwiftUI

struct LiveActivity: Equatable {
    var symbol: String?          // SF Symbol for the left ear
    var label: String?           // short text for the right ear, e.g. "24:13"
    var tint: NSColor
    var dotOnly = false          // just a small dot in the right ear
    var gauge: Double? = nil     // 0...1: draws a volume/brightness bar in the right ear (system HUD)
    var artwork: NSImage? = nil  // album cover in the left ear (music)
    var musicBars = false        // animated equaliser bars in the right ear (music)
    var leftText: String? = nil  // a word after the icon in the left ear, e.g. "Charging"
    var rightSymbol: String? = nil  // a second activity's icon in the right ear (Ultimate stacking)
    var rightTint: NSColor? = nil
    var pulse = false            // a soft breathing glow behind the left icon (meeting about to start)

    /// Icon and short text only (no gauge, bars, artwork or dot), so two can share the ears.
    var isSimple: Bool { gauge == nil && !musicBars && !dotOnly && artwork == nil && rightSymbol == nil }
}

@MainActor
final class LiveActivityCenter: ObservableObject {
    static let shared = LiveActivityCenter()

    @Published private(set) var current: LiveActivity?
    /// True while any app or the system is recording the screen (see ScreenRecordingDetector).
    @Published private(set) var isScreenRecording = false
    var onChange: (LiveActivity?) -> Void = { _ in }
    var onRecordingChange: (Bool) -> Void = { _ in }
    /// Set by the notch controller: HUDs only appear while the notch is closed and not hidden.
    var canShowHUD: () -> Bool = { true }

    private var hudFlash: LiveActivity?
    private var hudWork: DispatchWorkItem?
    private var chargingFlash: LiveActivity?
    private var flashWork: DispatchWorkItem?
    private var powerSource: CFRunLoopSource?
    private var lastPluggedIn: Bool?
    private var lastLowBatteryAlert = 101
    private var extraFlash: LiveActivity?
    private var extraWork: DispatchWorkItem?
    /// Ongoing activities from other features, highest priority first (see FeatureHub).
    var providers: [() -> LiveActivity?] = []

    func start() {
        startPowerMonitoring()
        recompute()
    }

    /// Ultimate: the two most important activities share the notch, one per ear
    /// (e.g. a timer on the left and a live score on the right).
    static func stacked(_ a: LiveActivity, _ b: LiveActivity?) -> LiveActivity {
        guard let b, a.isSimple, b.isSimple, UserDefaults.standard.object(forKey: "notch.stackActivities") as? Bool ?? true,
              MainActor.assumeIsolated({ Entitlements.shared.canUse(.activityStacking) }) else { return a }
        return LiveActivity(symbol: a.symbol, label: b.label, tint: a.tint, leftText: a.label ?? a.leftText,
                            rightSymbol: b.symbol ?? "circle.fill", rightTint: b.tint, pulse: a.pulse)
    }

    /// Recalculates what the closed notch should show.
    func recompute() {
        var next: LiveActivity?
        if let hud = hudFlash {
            next = hud
        } else if let flash = chargingFlash {
            next = flash
        } else if let flash = extraFlash {
            next = flash
        } else {
            let focus = SettingsManager.shared.focusEnabled ? FocusTimer.shared.liveActivity : nil
            let ongoing = [focus].compactMap { $0 } + providers.compactMap { $0() }
            if let first = ongoing.first { next = Self.stacked(first, ongoing.dropFirst().first) }
        }
        if next == nil, MessengerNotifier.shared.unread > 0 {
            next = LiveActivity(symbol: nil, label: nil, tint: NSColor(Theme.accentBright), dotOnly: true)
        }
        guard next != current else { return }
        current = next
        onChange(next)
    }

    // MARK: System HUD (volume / brightness) and recording

    /// Briefly expands the closed notch with a gauge, like the Dynamic Island's volume HUD.
    func showHUD(symbol: String, value: Double) {
        guard SettingsManager.shared.showSystemHUD, canShowHUD() else { return }
        hudFlash = LiveActivity(symbol: symbol, label: nil, tint: NSColor(Theme.accentBright), gauge: min(max(value, 0), 1))
        recompute()
        hudWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.hudFlash = nil
            self?.recompute()
        }
        hudWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.8, execute: work)
    }

    /// Shows an activity beside the closed notch for a few seconds (alerts, new notifications…).
    func flash(_ activity: LiveActivity, seconds: Double = 4) {
        // A Focus is on: stay quiet (Settings → Notch → Focus).
        if FocusBridge.hushes { return }
        extraFlash = activity
        recompute()
        extraWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.extraFlash = nil
            self?.recompute()
        }
        extraWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    func setScreenRecording(_ on: Bool) {
        guard on != isScreenRecording else { return }
        isScreenRecording = on
        onRecordingChange(on)
    }

    // MARK: Charging

    private func startPowerMonitoring() {
        guard powerSource == nil else { return }
        let context = Unmanaged.passUnretained(self).toOpaque()
        guard let source = IOPSNotificationCreateRunLoopSource({ context in
            guard let context else { return }
            let center = Unmanaged<LiveActivityCenter>.fromOpaque(context).takeUnretainedValue()
            MainActor.assumeIsolated { center.powerChanged() }
        }, context)?.takeRetainedValue() else { return }
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .defaultMode)
        powerSource = source
        lastPluggedIn = Self.battery()?.pluggedIn
    }

    private func powerChanged() {
        guard let info = Self.battery() else { return }
        defer { lastPluggedIn = info.pluggedIn }
        checkLowBattery(info)
        guard let last = lastPluggedIn, last != info.pluggedIn, SettingsManager.shared.showChargingActivity else { return }
        showChargingFlash(pluggedIn: info.pluggedIn)
    }

    /// "Charging" (or "On battery") beside the notch, with the level and, once macOS has worked it out,
    /// the time until full. macOS needs a few seconds to estimate, so the label updates while it shows.
    private func showChargingFlash(pluggedIn: Bool) {
        flashWork?.cancel()
        chargeTicker?.invalidate()
        let started = Date()
        let update = { [weak self] in
            guard let self, let info = Self.battery() else { return }
            if pluggedIn {
                let full = info.percent >= 100 || (!info.charging && info.percent >= 95)
                var right = "\(info.percent)%"
                if full { right = "Full" }
                else if let m = Self.minutesToFull(), m > 0 { right += " · " + (m >= 60 ? "\(m / 60)h \(m % 60)m" : "\(m)m") + " to full" }
                self.chargingFlash = LiveActivity(symbol: "battery.100percent.bolt", label: right, tint: .systemGreen,
                                                  leftText: full ? "Charged" : (info.charging ? "Charging" : "Plugged in"))
            } else {
                var right = "\(info.percent)%"
                if let m = Self.minutesLeft(), m > 0 { right += " · " + (m >= 60 ? "\(m / 60)h \(m % 60)m" : "\(m)m") + " left" }
                self.chargingFlash = LiveActivity(symbol: Self.batterySymbol(info.percent), label: right,
                                                  tint: info.percent <= 20 ? .systemRed : .white, leftText: "On battery")
            }
            self.recompute()
        }
        update()
        // Re-check every second so the time appears as soon as macOS has an estimate.
        let t = Timer(timeInterval: 1, repeats: true) { [weak self] timer in
            MainActor.assumeIsolated {
                update()
                if Date.now.timeIntervalSince(started) > 7 { timer.invalidate(); self?.chargeTicker = nil }
            }
        }
        RunLoop.main.add(t, forMode: .common)
        chargeTicker = t
        let work = DispatchWorkItem { [weak self] in
            self?.chargeTicker?.invalidate()
            self?.chargeTicker = nil
            self?.chargingFlash = nil
            self?.recompute()
        }
        flashWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 7, execute: work)
    }

    private var chargeTicker: Timer?

    /// macOS's estimate in minutes, or nil while it's still calculating.
    static func minutesToFull() -> Int? { powerValue(kIOPSTimeToFullChargeKey) }
    static func minutesLeft() -> Int? { powerValue(kIOPSTimeToEmptyKey) }

    private static func powerValue(_ key: String) -> Int? {
        guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let list = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef] else { return nil }
        for ps in list {
            guard let d = IOPSGetPowerSourceDescription(blob, ps)?.takeUnretainedValue() as? [String: Any],
                  (d[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType, let v = d[key] as? Int, v > 0 else { continue }
            return v
        }
        return nil
    }

    /// Warns once at 20% and again at 10% while on battery.
    private func checkLowBattery(_ info: (percent: Int, pluggedIn: Bool, charging: Bool)) {
        if info.pluggedIn { lastLowBatteryAlert = 101; return }
        guard UserDefaults.standard.object(forKey: "extras.lowBatteryAlert") as? Bool ?? true else { return }
        for level in [10, 20] where info.percent <= level && lastLowBatteryAlert > level {
            lastLowBatteryAlert = level
            flash(LiveActivity(symbol: level == 10 ? "battery.0percent" : "battery.25percent", label: "\(info.percent)%",
                               tint: level == 10 ? .systemRed : .systemOrange), seconds: 6)
            Notifier.post(title: "Battery at \(info.percent)%", body: level == 10 ? "Plug in your Mac soon." : "Consider plugging in your Mac.")
            NSSound(named: "Funk")?.play()
            break
        }
    }

    /// Current battery level and power state, or nil on Macs without a battery.
    static func battery() -> (percent: Int, pluggedIn: Bool, charging: Bool)? {
        guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let list = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef] else { return nil }
        for ps in list {
            guard let d = IOPSGetPowerSourceDescription(blob, ps)?.takeUnretainedValue() as? [String: Any],
                  (d[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType,
                  let current = d[kIOPSCurrentCapacityKey] as? Int, let max = d[kIOPSMaxCapacityKey] as? Int, max > 0
            else { continue }
            let state = d[kIOPSPowerSourceStateKey] as? String
            return (Int((Double(current) / Double(max) * 100).rounded()), state == kIOPSACPowerValue,
                    (d[kIOPSIsChargingKey] as? Bool) ?? false)
        }
        return nil
    }

    static func batterySymbol(_ percent: Int) -> String {
        switch percent {
        case ..<13: "battery.0percent"
        case ..<38: "battery.25percent"
        case ..<63: "battery.50percent"
        case ..<88: "battery.75percent"
        default: "battery.100percent"
        }
    }
}
