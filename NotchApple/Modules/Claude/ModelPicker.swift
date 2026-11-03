//
//  ModelPicker.swift
//  Notch Apple
//
//  A searchable model picker for the AI tab: type to filter, arrow keys and Return to choose, and hovering a model
//  shows a preview card beside the list with what the app knows about it (provider, whether it sees images,
//  whether it runs on this Mac). Only facts the app can verify are shown; nothing is invented.
//

import SwiftUI

struct ModelPicker: View {
    @ObservedObject var config: AIConfig
    @State private var open = false
    @State private var query = ""
    @State private var hovered: String?
    @FocusState private var searchFocused: Bool

    private var models: [String] {
        let all = ModelPickerLogic.unique(config.availableModels[config.provider] ?? [])
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? all : all.filter { $0.lowercased().contains(q) }
    }

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 4) {
                Text(config.model).font(.system(size: 12)).lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 8, weight: .bold))
            }
        }
        .buttonStyle(.plain).foregroundStyle(.white)
        .help("Model")
        .accessibilityLabel("Model: \(config.model)")
        .popover(isPresented: $open, arrowEdge: .bottom) { content }
    }

    private var content: some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(spacing: 6) {
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.textSecondary)
                    TextField("Search models", text: $query).textFieldStyle(.plain)
                        .focused($searchFocused).onSubmit { if let first = models.first { choose(first) } }
                        .accessibilityLabel("Search models")
                }
                .padding(8).background(RoundedRectangle(cornerRadius: 8).fill(Theme.surface))
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        if models.isEmpty { Text(config.loadingModels ? "Loading models…" : "No models found").font(.caption).foregroundStyle(Theme.textSecondary).padding(8) }
                        ForEach(models, id: \.self) { m in row(m) }
                    }
                }
                .scrollIndicators(.visible)
                Button("Refresh model list") { config.refreshModels() }.buttonStyle(.plain).font(.caption).foregroundStyle(Theme.accentBright)
            }
            .frame(width: 250, height: 280).padding(10)
            if let h = hovered {
                Divider()
                preview(h).frame(width: 210, alignment: .topLeading).padding(12).transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: hovered)
        .onAppear { query = ""; searchFocused = true }
        .onChange(of: query) { _, _ in hovered = nil }   // the preview closes when the search changes
    }

    private func row(_ m: String) -> some View {
        Button { choose(m) } label: {
            HStack {
                Text(m).font(.system(size: 12)).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 4)
                if m == config.model { Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)) }
            }
            .padding(.horizontal, 8).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 6).fill(hovered == m ? Color.white.opacity(0.1) : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).foregroundStyle(.white)
        .onHover { inside in if inside { hovered = m } else if hovered == m { hovered = nil } }
    }

    private func preview(_ m: String) -> some View {
        let p = config.provider, sees = p.likelySupportsVision(m)
        return VStack(alignment: .leading, spacing: 8) {
            Text(m).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).fixedSize(horizontal: false, vertical: true)
            Label(p.title, systemImage: "sparkles").font(.caption).foregroundStyle(Theme.textSecondary)
            fact(sees ? "eye" : "eye.slash", sees ? "Can look at images and PDFs" : "Text only")
            if p == .ollama || p == .apple { fact("lock.fill", "Runs on this Mac: nothing leaves it", .green) }
            else if p.isFree { fact("gift", "Free tier") }
            else { fact("creditcard", "Billed to your own account") }
            if m == config.model { fact("checkmark.circle.fill", "Selected", Theme.accentBright) }
        }
    }

    private func fact(_ symbol: String, _ text: String, _ tint: Color = Theme.textSecondary) -> some View {
        Label(text, systemImage: symbol).font(.system(size: 11)).foregroundStyle(tint).fixedSize(horizontal: false, vertical: true)
    }

    private func choose(_ m: String) {
        config.setModel(m, for: config.provider)
        open = false
    }
}

/// The same searchable picker for the provider: type to filter, hover for what it is and what it costs.
struct ProviderPicker: View {
    @ObservedObject var config: AIConfig
    @State private var open = false
    @State private var query = ""
    @State private var hovered: AIProvider?
    @FocusState private var searchFocused: Bool

    private func matches(_ p: AIProvider) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty || p.title.lowercased().contains(q)
    }

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 4) {
                Label(config.provider.title, systemImage: "sparkles").font(.system(size: 12, weight: .semibold))
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 8, weight: .bold))
            }
        }
        .buttonStyle(.plain).foregroundStyle(Theme.accentBright)
        .help("AI provider").accessibilityLabel("AI provider: \(config.provider.title)")
        .popover(isPresented: $open, arrowEdge: .bottom) {
            HStack(alignment: .top, spacing: 0) {
                VStack(spacing: 6) {
                    HStack {
                        Image(systemName: "magnifyingglass").foregroundStyle(Theme.textSecondary)
                        TextField("Search providers", text: $query).textFieldStyle(.plain).focused($searchFocused)
                            .onSubmit { if let p = AIProvider.allCases.first(where: matches) { choose(p) } }
                            .accessibilityLabel("Search providers")
                    }
                    .padding(8).background(RoundedRectangle(cornerRadius: 8).fill(Theme.surface))
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 2) {
                            group("Free", AIProvider.allCases.filter { $0.isFree && matches($0) })
                            group("Paid (your own account)", AIProvider.allCases.filter { !$0.isFree && matches($0) })
                        }
                    }
                }
                .frame(width: 250, height: 300).padding(10)
                if let h = hovered {
                    Divider()
                    preview(h).frame(width: 210, alignment: .topLeading).padding(12).transition(.opacity)
                }
            }
            .animation(.easeOut(duration: 0.15), value: hovered)
            .onAppear { query = ""; searchFocused = true }
            .onChange(of: query) { _, _ in hovered = nil }
        }
    }

    @ViewBuilder private func group(_ title: String, _ items: [AIProvider]) -> some View {
        if !items.isEmpty {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(Theme.textSecondary).padding(.horizontal, 8).padding(.top, 6)
            ForEach(items) { p in
                Button { choose(p) } label: {
                    HStack {
                        Text(p.title).font(.system(size: 12)).lineLimit(1)
                        Spacer(minLength: 4)
                        if p == config.provider { Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)) }
                    }
                    .padding(.horizontal, 8).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 6).fill(hovered == p ? Color.white.opacity(0.1) : .clear))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain).foregroundStyle(.white)
                .onHover { inside in if inside { hovered = p } else if hovered == p { hovered = nil } }
            }
        }
    }

    private func preview(_ p: AIProvider) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(p.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
            if p == .ollama || p == .apple { fact("lock.fill", "Runs on this Mac: nothing leaves it", .green) }
            else if p.isFree { fact("gift", "Free tier, no billing needed") }
            else { fact("creditcard", "Billed to your own account") }
            fact(p.isConfigured ? "checkmark.circle.fill" : "key", p.isConfigured ? "Ready to use" : "Needs setup or a key", p.isConfigured ? .green : Theme.textSecondary)
            if p == config.provider { fact("checkmark", "Selected", Theme.accentBright) }
        }
    }

    private func fact(_ symbol: String, _ text: String, _ tint: Color = Theme.textSecondary) -> some View {
        Label(text, systemImage: symbol).font(.system(size: 11)).foregroundStyle(tint).fixedSize(horizontal: false, vertical: true)
    }

    private func choose(_ p: AIProvider) { config.provider = p; open = false }
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
