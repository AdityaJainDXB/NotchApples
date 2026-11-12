//
//  TabChoicesLogic.swift
//  Notch Apple
//
//  The one-time "What should stay on screen?" choice after an update. Each top-level tab has an owner-set label:
//  Recommended (starts on), Not recommended (starts off), or Not many people use it (keeps whatever it is now, listed last).
//  A tab with no label is not in the list at all and is never touched. Pure rules (module names are plain strings), unit tested.
//

import Foundation

enum TabPick: String, CaseIterable, Identifiable {
    case recommended, notRecommended, fewUse
    var id: String { rawValue }
    var title: String {
        switch self {
        case .recommended: "Recommended"
        case .notRecommended: "Not recommended"
        case .fewUse: "Not many people use it"
        }
    }
    var detail: String {
        switch self {
        case .recommended: "Switched on to start with"
        case .notRecommended: "Switched off to start with"
        case .fewUse: "Left as it is on your Mac now"
        }
    }
}

enum TabChoicesLogic {
    /// The labels the owner chose (12 November 2026). Anything not listed has no label and is not offered.
    static let labels: [String: TabPick] = {
        var d: [String: TabPick] = [:]
        for m in ["today", "tools", "mirror", "claude", "messenger", "search", "browser", "translator", "klick", "wallpaper", "doIt", "games", "sports", "quickAdd", "home", "utilities", "nonNecessities", "notchAI"] { d[m] = .recommended }
        for m in ["share", "live"] { d[m] = .notRecommended }
        for m in ["windows", "f1", "tennis", "radar", "markets", "security", "devTools", "wellbeing", "bambu"] { d[m] = .fewUse }
        return d
    }()

    /// Tabs whose switch is not the person's to flip here: Utilities is always there, and Non-Necessities shows whenever something lives inside it.
    static let alwaysOn: Set<String> = ["nonNecessities", "utilities"]

    /// What a row starts as. A feature the person's plan does not include is left as it is (turning on a locked tab would only show an upgrade card).
    static func startsOn(pick: TabPick, currentlyOn: Bool, entitled: Bool) -> Bool {
        switch pick {
        case .recommended: return entitled ? true : currentlyOn
        case .notRecommended: return false
        case .fewUse: return currentlyOn
        }
    }

    /// The rows to show, in the given module order, grouped in the order Recommended, Not recommended, Not many people use it.
    /// `available` is every module the app has; unlabelled ones are dropped.
    static func groups(available: [String]) -> [(pick: TabPick, modules: [String])] {
        TabPick.allCases.compactMap { pick in
            let rows = available.filter { labels[$0] == pick }
            return rows.isEmpty ? nil : (pick, rows)
        }
    }

    /// Only the switches that actually change, so nothing else is written.
    static func changes(selection: [String: Bool], current: [String: Bool]) -> [String: Bool] {
        selection.filter { id, on in !alwaysOn.contains(id) && labels[id] != nil && current[id] != on }
    }

    /// The summary line under the list: how many things will be switched on and off.
    static func summary(selection: [String: Bool], current: [String: Bool]) -> String {
        let c = changes(selection: selection, current: current)
        let on = c.values.filter { $0 }.count, off = c.count - on
        if c.isEmpty { return "Nothing will change." }
        return [on > 0 ? "\(on) will be switched on" : nil, off > 0 ? "\(off) will be switched off" : nil].compactMap { $0 }.joined(separator: ", ") + "."
    }
}
