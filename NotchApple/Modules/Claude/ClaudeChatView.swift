//
//  ClaudeChatView.swift
//  Notch apple
//
//  A compact chat UI inside the notch. The "Share Screen" toggle attaches a
//  fresh screenshot to the next message so Claude can see what you see.
//

import SwiftUI
import AppKit

/// Which AI provider and model the AI tab uses. Persisted; one model per provider.
@MainActor
final class AIConfig: ObservableObject {
    static let shared = AIConfig()

    @AppStorage("ai.provider") private var providerRaw = ""
    @AppStorage("ai.models") private var modelsJSON = "{}"
    @Published private(set) var availableModels: [AIProvider: [String]] = [:]
    @Published private(set) var loadingModels = false
    @Published private(set) var modelError: String?

    var provider: AIProvider {
        get {
            if let p = AIProvider(rawValue: providerRaw) { return p }
            // Existing Claude users keep Claude; everyone else starts on free Gemini.
            return AIProvider.claude.apiKey != nil ? .claude : .gemini
        }
        set { objectWillChange.send(); providerRaw = newValue.rawValue; refreshModels() }
    }

    private var chosen: [String: String] {
        get { (try? JSONDecoder().decode([String: String].self, from: Data(modelsJSON.utf8))) ?? [:] }
        set { modelsJSON = String(decoding: (try? JSONEncoder().encode(newValue)) ?? Data("{}".utf8), as: UTF8.self) }
    }

    func model(for p: AIProvider) -> String {
        if let m = chosen[p.rawValue], !m.isEmpty { return m }
        if p == .claude, let legacy = UserDefaults.standard.string(forKey: "claude.model") { return legacy }
        return availableModels[p]?.first ?? p.fallbackModel
    }

    var model: String { model(for: provider) }

    func setModel(_ m: String, for p: AIProvider) {
        objectWillChange.send()
        var c = chosen; c[p.rawValue] = m; chosen = c
    }

    func refreshModels() {
        let p = provider
        guard p.isConfigured else { return }
        loadingModels = true
        modelError = nil
        Task {
            do { availableModels[p] = try await AIClient.models(for: p) }
            catch { modelError = error.localizedDescription }
            loadingModels = false
        }
    }
}

@MainActor
final class ClaudeChatModel: ObservableObject {
    static let shared = ClaudeChatModel()   // survives notch open/close

    @Published var messages: [ChatMessage] = []
    @Published var draft = ""
    @Published var attachScreen = false
    @Published var isSending = false
    @Published var error: String?
    /// Shown under the chat when a screenshot was attached automatically.
    @Published var notice: String?
    /// The saved-history session this conversation belongs to.
    private(set) var sessionID = UUID()

    /// Share the screen automatically when a question is about it (Settings → AI).
    @AppStorage("ai.autoScreen") var autoScreen = true

    func send() {
        let prompt = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty, !isSending else { return }
        draft = ""
        send(prompt)
    }

    /// Sends `prompt`, attaching a screenshot if asked to or if the question is about the screen.
    func send(_ prompt: String, forceScreen: Bool = false) {
        guard !isSending else { return }
        error = nil
        notice = nil
        isSending = true
        let config = AIConfig.shared

        // "What's on my screen?" → take a screenshot automatically.
        if !attachScreen && (forceScreen || (autoScreen && ScreenIntent.matches(prompt))) {
            if config.provider.likelySupportsVision(config.model) {
                attachScreen = true
                notice = "Took a screenshot to answer that (Notch apple itself is left out)."
            } else {
                notice = "\(config.model) can't see images, so no screenshot was sent. Switch to Gemini or a vision model to ask about your screen."
            }
        }

        Task {
            var message = ChatMessage(role: .user, text: prompt)
            if attachScreen {
                do { message.imageBase64 = try await ScreenCapture.captureBase64JPEG() }
                catch { self.error = error.localizedDescription }
                attachScreen = false
            }
            messages.append(message)
            let provider = config.provider, modelID = config.model
            let history = ChatHistoryStore.shared
            history.record(sessionID: sessionID, provider: provider, model: modelID, role: "user",
                           text: prompt, hadScreenshot: message.imageBase64 != nil)
            do {
                let reply = try await AIClient.send(messages, provider: provider, model: modelID)
                messages.append(ChatMessage(role: .assistant, text: reply))
                history.record(sessionID: sessionID, provider: provider, model: modelID, role: "assistant",
                               text: reply, hadScreenshot: false)
            } catch {
                self.error = error.localizedDescription
            }
            isSending = false
        }
    }

