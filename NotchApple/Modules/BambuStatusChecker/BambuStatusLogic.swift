//
//  BambuStatusLogic.swift
//  Notch Apple
//
//  Rules for the BambuStatusChecker module: reading a Bambu Lab printer's local MQTT
//  reports, mapping gcode_state onto the notch colours, and merging the partial
//  JSON the printer sends. No screens and no network here, so it can be tested.
//

import CryptoKit
import Foundation

enum BambuPhase: String, Equatable {
    case printing, paused, idle, offline

    var title: String {
        switch self {
        case .printing: "Printing"
        case .paused: "Paused"
        case .idle: "Idle"
        case .offline: "Offline"
        }
    }

    /// Green printing, yellow paused, blue idle, gray offline.
    var hex: String {
        switch self {
        case .printing: "30D158"
        case .paused: "FFD60A"
        case .idle: "64D2FF"
        case .offline: "8E8E93"
        }
    }
}

struct BambuSnapshot: Equatable {
    var phase: BambuPhase = .offline
    var gcodeState: String = ""
    var progress: Int = 0
    var remainingMinutes: Int?
    var nozzleC: Double?
    var bedC: Double?
    /// What the heaters are aiming for (0 or nil: heater off).
    var nozzleTargetC: Double?
    var bedTargetC: Double?
    var filename: String = ""
    var error: String?

    var isActive: Bool { phase == .printing || phase == .paused }
}

enum BambuStatusLogic {
    // MARK: Certificate pinning
    // A printer's certificate is signed by the printer itself, so no authority can vouch for it. Instead the
    // first certificate it shows is remembered (trust on first use) and any different one is refused, so
    // someone on the same Wi-Fi can't pose as the printer and read the access code.

    enum PinDecision: Equatable { case pinFirst, match, mismatch }

    /// SHA-256 of the certificate's DER bytes, as lowercase hex.
    static func fingerprint(of der: Data) -> String {
        SHA256.hash(data: der).map { String(format: "%02x", $0) }.joined()
    }

    static func decidePin(stored: String?, seen: String) -> PinDecision {
        guard let stored, !stored.isEmpty else { return .pinFirst }
        return stored.lowercased() == seen.lowercased() ? .match : .mismatch
    }

    static let pinMismatchMessage = "The printer’s certificate changed, so Notch Apple refused to connect. If you updated its firmware or reset it, choose “Trust new certificate” in Settings → Bambu Lab. If not, someone on your network may be posing as it."

    /// LAN MQTT is always this port on current Bambu firmware.
    static let mqttPort: UInt16 = 8883
    static let mqttUser = "bblp"
    static let connectTimeout: TimeInterval = 8
    static let keepAlive: UInt16 = 30

