//
//  ModuleLayoutLogic.swift
//  Notch apple
//
//  Where each reorganised feature lives: on the Home page (expanded, or hidden behind a click), as its own tab,
//  inside the Non-Necessities tab, or switched off. Pure rules (module names are plain strings here), so they are
//  tested without the app. ModuleLayout.swift connects them to the real modules and to UserDefaults.
//

import Foundation

enum LayoutChoice: String, CaseIterable, Identifiable {
    case homeExpanded, homeHidden, standalone, nonNecessities, disabled
    var id: String { rawValue }

    var title: String {
        switch self {
        case .homeExpanded: "On Home, open"
        case .homeHidden: "On Home, click to open"
        case .standalone: "Its own tab"
        case .nonNecessities: "Inside Non-Necessities"
        case .disabled: "Off"
        }
    }

    /// A shorter name for tight places (the tour's chooser).
    var shortTitle: String {
        switch self {
        case .homeExpanded: "Home, open"
        case .homeHidden: "Home, closed"
        case .standalone: "Own tab"
        case .nonNecessities: "Non-Necessities"
        case .disabled: "Off"
        }
    }

    var onHome: Bool { self == .homeExpanded || self == .homeHidden }
}

enum ModuleLayoutLogic {
    /// Merged into the one Non-Necessities tab by default.
    static let nonNecessities = ["focus", "worldClock", "audio", "snippets", "shortcuts", "timer", "plugins", "voiceNotes", "screenTime", "smartHome"]
    /// Shown on Home as an accordion that is closed until you click it.
    static let homeAccordions = ["clipboard", "nowPlaying", "notes"]
    /// Shown on Home as a small card that is always visible (Claude usage only when you add it).
    static let homeWidgets = ["todo", "devices", "alerts", "claudeUsage"]

    static var managed: [String] { homeAccordions + homeWidgets + nonNecessities }

    static func isManaged(_ module: String) -> Bool { managed.contains(module) }

    static func canLiveOnHome(_ module: String) -> Bool { homeAccordions.contains(module) || homeWidgets.contains(module) }

    /// The choices offered for a module, in the order shown.
    static func allowed(_ module: String) -> [LayoutChoice] {
        canLiveOnHome(module) ? [.homeExpanded, .homeHidden, .standalone, .nonNecessities, .disabled]
                              : [.standalone, .nonNecessities, .disabled]
    }

    /// Where a module goes if you never chose. `wasOn` is whether it was switched on before the reorganisation.
    static func defaultChoice(_ module: String, wasOn: Bool) -> LayoutChoice {
        if homeAccordions.contains(module) { return wasOn ? .homeExpanded : .disabled }
        if module == "claudeUsage" { return wasOn ? .homeExpanded : .disabled }
        if homeWidgets.contains(module) { return .homeExpanded }
        return wasOn ? .nonNecessities : .disabled
    }

    /// Where it goes when it is switched on without a saved choice (the old Settings toggle, a plugin…).
    static func onChoice(_ module: String) -> LayoutChoice { defaultChoice(module, wasOn: true) }

    /// The choice that applies right now. A saved choice wins while the module is on (the Home cards that are
    /// native to Home, like Devices, stay where they were put even if their own switch was never turned on).
    static func effective(_ module: String, saved: LayoutChoice?, isOn: Bool) -> LayoutChoice {
        guard isManaged(module) else { return isOn ? .standalone : .disabled }
        guard let saved else { return defaultChoice(module, wasOn: isOn) }
        if saved == .disabled { return isOn ? onChoice(module) : .disabled }   // switched back on in Settings
        guard allowed(module).contains(saved) else { return isOn ? onChoice(module) : .disabled }
        if homeWidgets.contains(module) && module != "claudeUsage" { return saved }
        return isOn ? saved : .disabled
    }

    static func showsAsTab(_ choice: LayoutChoice) -> Bool { choice == .standalone }

    /// Is the Non-Necessities tab needed at all?
    static func nonNecessitiesTabNeeded(_ choices: [String: LayoutChoice]) -> Bool {
        choices.values.contains(.nonNecessities)
    }

    // MARK: Home screen style and order

    /// Which Home page shows. Classic is the page up to 1.33 (weather, battery, up next); Widgets is the 1.34 page.
    enum HomeStyle: String, CaseIterable, Identifiable {
        case classic, widgets
        var id: String { rawValue }
        var title: String { self == .classic ? "Classic" : "Widgets" }
    }

    /// Nothing chosen means `fallback`: the widget Home, for everyone, unless they picked Classic. Widgets with nothing added to Home falls back to Classic rather than an empty page.
    static func effectiveStyle(saved: HomeStyle?, fallback: HomeStyle = .widgets, onHomeCount: Int) -> HomeStyle {
        (saved ?? fallback) == .widgets && onHomeCount > 0 ? .widgets : .classic
    }

    /// `names` in the person's saved order; anything not in the order keeps its default place after those that are.
    static func ordered(_ names: [String], by order: [String]) -> [String] {
        let rank = Dictionary(order.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        return names.enumerated().sorted { l, r in
            switch (rank[l.element], rank[r.element]) {
            case let (a?, b?): return a < b
            case (.some, nil): return true
            case (nil, .some): return false
            default: return l.offset < r.offset
            }
        }.map(\.element)
    }

    /// The new saved order after moving `name` up (-1) or down (+1) within `current` (what Home shows now).
    static func moved(_ name: String, by step: Int, in current: [String]) -> [String] {
        guard let i = current.firstIndex(of: name) else { return current }
        let j = min(max(i + step, 0), current.count - 1)
        var list = current
        list.swapAt(i, j)
        return list
    }
}
