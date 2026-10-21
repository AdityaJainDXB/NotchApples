//
//  ClosedLidAwake.swift
//  Notch Apple
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
    /// When it will switch itself off (nil: no limit). Kept across launches; the switch-off itself runs as a background job.
    @Published private(set) var offAt: Date? = UserDefaults.standard.object(forKey: "lid.offAt") as? Date

    private var watch: Timer?
    /// Set when the low-battery prompt was cancelled, so it is not asked again until the switch is flipped.
    private var declinedAutoOff = false

    /// Only reads the state: refreshing from here would call back into the notch while this object is still being
    /// created, which crashed the app at launch in 2.0.17 and 2.0.18.
    init() { isOn = Self.parseSleepDisabled(Self.run("/usr/bin/pmset", ["-g"])); updateWatch() }

    /// Reads the real setting from the system.
    func refresh() {
        isOn = Self.parseSleepDisabled(Self.run("/usr/bin/pmset", ["-g"]))
        if !isOn || (offAt ?? .distantFuture) < Date() { setOffAt(nil) }
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

    private func setOffAt(_ d: Date?) {
        offAt = d
        if let d { UserDefaults.standard.set(d, forKey: "lid.offAt") } else { UserDefaults.standard.removeObject(forKey: "lid.offAt") }
    }

    /// `seconds` > 0 makes it switch itself off after that long (0 = no limit).
    func set(_ on: Bool, seconds: Int = 0) {
        guard !busy, on != isOn else { return }
        if on, let b = LiveActivityCenter.battery(), b.percent < Self.lowBatteryPercent {
            message = "Battery is under \(Self.lowBatteryPercent)%. Plug in first."
            return
        }
        busy = true
        declinedAutoOff = false
        message = on ? batteryWarning : nil
        DispatchQueue.global(qos: .userInitiated).async {
            let error = Self.pmset(on, seconds: on ? seconds : 0)
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    self.busy = false
                    if error == nil { self.setOffAt(on && seconds > 0 ? Date().addingTimeInterval(Double(seconds)) : nil) }
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
    nonisolated private static func pmset(_ on: Bool, seconds: Int = 0, allowPrompt: Bool = true) -> String? {
        // Only a person flipping the switch ever sees the password prompt.
        guard allowPrompt else { return "Needs your password. Flip the switch to retry." }
        var error: NSDictionary?
        // One password prompt does both: the change, and (with a time limit) a background job that switches it off again
        // later, even if this app has quit. A new change first stops the old job so it cannot cut a later session short.
        let pid = "/var/db/notchapple-lid.pid"
        var cmd = "[ -f \(pid) ] && kill $(cat \(pid)) 2>/dev/null; rm -f \(pid); pmset -a disablesleep \(on ? 1 : 0)"
        if on, seconds > 0 { cmd += "; (sleep \(seconds); pmset -a disablesleep 0; rm -f \(pid)) >/dev/null 2>&1 & echo $! > \(pid)" }
        let script = NSAppleScript(source: "do shell script \"\(cmd)\" with administrator privileges")
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
