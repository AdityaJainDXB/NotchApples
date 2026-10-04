//
//  WidgetCenter.swift
//  Notch apple
//
//  Connects the notch's tabs to the NotchWidget protocol (PureModels.swift):
//  each Module is a widget with one entitlement gate and a lifecycle, so a tab
//  only does live work (polling scores, prices, timing, plugins) while it's on
//  screen. The controller calls `update` whenever the tab or open state changes.
//

import Foundation

@MainActor
final class ModuleWidget: NotchWidget {
    let module: Module
    private let onActivate: () -> Void
    private let onDeactivate: () -> Void

    init(_ module: Module, activate: @escaping () -> Void = {}, deactivate: @escaping () -> Void = {}) {
        self.module = module
        onActivate = activate
        onDeactivate = deactivate
    }

    var widgetID: String { module.rawValue }
    var requiredFeature: Feature? { module.feature }
    func activate() { onActivate() }
    func deactivate() { onDeactivate() }
}

@MainActor
final class NotchWidgetCenter {
    static let shared = NotchWidgetCenter()
    let lifecycle = WidgetLifecycle { Entitlements.shared.canUse($0) }
    private var widgets: [Module: ModuleWidget] = [:]

    /// The widget for a tab; live work starts and stops with it.
    func widget(for module: Module) -> ModuleWidget {
        if let w = widgets[module] { return w }
        let w: ModuleWidget
        switch module {
        case .sports: w = ModuleWidget(module, activate: { SportsModel.shared.viewing = true }, deactivate: { SportsModel.shared.viewing = false })
        case .markets: w = ModuleWidget(module, activate: { MarketsModel.shared.viewing = true }, deactivate: { MarketsModel.shared.viewing = false })
        case .f1: w = ModuleWidget(module, activate: { F1Model.shared.viewing = true }, deactivate: { F1Model.shared.viewing = false })
        case .plugins: w = ModuleWidget(module, activate: { PluginHost.shared.start() },
                                        deactivate: { if !PluginHost.shared.keepRunning { PluginHost.shared.stop() } })
        default: w = ModuleWidget(module)
        }
        widgets[module] = w
        return w
    }

    /// Called when the open tab changes or the notch opens/closes.
    func update(selected: Module, open: Bool) {
        lifecycle.show(open ? widget(for: selected) : nil)
    }
}