    /// Starts a new conversation (the old one stays in Settings → AI History).
    func clear() { messages.removeAll(); error = nil; notice = nil; sessionID = UUID() }

    /// Reopens a saved conversation in the notch so you can keep going.
    func resume(_ session: ChatSession) {
        sessionID = session.id
        messages = session.messages.map { ChatMessage(role: $0.role == "user" ? .user : .assistant, text: $0.text) }
        error = nil
        notice = session.messages.contains(where: \.hadScreenshot) ? "Screenshots from this chat weren't saved, so the AI can't see them again." : nil
        if let p = AIProvider(rawValue: session.provider) {
            AIConfig.shared.provider = p
            AIConfig.shared.setModel(session.model, for: p)
        }
    }

    // MARK: Quick actions

    struct QuickAction: Identifiable {
        let id = UUID()
        let title: String
        let symbol: String
        let run: @MainActor (ClaudeChatModel) -> Void
    }

    static var quickActions: [QuickAction] {
        [
            QuickAction(title: "What's on my screen?", symbol: "eye") {
                $0.send("What's on my screen? Describe it briefly and point out anything useful.", forceScreen: true)
            },
            QuickAction(title: "Summarise what I copied", symbol: "text.append") { $0.sendAboutClipboard("Summarise this in a few bullet points") },
            QuickAction(title: "Translate what I copied", symbol: "character.bubble") { $0.sendAboutClipboard("Translate this into English (or, if it's already English, into Spanish)") },
            QuickAction(title: "Fix grammar of what I copied", symbol: "checkmark.bubble") { $0.sendAboutClipboard("Fix the grammar and spelling. Reply with only the corrected text") },
        ]
    }

    private func sendAboutClipboard(_ instruction: String) {
        guard let text = NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else {
            error = "Copy some text first, then try again."
            return
        }
        send("\(instruction):\n\n\(String(text.prefix(12_000)))")
    }
}

struct ClaudeChatView: View {
    @StateObject private var model = ClaudeChatModel.shared
    @StateObject private var config = AIConfig.shared
    @State private var keyDraft = ""

    var body: some View {
        VStack(spacing: 8) {
            providerBar
            if config.provider.isConfigured { chat } else { keyPrompt }
        }
        .onAppear { if config.availableModels[config.provider] == nil { config.refreshModels() } }
    }

    /// Switch provider and model without leaving the notch.
    private var providerBar: some View {
        HStack(spacing: 8) {
            Menu {
                Section("Free") {
                    ForEach(AIProvider.allCases.filter(\.isFree)) { p in
                        Button { config.provider = p } label: { Label(p.title, systemImage: p == config.provider ? "checkmark" : "") }
                    }
                }
                Section("Paid (your own account)") {
                    ForEach(AIProvider.allCases.filter { !$0.isFree }) { p in
                        Button { config.provider = p } label: { Label(p.title, systemImage: p == config.provider ? "checkmark" : "") }
                    }
                }
            } label: {
                Label(config.provider.title, systemImage: "sparkles").font(.system(size: 12, weight: .semibold))
            }
            .menuStyle(.borderlessButton).fixedSize()

            if config.provider.isConfigured {
                Menu {
                    let models = config.availableModels[config.provider] ?? []
                    if models.isEmpty { Text(config.loadingModels ? "Loading models…" : "No models found") }
                    ForEach(models, id: \.self) { m in
                        Button { config.setModel(m, for: config.provider) } label: {
                            Label(m, systemImage: m == config.model ? "checkmark" : "")
                        }
                    }
                    Divider()
                    Button("Refresh model list") { config.refreshModels() }
                } label: {
                    Text(config.model).font(.system(size: 12)).lineLimit(1)
                }
                .menuStyle(.borderlessButton).fixedSize()
            }
            Spacer()
            Text(config.provider.costNote).font(.system(size: 11))
                .foregroundStyle(config.provider.isFree ? Color.green.opacity(0.9) : Theme.textSecondary)
        }
    }

