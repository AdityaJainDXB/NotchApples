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

    var onHome: Bool { self == .homeExpanded || self == .homeHidden }
}

enum ModuleLayoutLogic {
    /// Merged into the one Non-Necessities tab by default.
    static let nonNecessities = ["focus", "worldClock", "audio", "snippets", "shortcuts", "timer", "plugins", "voiceNotes", "screenTime", "smartHome"]
    /// Shown on Home as an accordion that is closed until you click it.
    static let homeAccordions = ["clipboard", "nowPlaying", "notes"]
    /// Shown on Home as a small card that is always visible (Claude usage only when you add it).
    static let homeWidgets = ["devices", "alerts", "quickAdd", "claudeUsage"]

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
        if homeAccordions.contains(module) { return wasOn ? .homeHidden : .disabled }
        if module == "claudeUsage" { return wasOn ? .homeExpanded : .disabled }
        if homeWidgets.contains(module) { return .homeExpanded }
        return wasOn ? .nonNecessities : .disabled
    }

    /// Where it goes when it is switched on without a saved choice (the old Settings toggle, a plugin…).
    static func onChoice(_ module: String) -> LayoutChoice { defaultChoice(module, wasOn: true) }

    /// The choice that applies right now: the saved one, unless the module's own switch says otherwise.
    static func effective(_ module: String, saved: LayoutChoice?, isOn: Bool) -> LayoutChoice {
        guard isManaged(module) else { return isOn ? .standalone : .disabled }
        guard isOn else { return .disabled }
        guard let saved, saved != .disabled else { return onChoice(module) }
        return allowed(module).contains(saved) ? saved : onChoice(module)
    }

    static func showsAsTab(_ choice: LayoutChoice) -> Bool { choice == .standalone }

    /// Is the Non-Necessities tab needed at all?
    static func nonNecessitiesTabNeeded(_ choices: [String: LayoutChoice]) -> Bool {
        choices.values.contains(.nonNecessities)
    }
}
