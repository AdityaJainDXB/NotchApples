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

    /// Each tab once, in its first place. A tab saved twice showed up twice in the notch (2.0.6 fix).
    static func unique(_ order: [String]) -> [String] {
        var seen = Set<String>()
        return order.filter { seen.insert($0).inserted }
    }

    /// The full tab order after the visible tabs were rearranged into `shownOrder`. Only the slots of tabs that are
    /// shown take the new order; features that are on but live on Home or in Non-Necessities keep their places.
    /// (Filling every switched-on slot made the queue run out early and wrote some tabs, often Non-Necessities, twice.)
    static func applyTabOrder(full: [String], isShown: (String) -> Bool, shownOrder: [String]) -> [String] {
        var queue = shownOrder
        let merged = full.map { isShown($0) && !queue.isEmpty ? queue.removeFirst() : $0 }
        return unique(merged + queue)
    }

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

    // MARK: Widget sizes on Home (edited in the notch)

    enum WidgetSize: String, CaseIterable, Identifiable {
        case small, medium, large
        var id: String { rawValue }
        var title: String { rawValue.capitalized }
        /// Card height in points.
        var height: Double { self == .small ? 104 : self == .medium ? 150 : 250 }
        /// Large cards take the whole row; small and medium share it two to a row.
        var fullWidth: Bool { self == .large }
    }

    /// Size a widget has until the person changes it (the To-Do list has always been full width).
    static func defaultSize(_ module: String) -> WidgetSize {
        switch module {
        case "todo": return .large
        case "clipboard", "nowPlaying", "notes", "alerts": return .medium
        default: return .small
        }
    }

    /// Rows for the Home page. Closed rows (accordions) and large cards sit alone; the rest pair up in order.
    static func packRows(_ items: [(name: String, size: WidgetSize, closed: Bool)]) -> [[String]] {
        var rows: [[String]] = []
        var pending: String?
        func flush() { if let p = pending { rows.append([p]); pending = nil } }
        for item in items {
            if item.closed || item.size.fullWidth { flush(); rows.append([item.name]); continue }
            if let p = pending { rows.append([p, item.name]); pending = nil } else { pending = item.name }
        }
        flush()
        return rows
    }
}
