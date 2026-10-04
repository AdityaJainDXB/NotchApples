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

// MARK: - Versions (update flow)

enum VersionMath {
    /// The dotted number inside a tag: "v1.14.3" and "1.14.3" both give "1.14.3"; "win-v2.0" gives "2.0".
    static func number(from tag: String) -> String? {
        guard let range = tag.range(of: "[0-9]+(\\.[0-9]+)*", options: .regularExpression) else { return nil }
        return String(tag[range])
    }

    /// Compares dotted versions numerically ("1.10.0" > "1.9.2").
    static func isNewer(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }, y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let l = i < x.count ? x[i] : 0, r = i < y.count ? y[i] : 0
            if l != r { return l > r }
        }
        return false
    }

    /// Whether a release should be offered: newer than what's installed, not skipped,
    /// and a pre-release only for people on the beta channel.
    static func shouldOffer(version: String, installed: String, skipped: String?, prerelease: Bool, beta: Bool) -> Bool {
        if prerelease && !beta { return false }
        guard isNewer(version, than: installed) else { return false }
        return version != skipped
    }
}

// MARK: - Widgets

/// Every tab in the notch is a widget: one protocol, one entitlement gate, one lifecycle.
/// `WidgetLifecycle` decides which widget is live; widgets start their work in `activate()`
/// (e.g. polling prices or scores) and stop it in `deactivate()`, so a hidden tab costs nothing.
@MainActor
protocol NotchWidget: AnyObject {
    var widgetID: String { get }
    /// The paid feature this widget needs, or nil when it's free.
    var requiredFeature: Feature? { get }
    func activate()
    func deactivate()
}

@MainActor
final class WidgetLifecycle {
    private(set) var active: NotchWidget?
    private let canUse: (Feature) -> Bool

    init(canUse: @escaping (Feature) -> Bool) { self.canUse = canUse }

    /// Shows `widget` (nil when the notch closes). Returns false if it's locked, in which
    /// case nothing is activated and the upsell is shown instead.
    @discardableResult
    func show(_ widget: NotchWidget?) -> Bool {
        if let widget, widget === active { return true }
        active?.deactivate()
        active = nil
        guard let widget else { return true }
        if let f = widget.requiredFeature, !canUse(f) { return false }
        widget.activate()
        active = widget
        return true
    }
}