    /// First run for a provider: explain where to get a free key and save it to the Keychain.
    private var keyPrompt: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Add your \(config.provider.title) key", systemImage: "key.fill").font(.headline).foregroundStyle(.white)
            Text("\(config.provider.costNote). Your key is stored in the macOS Keychain and sent only to \(config.provider.title).")
                .font(.caption).foregroundStyle(Theme.textSecondary)
            HStack {
                SecureField(config.provider.keyPlaceholder, text: $keyDraft)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(saveKey)
                Button("Save", action: saveKey)
                    .buttonStyle(PurpleButtonStyle())
                    .disabled(keyDraft.isEmpty)
            }
            Link(config.provider.isFree ? "Get a free key →" : "Get a key →", destination: config.provider.keyURL)
                .font(.caption.bold())
        }
        .frame(maxHeight: .infinity, alignment: .center)
    }

    private func saveKey() {
        let key = keyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return }
        KeychainHelper.set(key, for: config.provider.keychainKey)
        keyDraft = ""
        config.objectWillChange.send()
        config.refreshModels()
    }

    private var chat: some View {
        VStack(spacing: 8) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        if model.messages.isEmpty {
                            VStack(spacing: 12) {
                                Text("Ask anything, or ask about what's on your screen and a screenshot is added for you.")
                                    .font(.callout).foregroundStyle(Theme.textSecondary)
                                    .multilineTextAlignment(.center)
                                // One-click actions that combine AI with your screen and clipboard.
                                HStack(spacing: 8) {
                                    ForEach(ClaudeChatModel.quickActions) { action in
                                        Button { action.run(model) } label: {
                                            Label(action.title, systemImage: action.symbol).font(.system(size: 12, weight: .medium))
                                        }
                                        .buttonStyle(PurpleButtonStyle(prominent: false))
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity).padding(.top, 20)
                        }
                        ForEach(model.messages) { Bubble(message: $0).id($0.id) }
                        if model.isSending {
                            ProgressView().controlSize(.small).padding(.leading, 6).id("typing")
                        }
                    }
                }
                .onChange(of: model.messages.count) { _, _ in
                    withAnimation { proxy.scrollTo(model.messages.last?.id, anchor: .bottom) }
                }
            }

            if let notice = model.notice {
                Label(notice, systemImage: "camera.viewfinder").font(.caption).foregroundStyle(Theme.textSecondary).lineLimit(2)
            }
            if let error = model.error ?? config.modelError {
                Text(error).font(.caption).foregroundStyle(.red.opacity(0.9)).lineLimit(2)
            }

            HStack(spacing: 8) {
                Toggle(isOn: $model.attachScreen) {
                    Image(systemName: model.attachScreen ? "display.and.arrow.down" : "display")
                }
                .toggleStyle(.button)
                .help("Share Screen: attach a screenshot to your next message (needs a model that can see images)")

                TextField("Message \(config.provider == .claude ? "Claude" : "AI")…", text: $model.draft)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Color.white.opacity(0.08), in: Capsule())
                    .onSubmit(model.send)

                Button(action: model.send) { Image(systemName: "arrow.up") }
                    .buttonStyle(PurpleButtonStyle())
                    .disabled(model.draft.isEmpty || model.isSending)

                Menu {
                    Button("New chat", action: model.clear)
                    Button("Chat history…") { AppDelegate.openSettingsWindow(tab: .aiHistory) }
                } label: { Image(systemName: "ellipsis") }
                .menuStyle(.borderlessButton).fixedSize()
            }
        }
    }
}

private struct Bubble: View {
    let message: ChatMessage
    var isUser: Bool { message.role == .user }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 60) }
            VStack(alignment: .leading, spacing: 4) {
                if message.imageBase64 != nil {
                    Label("Screenshot attached", systemImage: "photo").font(.caption2).foregroundStyle(Theme.textSecondary)
                }
                Text(LocalizedStringKey(message.text))
                    .textSelection(.enabled)
                    .font(.system(size: 13))
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(isUser ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Color.white.opacity(0.08)))
            )
            if !isUser { Spacer(minLength: 60) }
        }
    }
}
