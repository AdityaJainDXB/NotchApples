//
//  ModuleLayout.swift
//  Notch apple
//
//  Connects the layout rules (ModuleLayoutLogic) to the real modules: where each reorganised feature lives
//  (Home, its own tab, Non-Necessities, off), saved in UserDefaults. Settings → Modules & Layout and the
//  after-update chooser both write through here, so there is one source of truth.
//

import SwiftUI

final class ModuleLayout: ObservableObject {
    static let shared = ModuleLayout()

    private static let prefix = "layout.v2."
    /// True once the person has been through the after-update chooser (or it was skipped on a fresh install).
    static let doneKey = prefix + "chooserDone"
    private static let migratedKey = prefix + "migrated"

    /// Bumped on every change so views that don't watch SettingsManager still refresh.
    @Published private(set) var revision = 0

    private func saved(_ m: Module) -> LayoutChoice? {
        UserDefaults.standard.string(forKey: Self.prefix + m.rawValue).flatMap(LayoutChoice.init(rawValue:))
    }

    /// Where this module lives now.
    func choice(_ m: Module) -> LayoutChoice {
        ModuleLayoutLogic.effective(m.rawValue, saved: saved(m), isOn: SettingsManager.shared.isEnabled(m))
    }

    func options(_ m: Module) -> [LayoutChoice] { ModuleLayoutLogic.allowed(m.rawValue) }

    /// Moves a module. Off switches the module off; anything else switches it on.
    func set(_ choice: LayoutChoice, for m: Module) {
        guard ModuleLayoutLogic.isManaged(m.rawValue), options(m).contains(choice) else { return }
        UserDefaults.standard.set(choice.rawValue, forKey: Self.prefix + m.rawValue)
        SettingsManager.shared.binding(for: m).wrappedValue = choice != .disabled
        notify()
    }

    private func notify() {
        revision += 1
        SettingsManager.shared.objectWillChange.send()
    }

    // MARK: Lists the screens use

    private func modules(_ names: [String], where match: (LayoutChoice) -> Bool) -> [Module] {
        names.compactMap(Module.init(rawValue:)).filter { match(choice($0)) }
    }

    /// Home accordions that are shown (open or closed), in the order set in Settings.
    var homeAccordions: [(module: Module, expanded: Bool)] {
        modules(homeOrdered(ModuleLayoutLogic.homeAccordions), where: \.onHome).map { ($0, choice($0) == .homeExpanded) }
    }

    /// Always-visible Home cards that are on, in the order set in Settings.
    var homeWidgets: [(module: Module, expanded: Bool)] {
        modules(homeOrdered(ModuleLayoutLogic.homeWidgets), where: \.onHome).map { ($0, choice($0) == .homeExpanded) }
    }

    // MARK: Home page style and order

    private static let styleKey = prefix + "homeStyle"
    private static let orderKey = prefix + "homeOrder"

    private var homeOrder: [String] { UserDefaults.standard.stringArray(forKey: Self.orderKey) ?? [] }
    private func homeOrdered(_ names: [String]) -> [String] { ModuleLayoutLogic.ordered(names, by: homeOrder) }

    /// What the person picked in Settings (nil until they do).
    var savedHomeStyle: ModuleLayoutLogic.HomeStyle? {
        UserDefaults.standard.string(forKey: Self.styleKey).flatMap(ModuleLayoutLogic.HomeStyle.init(rawValue:))
    }

    func setHomeStyle(_ style: ModuleLayoutLogic.HomeStyle) {
        UserDefaults.standard.set(style.rawValue, forKey: Self.styleKey)
        notify()
    }

    /// The Home page that shows now.
    var homeStyle: ModuleLayoutLogic.HomeStyle {
        ModuleLayoutLogic.effectiveStyle(saved: savedHomeStyle, onHomeCount: homeItems.count)
    }

    /// Everything on the widget Home, in the order it appears (the list Settings lets you rearrange).
    var homeItems: [Module] { homeOrdered((homeWidgets + homeAccordions).map(\.module.rawValue)).compactMap(Module.init(rawValue:)) }

    func moveHome(_ m: Module, by step: Int) {
        let next = ModuleLayoutLogic.moved(m.rawValue, by: step, in: homeItems.map(\.rawValue))
        UserDefaults.standard.set(next, forKey: Self.orderKey)
        notify()
    }

    /// Takes a widget off Home. It gets its own tab so nothing becomes unreachable.
    func removeFromHome(_ m: Module) { set(.standalone, for: m) }

    /// Everything shown inside the Non-Necessities tab.
    var nonNecessities: [Module] {
        let all = ModuleLayoutLogic.nonNecessities + ModuleLayoutLogic.homeAccordions + ModuleLayoutLogic.homeWidgets
        return modules(all, where: { $0 == .nonNecessities })
    }

    var hasNonNecessities: Bool { !nonNecessities.isEmpty }

    /// Does this module get its own tab? (Modules this system doesn't manage always do while they are on.)
    func showsTab(_ m: Module) -> Bool {
        if m == .nonNecessities { return hasNonNecessities }
        if m == .translator { return false }          // the Translator lives inside Tools now
        guard ModuleLayoutLogic.isManaged(m.rawValue) else { return true }
        // The Classic Home has no cards, so a feature placed on Home gets its own tab there (if it was switched on).
        if homeStyle == .classic, choice(m).onHome { return SettingsManager.shared.isEnabled(m) }
        return ModuleLayoutLogic.showsAsTab(choice(m))
    }

    /// Every module the chooser and Settings → Modules & Layout list, grouped.
    static var managedModules: [Module] { ModuleLayoutLogic.managed.compactMap(Module.init(rawValue:)) }

    // MARK: First run after the reorganisation

    /// Gives every reorganised module the place its old settings imply, once. Existing people keep what they had
    /// switched on; the chooser then lets them move things.
    func migrateIfNeeded() {
        let d = UserDefaults.standard
        guard !d.bool(forKey: Self.migratedKey) else { return }
        d.set(true, forKey: Self.migratedKey)
        let fresh = d.bool(forKey: "v2.freshInstall")
        for m in Self.managedModules where saved(m) == nil {
            let wasOn = SettingsManager.shared.isEnabled(m)
            d.set(ModuleLayoutLogic.defaultChoice(m.rawValue, wasOn: wasOn).rawValue, forKey: Self.prefix + m.rawValue)
        }
        // A brand-new install has nothing to reorganise, so the chooser is for people who are updating.
        if fresh { d.set(true, forKey: Self.doneKey) }
        notify()
    }

    var chooserDone: Bool {
        get { UserDefaults.standard.bool(forKey: Self.doneKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.doneKey); notify() }
    }
}
