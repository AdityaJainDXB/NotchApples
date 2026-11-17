//
//  NotchAIConversationView.swift
//  Notch Apple
//
//  The chat UI shared by Quick Ask and the NotchAI tab: messages (answers rendered with the app's RichTextView, so
//  Markdown, code blocks with a Copy button and tables work), the error line, and one row of controls: input,
//  Send / Stop, Regenerate and New. Both places bind to NotchAIConversation.shared, so they show the same chat.
//

import SwiftUI

struct NotchAIConversationView: View {
    /// Quick Ask: smaller type and a shorter empty state.
    var compact = false
    @ObservedObject private var convo = NotchAIConversation.shared
    @ObservedObject private var config = AIConfig.shared
    @ObservedObject private var humanizer = HumanizerService.shared
    /// The first wording of a reply that was humanized, so Show original can put it back.
    @State private var originals: [UUID: String] = [:]
    @State private var humanizeError: String?
    @State private var input = ""
    @FocusState private var focused: Bool

    private var fontSize: CGFloat { compact ? 12 : 13 }

    var body: some View {
        VStack(spacing: 8) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        if convo.messages.isEmpty { emptyState }
                        ForEach(convo.messages) { m in bubble(m).id(m.id) }
                        if let failure = convo.failure {
                            Label(failure, systemImage: "exclamationmark.triangle.fill")
                                .font(.system(size: 11)).foregroundStyle(.red)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        Color.clear.frame(height: 1).id("end")
                    }
                }
                .onChange(of: convo.tick) { _ in proxy.scrollTo("end", anchor: .bottom) }
                .onChange(of: convo.messages.count) { _ in proxy.scrollTo("end", anchor: .bottom) }
            }
            HStack(spacing: 6) {
                TextField("Ask NotchAI…", text: $input)
                    .textFieldStyle(.roundedBorder).focused($focused).onSubmit(send)
                    .disabled(!config.provider.isConfigured)
                Button(convo.busy ? "Stop" : "Send") { convo.busy ? convo.stop() : send() }
                    .disabled(!convo.busy && input.trimmingCharacters(in: .whitespaces).isEmpty)
                Button { convo.regenerate() } label: { Image(systemName: "arrow.clockwise") }
                    .help("Regenerate the last answer").disabled(!convo.canRegenerate)
                Button { convo.newConversation() } label: { Image(systemName: "square.and.pencil") }
                    .help("New conversation (the old one stays in AI History)").disabled(convo.messages.isEmpty && convo.failure == nil)
            }
        }
        .onAppear {
            focused = true
            #if DEBUG
            // Test hook (DEBUG only): `-notchai.selftest "question"` asks it once, with no keystrokes.
            if let q = UserDefaults.standard.string(forKey: "notchai.selftest"), !q.isEmpty, convo.messages.isEmpty { convo.send(q) }
            #endif
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        let local = ModelLocality.of(provider: config.provider, model: config.model).label.lowercased()
        VStack(alignment: .leading, spacing: 6) {
            if NotchAIGuard.refusesProvider(config.provider) {
                // Local first is on and the chosen provider is a cloud service: say so now, not after a failed send.
                Label("Local first is on, so NotchAI won't use \(config.provider.title) (a cloud service). Nothing is sent.",
                      systemImage: "lock.shield.fill")
                    .font(.system(size: 11)).foregroundStyle(.orange)
                Button("Use Ollama on this Mac") { config.provider = .ollama }.controlSize(.small)
                Text("Or allow cloud models in Settings → AI.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            } else {
                NotchAIReadyView(providerTitle: config.provider.title, model: config.model,
                                 locality: ModelLocality.of(provider: config.provider, model: config.model),
                                 configured: config.provider.isConfigured) { convo.send($0) }
                if config.provider.isConfigured {
                    Text("Text only: nothing on your screen is sent. Uses \(config.provider.title) (\(local)).")
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func bubble(_ m: ChatMessage) -> some View {
        if m.role == .user {
            Text(m.display ?? m.text).font(.system(size: fontSize)).foregroundStyle(.white).textSelection(.enabled)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .background(NotchAIView.green.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
        } else if m.text.isEmpty {
            Text("…").font(.system(size: fontSize)).foregroundStyle(Theme.textSecondary).padding(8)
        } else {
            VStack(alignment: .leading, spacing: 4) {
                RichTextView(markdown: m.text, fontSize: fontSize).textSelection(.enabled)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                if !(convo.busy && m.id == convo.messages.last?.id) { humanizeRow(m) }
            }
        }
    }

    /// The Humanize button under a finished reply: rewrites it so it reads like a person wrote it (the Humanizer, with its word limits).
    @ViewBuilder
    private func humanizeRow(_ m: ChatMessage) -> some View {
        HStack(spacing: 8) {
            if let original = originals[m.id] {
                Button { convo.replaceText(id: m.id, with: original); originals[m.id] = nil } label: { Label("Show original", systemImage: "arrow.uturn.backward") }
                    .help("Put the first wording back")
            } else {
                Button { humanize(m) } label: { Label(humanizer.busy ? "Humanizing…" : "Humanize", systemImage: "person.wave.2") }
                    .help("Rewrite this so it reads like a person wrote it. \(humanizer.summary).")
                    .disabled(humanizer.busy)
            }
            if let humanizeError, humanizer.busy == false { Text(humanizeError).font(.system(size: 10)).foregroundStyle(.orange).lineLimit(2) }
        }
        .buttonStyle(MetalPlainStyle())
        .font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.textSecondary)
        .padding(.leading, 4)
    }

    private func humanize(_ m: ChatMessage) {
        humanizeError = nil
        Task {
            do {
                let out = try await HumanizerService.shared.humanize(m.text)
                originals[m.id] = m.text
                convo.replaceText(id: m.id, with: out.text)
            } catch { humanizeError = error.localizedDescription }
        }
    }

    private func send() {
        let q = input
        input = ""
        convo.send(q)
    }
}
