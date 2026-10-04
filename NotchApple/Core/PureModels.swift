//
//  PureModels.swift
//  Notch apple
//
//  Plain data and parsing used by profiles, app rules and the plugin SDK,
//  kept free of UI so the tests can check them.
//

import Foundation

struct Profile: Codable, Identifiable, Equatable {
    var id = UUID()
    var name: String
    var hiddenTabs: Set<String> = []
    var theme: String? = nil
    /// Bundle IDs that switch to this profile when in front.
    var apps: [String] = []
    /// Minutes since midnight; both nil = no time rule.
    var from: Int? = nil
    var to: Int? = nil
    var days: Set<Int> = Set(1...7)

    func matchesTime(_ now: Date = .now) -> Bool {
        guard let from, let to else { return false }
        let cal = Calendar.current
        guard days.contains(cal.component(.weekday, from: now)) else { return false }
        let m = cal.component(.hour, from: now) * 60 + cal.component(.minute, from: now)
        return from <= to ? (m >= from && m < to) : (m >= from || m < to)   // overnight ranges
    }
}

struct AppRule: Codable, Identifiable, Equatable {
    enum Action: String, Codable, CaseIterable { case hideNotch, openTab
        var title: String { self == .hideNotch ? "Hide the notch" : "Use a tab" }
    }
    var id = UUID()
    var bundleID: String
    var appName: String
    var action: Action = .hideNotch
    var tab: String? = nil
}

enum PluginSDK {
    /// `text=42% symbol="hammer.fill"` → ["text": "42%", "symbol": "hammer.fill"]
    static func keyValues(_ s: String) -> [String: String] {
        var out: [String: String] = [:]
        let re = try? NSRegularExpression(pattern: #"(\w+)=(?:"([^"]*)"|(\S+))"#)
        for m in re?.matches(in: s, range: NSRange(s.startIndex..., in: s)) ?? [] {
            guard let k = Range(m.range(at: 1), in: s) else { continue }
            let v = Range(m.range(at: 2), in: s) ?? Range(m.range(at: 3), in: s)
            out[String(s[k])] = v.map { String(s[$0]) } ?? ""
        }
        return out
    }

}
