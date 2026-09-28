//
//  ClaudeChatView.swift
//  Notch apple
//
//  A compact chat UI inside the notch. The "Share Screen" toggle attaches a
//  fresh screenshot to the next message so Claude can see what you see.
//

import SwiftUI

@MainActor
final class ClaudeChatModel: ObservableObject {
    static let shared = ClaudeChatModel()   // survives notch open/close

    @Published var messages: [ChatMessage] = []
    @Published var draft = ""
    @Published var attachScreen = false
    @Published var isSending = false
    @Published var error: String?

    var hasKey: Bool { KeychainHelper.get(.anthropicAPIKey)?.isEmpty == false }

    func send() {
        let prompt = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty, !isSending else { return }
        draft = ""
        error = nil
        isSending = true

        Task {
            var message = ChatMessage(role: .user, text: prompt)
            if attachScreen {
                do { message.imageBase64 = try await ScreenCapture.captureBase64JPEG() }
                catch { self.error = error.localizedDescription }
                attachScreen = false
            }
            messages.append(message)
            do {
                let reply = try await ClaudeClient.send(messages, model: SettingsManager.shared.claudeModel)
                messages.append(ChatMessage(role: .assistant, text: reply))
            } catch {
                self.error = error.localizedDescription
            }
            isSending = false
        }
    }

    func clear() { messages.removeAll(); error = nil }
}

struct ClaudeChatView: View {
    @StateObject private var model = ClaudeChatModel.shared
    @State private var keyDraft = ""

    var body: some View {
        if model.hasKey { chat } else { keyPrompt }
    }

    /// First-run: ask for the user's own API key, stored in the Keychain.
    private var keyPrompt: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Bring your own Claude key", systemImage: "key.fill").font(.headline).foregroundStyle(.white)
            Text("Your key is stored in the macOS Keychain and sent only to api.anthropic.com. Get one at console.anthropic.com.")
                .font(.caption).foregroundStyle(Theme.textSecondary)
            HStack {
                SecureField("sk-ant-…", text: $keyDraft)
                    .textFieldStyle(.roundedBorder)
                Button("Save") {
                    KeychainHelper.set(keyDraft.trimmingCharacters(in: .whitespaces), for: .anthropicAPIKey)
                    keyDraft = ""
                    model.objectWillChange.send()
                }
                .buttonStyle(PurpleButtonStyle())
                .disabled(keyDraft.isEmpty)
            }
        }
        .frame(maxHeight: .infinity, alignment: .center)
    }

    private var chat: some View {
        VStack(spacing: 8) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        if model.messages.isEmpty {
                            Text("Ask Claude anything. Toggle 📺 to include your screen.")
                                .font(.callout).foregroundStyle(Theme.textSecondary)
                                .frame(maxWidth: .infinity).padding(.top, 40)
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

            if let error = model.error {
                Text(error).font(.caption).foregroundStyle(.red.opacity(0.9)).lineLimit(2)
            }

            HStack(spacing: 8) {
                Toggle(isOn: $model.attachScreen) {
                    Image(systemName: model.attachScreen ? "display.and.arrow.down" : "display")
                }
                .toggleStyle(.button)
                .help("Share Screen — attach a screenshot to your next message")

                TextField("Message Claude…", text: $model.draft)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Color.white.opacity(0.08), in: Capsule())
                    .onSubmit(model.send)

                Button(action: model.send) { Image(systemName: "arrow.up") }
                    .buttonStyle(PurpleButtonStyle())
                    .disabled(model.draft.isEmpty || model.isSending)

                Menu {
                    Button("Clear conversation", action: model.clear)
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
