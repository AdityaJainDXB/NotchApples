//
//  PremiumRegistry.swift
//  Notch apple
//
//  The Ultimate modules (Convert, Smart Home, Claude usage, Do It and the Purge launcher) are not in the public source:
//  they live in a private repository and are built into the official releases only. This is how the public code finds
//  them. If they were built in, the private code registers itself here when the app starts (PremiumEntry.install); if
//  not (a build from the public source), the slots stay empty and each tab shows a note saying so instead.
//

import AppKit
import SwiftUI

@MainActor
enum PremiumRegistry {
    /// The screen for each Ultimate tab, filled in by the private code.
    static var views: [Module: () -> AnyView] = [:]
    static var convertAdd: (([URL]) -> Void)?
    static var smartHomeConfigured: (() -> Bool)?
    static var claudePace: (() -> AnyView)?
    static var claudeStart: (() -> Void)?

    /// True in an official build.
    static var included: Bool { !views.isEmpty }

    /// Looks for the private code by name and lets it register. Safe to call more than once.
    static func load() {
        guard !included, let entry = NSClassFromString("NotchPremiumEntry") as? NSObject.Type else { return }
        entry.perform(NSSelectorFromString("install"))
    }
}

/// An Ultimate tab: the real screen in an official build, a short note in a build from the public source.
struct PremiumSlot: View {
    let module: Module
    var body: some View {
        if let make = PremiumRegistry.views[module] { make() } else { PremiumMissingView(title: module.title, symbol: module.symbol) }
    }
}

struct PremiumMissingView: View {
    let title: String
    let symbol: String
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol).font(.system(size: 30)).foregroundStyle(Theme.accent)
            Text("\(title) is in the official Ultimate build").font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
            Text("This copy of Notch apple was built from the public source code, which doesn't include the Ultimate modules. Get the official app from the website.")
                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center).frame(maxWidth: 420)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
