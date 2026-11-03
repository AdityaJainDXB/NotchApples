//
//  ModelPicker.swift
//  Notch Apple
//
//  The AI tab's drop-down menus: the provider picker (before a key is set), and the provider, model and effort menus in the
//  message box. All are plain menus, with no popover, so there is nothing that can resize itself while the pointer moves.
//

import SwiftUI

/// The provider menu shown while no provider is set up yet (afterwards the same choice is in the message box). It is a plain
/// drop-down menu. The earlier searchable popover with a hover preview card resized itself as the pointer moved over the list,
/// and macOS aborted the app with a layout-loop exception (issues 43 and 44).
struct ProviderPicker: View {
    @ObservedObject var config: AIConfig

    var body: some View {
        Menu {
            ForEach(AIProvider.allCases) { p in
                Button { config.provider = p } label: {
                    if p == config.provider { Label(p.title, systemImage: "checkmark") } else { Text(p.title) }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Label(config.provider.title, systemImage: "sparkles").font(.system(size: 12, weight: .semibold))
                Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold))
            }
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .foregroundStyle(.white)
        .help("Provider")
        .accessibilityLabel("Provider: \(config.provider.title)")
    }
}

/// How hard the assistant works on an answer. Low is quick and short, High thinks it through; Medium changes nothing. It is added to
/// the instructions every provider gets, so it works the same on all of them.
enum AIEffort: String, CaseIterable, Identifiable {
    case low, medium, high
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var hint: String {
        switch self {
        case .low: " Answer quickly and keep it short; do not over-explain."
        case .medium: ""
        case .high: " Think the problem through step by step and check your work before you answer, then give a thorough answer."
        }
    }
    static var current: AIEffort { AIEffort(rawValue: UserDefaults.standard.string(forKey: "ai.effort") ?? "") ?? .medium }
}

/// The three menus under the message box: who answers (provider), which model, and the effort. Each is a plain drop-down with a tick
/// beside the choice, in the same pill style, so the box reads as one control.
struct ComposerMenus: View {
    @ObservedObject var config: AIConfig

    private var models: [String] { ModelPickerLogic.unique(config.availableModels[config.provider] ?? []) }

    var body: some View {
        HStack(spacing: 2) {
            // Provider
            Menu {
                ForEach(AIProvider.allCases) { p in
                    Button { config.provider = p } label: { check(p == config.provider, p.title) }
                }
            } label: { pill(config.provider.title, symbol: "sparkles") }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            .help("Provider").accessibilityLabel("Provider: \(config.provider.title)")

            // Model, grouped under the provider's name
            Menu {
                Section(config.provider.title) {
                    if models.isEmpty { Text(config.loadingModels ? "Loading models…" : "No models found") }
                    ForEach(models, id: \.self) { m in
                        Button { config.setModel(m, for: config.provider) } label: { check(m == config.model, m) }
                    }
                }
                Divider()
                Button("Refresh model list") { config.refreshModels() }
            } label: { pill(config.model, maxWidth: 150) }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            .help("Model").accessibilityLabel("Model: \(config.model)")

            // Effort
            Menu {
                Section("Effort") {
                    ForEach(AIEffort.allCases) { e in
                        Button { config.effort = e } label: { check(e == config.effort, e.title) }
                    }
                }
            } label: { pill(config.effort.title, symbol: "brain") }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            .help("How hard it thinks: Low is quick and short, High thinks it through").accessibilityLabel("Effort: \(config.effort.title)")
        }
    }

    @ViewBuilder private func check(_ on: Bool, _ text: String) -> some View {
        if on { Label(text, systemImage: "checkmark") } else { Text(text) }
    }

    private func pill(_ text: String, symbol: String? = nil, maxWidth: CGFloat = 110) -> some View {
        HStack(spacing: 3) {
            if let symbol { Image(systemName: symbol).font(.system(size: 9)) }
            Text(text).lineLimit(1).truncationMode(.middle).frame(maxWidth: maxWidth)
            Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold))
        }
        .font(.system(size: 11, weight: .medium)).foregroundStyle(Color.white.opacity(0.85))
        .padding(.horizontal, 7).padding(.vertical, 4)
        .background(Capsule().fill(Color.white.opacity(0.06)))
    }
}
