//
//  ClosedLidAwake.swift
//  Notch apple
//
//  "Keep Awake (Lid Closed)": `pmset -a disablesleep 1` keeps the Mac running with the lid shut and no external
//  display. It needs administrator rights, so each change asks for them through the standard macOS prompt.
//  The real state is read back from `pmset -g` at launch so the toggle never drifts, it is switched off again when
//  the app quits, and it turns itself off below 15% battery.
//

import AppKit

@MainActor
final class ClosedLidAwake: ObservableObject {
    static let shared = ClosedLidAwake()
    static let lowBatteryPercent = 15

    @Published private(set) var isOn = false
    @Published private(set) var busy = false
    @Published var message: String?

    private var watch: Timer?
    /// Set when the low-battery prompt was cancelled, so it is not asked again until the switch is flipped.
    private var declinedAutoOff = false

    init() { refresh() }

    /// Reads the real setting from the system.
    func refresh() {
        isOn = Self.parseSleepDisabled(Self.run("/usr/bin/pmset", ["-g"]))
        updateWatch()
        LiveActivityCenter.shared.recompute()
    }

    /// Matches the "SleepDisabled  1" line of `pmset -g`.
    nonisolated static func parseSleepDisabled(_ output: String) -> Bool {
        for line in output.split(separator: "\n") where line.contains("SleepDisabled") {
            return line.split(whereSeparator: { $0 == " " || $0 == "\t" }).last == "1"
        }
        return false
    }

    var batteryWarning: String? {
        guard let b = LiveActivityCenter.battery(), !b.pluggedIn else { return nil }
        return "Running with the lid closed on battery drains it fast."
    }

    func set(_ on: Bool) {
        guard !busy, on != isOn else { return }
        if on, let b = LiveActivityCenter.battery(), b.percent < Self.lowBatteryPercent {
            message = "Battery is under \(Self.lowBatteryPercent)%. Plug in first."
            return
        }
        busy = true
        declinedAutoOff = false
        message = on ? batteryWarning : nil
        DispatchQueue.global(qos: .userInitiated).async {
            let error = Self.pmset(on)
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    self.busy = false
                    if let error {
                        self.message = error
                        if !on { self.declinedAutoOff = true }
                    }
                    self.refresh()   // whatever happened, show what the system says
                }
            }
        }
    }

    /// Called as the app quits so the Mac can sleep again. Asks for authorization if macOS has forgotten it.
    func restoreOnQuit() {
        guard isOn || Self.parseSleepDisabled(Self.run("/usr/bin/pmset", ["-g"])) else { return }
        _ = Self.pmset(false)   // one prompt at most; if cancelled it stays on and shows as on next launch
    }

    private func updateWatch() {
        watch?.invalidate()
        watch = nil
        guard isOn else { return }
        watch = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in
            MainActor.assumeIsolated {
                let me = ClosedLidAwake.shared
                if let b = LiveActivityCenter.battery(), !b.pluggedIn, b.percent < ClosedLidAwake.lowBatteryPercent {
                    me.message = "Turned off: battery under \(ClosedLidAwake.lowBatteryPercent)%."
                    if !me.declinedAutoOff { me.set(false) }
                }
            }
        }
    }

    /// A small lid-and-dot beside the notch while this is on.
    var liveActivity: LiveActivity? {
        isOn ? LiveActivity(symbol: "laptopcomputer", label: "Lid", tint: .systemOrange) : nil
    }

    // MARK: System calls

    /// nil on success, otherwise a short error.
    nonisolated private static func pmset(_ on: Bool, allowPrompt: Bool = true) -> String? {
        // Only a person flipping the switch ever sees the password prompt.
        guard allowPrompt else { return "Needs your password. Flip the switch to retry." }
        var error: NSDictionary?
        let script = NSAppleScript(source: "do shell script \"pmset -a disablesleep \(on ? 1 : 0)\" with administrator privileges")
        script?.executeAndReturnError(&error)
        guard let error else { return nil }
        let code = (error[NSAppleScript.errorNumber] as? Int) ?? 0
        return code == -128 ? "Cancelled. Nothing changed. Flip the switch again to retry." : "Couldn't change it: \((error[NSAppleScript.errorMessage] as? String) ?? "unknown error")"
    }

    nonisolated private static func run(_ path: String, _ args: [String]) -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = Pipe()
        guard (try? p.run()) != nil else { return "" }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return String(decoding: data, as: UTF8.self)
    }
}