    /// IP or hostname from Settings or BAMBU_IP / BAMBU_PRINTER_IP. Strips a pasted URL.
    static func normalizeHost(_ raw: String) -> String? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if let url = URL(string: s), let host = url.host, !host.isEmpty { s = host }
        else if s.lowercased().hasPrefix("http://") { s = String(s.dropFirst(7)) }
        else if s.lowercased().hasPrefix("https://") { s = String(s.dropFirst(8)) }
        if let slash = s.firstIndex(of: "/") { s = String(s[..<slash]) }
        if let colon = s.firstIndex(of: ":"), s[s.index(after: colon)...].allSatisfy(\.isNumber) {
            s = String(s[..<colon])
        }
        s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty, !s.contains(" "), s.count <= 253 else { return nil }
        return s
    }

    /// Serial as the printer shows it: uppercase, no spaces.
    static func normalizeSerial(_ raw: String) -> String? {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: " ", with: "").uppercased()
        guard s.count >= 8, s.count <= 32, s.allSatisfy({ $0.isLetter || $0.isNumber }) else { return nil }
        return s
    }

    static func reportTopic(serial: String) -> String { "device/\(serial)/report" }

    static func credentials(ip: String, accessCode: String, serial: String) -> (host: String, code: String, serial: String)? {
        guard let host = normalizeHost(ip), let serial = normalizeSerial(serial) else { return nil }
        let code = accessCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else { return nil }
        return (host, code, serial)
    }

    /// Env vars win only when the matching Settings field is empty.
    static func resolved(ip: String, accessCode: String, serial: String, env: [String: String] = ProcessInfo.processInfo.environment) -> (ip: String, accessCode: String, serial: String) {
        func pick(_ stored: String, _ keys: [String]) -> String {
            let t = stored.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { return t }
            for k in keys {
                if let v = env[k]?.trimmingCharacters(in: .whitespacesAndNewlines), !v.isEmpty { return v }
            }
            return t
        }
        return (pick(ip, ["BAMBU_IP", "BAMBU_PRINTER_IP"]),
                pick(accessCode, ["BAMBU_ACCESS_CODE"]),
                pick(serial, ["BAMBU_SERIAL"]))
    }

    static func phase(gcodeState: String, connected: Bool) -> BambuPhase {
        guard connected else { return .offline }
        switch gcodeState.uppercased() {
        case "RUNNING", "PREPARE", "SLICING", "PRINTING": return .printing
        case "PAUSE", "PAUSED": return .paused
        default: return .idle
        }
    }

    static func displayName(_ path: String) -> String {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        return URL(fileURLWithPath: trimmed).lastPathComponent
    }

    static func remainingLabel(_ minutes: Int?) -> String? {
        guard let minutes, minutes >= 0 else { return nil }
        if minutes < 1 { return "<1m left" }
        if minutes < 60 { return "\(minutes)m left" }
        let h = minutes / 60, m = minutes % 60
        return m == 0 ? "\(h)h left" : "\(h)h \(m)m left"
    }

    static func temperatureLabel(_ value: Double?) -> String {
        guard let value else { return "—" }
        return "\(Int(value.rounded()))°"
    }

    static func liveLabel(_ snap: BambuSnapshot) -> String {
        switch snap.phase {
        case .printing: return snap.progress > 0 ? "\(snap.progress)%" : "Print"
        case .paused: return "Paused"
        case .idle: return "Idle"
        case .offline: return "Off"
        }
    }

    // MARK: Print events and thermal alerts

    /// Something worth a sound, a haptic tap and a glance at the notch.
    enum PrintEvent: Equatable { case paused, finished, failed }

    static func event(from old: BambuSnapshot?, to new: BambuSnapshot) -> PrintEvent? {
        guard let old, old.phase != .offline, new.phase != .offline else { return nil }
        if old.phase == .printing, new.phase == .paused { return .paused }
        let was = old.gcodeState.uppercased(), now = new.gcodeState.uppercased()
        if now == "FAILED", was != "FAILED" { return .failed }
        if now == "FINISH", was != "FINISH", old.isActive { return .finished }
        return nil
    }

    enum ThermalAlert: Equatable {
        case nozzleHot(Int), bedHot(Int), nozzleOvershoot(Int), bedOvershoot(Int), heatCreep(Int)

        var message: String {
            switch self {
            case .nozzleHot(let t): "Nozzle is at \(t)°, above the safe limit."
            case .bedHot(let t): "Bed is at \(t)°, above the safe limit."
            case .nozzleOvershoot(let t): "Nozzle is \(t)° over its target."
            case .bedOvershoot(let t): "Bed is \(t)° over its target."
            case .heatCreep(let t): "Nozzle is still climbing (\(t)°) with the heater off. Check the hotend fan and cooling."
            }
        }
    }

    /// Absolute limits (Bambu nozzles top out near 300°, beds near 110°) and how far over its target a heater may drift.
    static let maxNozzleC = 300.0
    static let maxBedC = 110.0
    static let overshootC = 15.0
    /// Heat creep: heat travelling up past the heat break softens filament above the nozzle. The telltale in the
    /// reports is a hotend that is above 60° with its heater off and *rising* between two reports.
    static let creepFloorC = 60.0
    static let creepRiseC = 1.0

    static func thermalAlert(previous: BambuSnapshot?, current: BambuSnapshot) -> ThermalAlert? {
        guard current.phase != .offline else { return nil }
        if let n = current.nozzleC, n > maxNozzleC { return .nozzleHot(Int(n.rounded())) }
        if let b = current.bedC, b > maxBedC { return .bedHot(Int(b.rounded())) }
        if let n = current.nozzleC, let t = current.nozzleTargetC, t > 0, n > t + overshootC { return .nozzleOvershoot(Int((n - t).rounded())) }
        if let b = current.bedC, let t = current.bedTargetC, t > 0, b > t + overshootC { return .bedOvershoot(Int((b - t).rounded())) }
        if current.phase == .idle, let n = current.nozzleC, n > creepFloorC, (current.nozzleTargetC ?? 0) == 0,
           let before = previous?.nozzleC, n >= before + creepRiseC { return .heatCreep(Int(n.rounded())) }
        return nil
    }

    /// Bambu reports are often deltas: keep the previous snapshot and overlay `print`.
    static func apply(_ data: Data, onto current: BambuSnapshot, connected: Bool) -> BambuSnapshot {
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return current }
        return apply(root, onto: current, connected: connected)
    }

    static func apply(_ root: [String: Any], onto current: BambuSnapshot, connected: Bool) -> BambuSnapshot {
        var next = current
        next.error = nil
        guard let print = root["print"] as? [String: Any] else {
            next.phase = phase(gcodeState: next.gcodeState, connected: connected)
            return next
        }
        if let state = string(print["gcode_state"]), !state.isEmpty { next.gcodeState = state }
        if let p = int(print["mc_percent"]) { next.progress = min(max(p, 0), 100) }
        if let m = int(print["mc_remaining_time"]) { next.remainingMinutes = max(m, 0) }
        if let n = double(print["nozzle_temper"]) { next.nozzleC = n }
        if let b = double(print["bed_temper"]) { next.bedC = b }
        if let t = double(print["nozzle_target_temper"]) { next.nozzleTargetC = t }
        if let t = double(print["bed_target_temper"]) { next.bedTargetC = t }
        let name = string(print["subtask_name"]).flatMap { $0.isEmpty ? nil : $0 }
            ?? string(print["gcode_file"])
        if let name, !name.isEmpty { next.filename = displayName(name) }
        next.phase = phase(gcodeState: next.gcodeState, connected: connected)
        return next
    }

    static func offline(message: String?) -> BambuSnapshot {
        var s = BambuSnapshot()
        s.phase = .offline
        s.error = message
        return s
    }

    private static func string(_ any: Any?) -> String? {
        if let s = any as? String { return s }
        if let n = any as? NSNumber { return n.stringValue }
        return nil
    }

    private static func int(_ any: Any?) -> Int? {
        if let n = any as? NSNumber { return n.intValue }
        if let s = any as? String { return Int(s) }
        return nil
    }

    private static func double(_ any: Any?) -> Double? {
        if let n = any as? NSNumber { return n.doubleValue }
        if let s = any as? String { return Double(s) }
        return nil
    }
}
