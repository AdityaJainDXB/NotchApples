//
//  AppContext.swift
//  Notch Apple
//
//  "Suggest a tab for the app you're in": when the notch opens over a meeting app, an editor, Music and so on, a small chip offers the
//  tab that helps there. It never switches tabs by itself, it goes away by itself after a few seconds, and each kind of app can be turned
//  off in Settings → Notch. It only looks at which app is in front (its name), never at what is in it. The kinds are in AppContextLogic.swift.
//

import AppKit
import SwiftUI

@MainActor
final class AppContext: ObservableObject {
    static let shared = AppContext()
    typealias L = AppContextLogic

    @AppStorage("suggest.enabled") var enabled = true
    private static let disabledKey = "suggest.disabled"

    var disabled: Set<String> { Set(UserDefaults.standard.stringArray(forKey: Self.disabledKey) ?? []) }

    func isOn(_ id: String) -> Bool { !disabled.contains(id) }

    func setOn(_ id: String, _ on: Bool) {
        objectWillChange.send()
        var d = disabled
        if on { d.remove(id) } else { d.insert(id) }
        UserDefaults.standard.set(Array(d).sorted(), forKey: Self.disabledKey)
    }

    struct Suggestion: Equatable {
        let appName: String
        let offer: String
        let tab: Module
    }

    /// The suggestion for the app in front now, if it fits a kind of app that is on and its tab is on the bar. The notch is a
    /// non-activating panel, so the app in front is still the one you were working in.
    func suggestion(availableTabs: [Module], current: Module) -> Suggestion? {
        guard enabled, let app = NSWorkspace.shared.frontmostApplication,
              app.bundleIdentifier != Bundle.main.bundleIdentifier,
              let category = L.category(forBundleID: app.bundleIdentifier, disabled: disabled),
              let raw = L.suggestedTab(for: category, available: availableTabs.map(\.rawValue)),
              let tab = Module(rawValue: raw), tab != current else { return nil }
        return Suggestion(appName: app.localizedName ?? "This app", offer: category.offer, tab: tab)
    }
}

/// The small chip over the bottom of the open notch.
struct AppSuggestionChip: View {
    let suggestion: AppContext.Suggestion
    let open: () -> Void
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: open) {
                Label("\(suggestion.appName): \(suggestion.offer)", systemImage: suggestion.tab.symbol)
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
            }
            .buttonStyle(.plain)
            Button(action: dismiss) { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)) }
                .buttonStyle(.plain).foregroundStyle(Theme.textSecondary).hitTarget()
                .accessibilityLabel("Dismiss suggestion")
        }
        .padding(.leading, 12).padding(.trailing, 4).frame(height: 30)
        .background(Capsule().fill(Theme.accent.opacity(0.85)))
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.2), lineWidth: 1))
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

/// Settings → Notch → Suggestions by app.
struct AppContextSettings: View {
    @ObservedObject private var context = AppContext.shared

    var body: some View {
        Section {
            Toggle(isOn: $context.enabled) {
                Text("Suggest a tab for the app I'm in")
                Text("When the notch opens over a meeting, an editor, Music and so on, a chip offers the tab that helps there. It only reads which app is in front.")
            }
            ForEach(AppContextLogic.categories) { category in
                Toggle(isOn: Binding(get: { context.isOn(category.id) }, set: { context.setOn(category.id, $0) })) {
                    Text(category.name)
                    Text(category.offer)
                }
                .disabled(!context.enabled)
            }
        } header: {
            Text("Suggestions by app")
        }
    }
}
