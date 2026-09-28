//
//  LiveActivity.swift
//  Notch apple
//
//  Dynamic Island-style "live activities" for the CLOSED notch. The hardware
//  notch is a camera cutout with no pixels, so activities draw in two small
//  "ears" either side of it: an icon on the left, a short label on the right.
//
//  Sources, highest priority first:
//   1. Charging — shown for a few seconds when the charger is plugged / unplugged.
//   2. Focus timer — countdown while a session is running.
//   3. Unread messages — a purple dot.
//

import AppKit
import IOKit.ps
import SwiftUI

struct LiveActivity: Equatable {
    var symbol: String?          // SF Symbol for the left ear
    var label: String?           // short text for the right ear, e.g. "24:13"
    var tint: NSColor
    var dotOnly = false          // just a small dot in the right ear
}

@MainActor
final class LiveActivityCenter: ObservableObject {
    static let shared = LiveActivityCenter()

    @Published private(set) var current: LiveActivity?
    var onChange: (LiveActivity?) -> Void = { _ in }

    private var chargingFlash: LiveActivity?
    private var flashWork: DispatchWorkItem?
    private var powerSource: CFRunLoopSource?
    private var lastPluggedIn: Bool?

    func start() {
        startPowerMonitoring()
        recompute()
    }

    /// Recalculates what the closed notch should show.
    func recompute() {
        var next: LiveActivity?
        if let flash = chargingFlash {
            next = flash
        } else if SettingsManager.shared.focusEnabled, let focus = FocusTimer.shared.liveActivity {
            next = focus
        } else if MessengerNotifier.shared.unread > 0 {
            next = LiveActivity(symbol: nil, label: nil, tint: NSColor(Theme.accentBright), dotOnly: true)
        }
        guard next != current else { return }
        current = next
        onChange(next)
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
        guard let last = lastPluggedIn, last != info.pluggedIn, SettingsManager.shared.showChargingActivity else { return }
        let symbol = info.pluggedIn ? "battery.100percent.bolt" : Self.batterySymbol(info.percent)
        let tint: NSColor = info.pluggedIn ? .systemGreen : (info.percent <= 20 ? .systemRed : .white)
        chargingFlash = LiveActivity(symbol: symbol, label: "\(info.percent)%", tint: tint)
        recompute()
        flashWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.chargingFlash = nil
            self?.recompute()
        }
        flashWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 4, execute: work)
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
