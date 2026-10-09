//
//  ModelPicker.swift
//  Notch apple
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
        let all = config.availableModels[config.provider] ?? []
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
