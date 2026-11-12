//
//  NotchAIConversation.swift
//  Notch Apple
//
//  One conversation shared by Quick Ask (the dot's panel) and the NotchAI tab, so a chat started from the dot
//  continues in the full interface. Streaming, Stop, Regenerate and New live here, not in the views.
//
//  Every request goes through NotchAIGuard first (Local first), so nothing is sent to a cloud or unverified model
//  unless the user allowed it. The dot shows "thinking" while an answer streams. Finished replies are saved to the
//  existing AI History (ChatHistoryStore) and follow its switch, retention and delete controls.
//
//  The pure rules (what Regenerate re-asks, trimming a long chat) are in NotchAIConversationLogic.
//

import Foundation

@MainActor
final class NotchAIConversation: ObservableObject {
    static let shared = NotchAIConversation()

    @Published private(set) var messages: [ChatMessage] = []
    @Published private(set) var busy = false
    @Published private(set) var failure: String?
    /// Bumped on every change to the streaming text, so a view can scroll to the end.
    @Published private(set) var tick = 0

    private var sessionID = UUID()
    private var task: Task<Void, Never>?
    /// False from the moment a question is asked until its first reply is saved, so a failed attempt that is later
    /// regenerated still saves the question once.
    private var questionSaved = true
    #if DEBUG
    private var selftestRegenerations = 0
    #endif

    var canRegenerate: Bool {
        !busy && NotchAIConversationLogic.regeneration(turns) != nil
    }

    private var turns: [NotchAIConversationLogic.Turn] {
        messages.map { .init(role: $0.role.rawValue, text: $0.text) }
    }

    // MARK: Actions

    /// `display` is what the bubble shows instead of a long prompt (screen context); `imageBase64` is an optional
    /// screenshot, kept on that message only.
    func send(_ text: String, display: String? = nil, imageBase64: String? = nil) {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy else { return }
        messages.append(ChatMessage(role: .user, text: q, imageBase64: imageBase64, display: display))
        questionSaved = false
        run(question: q)
    }

    /// Asks the last question again and replaces the last reply.
    func regenerate() {
        guard !busy, let plan = NotchAIConversationLogic.regeneration(turns) else { return }
        // Remove the old reply (and any failed attempt); the question stays.
        while messages.last?.role == .assistant { messages.removeLast() }
        run(question: plan.question)
    }

    func stop() {
        task?.cancel()
    }

    /// Starts a fresh conversation (the old one stays in AI History).
    func newConversation() {
        task?.cancel()
        messages = []
        failure = nil
        busy = false
        sessionID = UUID()
        questionSaved = true
        CursorCompanion.shared.setState(.idle)
    }

    // MARK: Running a request

    private func run(question: String) {
        failure = nil
        busy = true
        let config = AIConfig.shared
        var provider = config.provider, model = config.model
        #if DEBUG
        // Test hook (DEBUG only): pin the provider/model so a self-test never depends on async settings loading.
        let d = UserDefaults.standard
        if let p = d.string(forKey: "notchai.selftest.provider").flatMap(AIProvider.init(rawValue:)) { provider = p }
        if let m = d.string(forKey: "notchai.selftest.model"), !m.isEmpty { model = m }
        #endif
        // What the model sees: the chat so far (without the reply being written), trimmed to fit.
        let sent = NotchAIConversationLogic.trimmed(turns, maxCharacters: NotchAIConversationLogic.contextBudget(windowTokens: nil))
        var history = sent.map { ChatMessage(role: $0.role == "user" ? .user : .assistant, text: $0.text) }
        // A screenshot belongs to the question it was attached to, and is only sent with the latest one.
        if let image = messages.last(where: { $0.role == .user })?.imageBase64, let i = history.lastIndex(where: { $0.role == .user }) {
            history[i].imageBase64 = image
        }
        messages.append(ChatMessage(role: .assistant, text: ""))
        let session = sessionID
        CursorCompanion.shared.setState(.thinking)

        task = Task { [weak self] in
            var reply = ""
            var error: Error?
            do {
                try await NotchAIGuard.check(provider: provider, model: model)
                for try await piece in AIClient.stream(history, provider: provider, model: model, system: AIClient.systemPrompt) {
                    reply += piece
                    self?.updateReply(reply)
                }
                if reply.isEmpty { error = AIError.empty }
            } catch is CancellationError {
            } catch let e {
                error = e
            }
            self?.finish(reply: reply, error: error, question: question, provider: provider, model: model, session: session)
        }
    }

    private func updateReply(_ text: String) {
        guard let i = messages.indices.last, messages[i].role == .assistant else { return }
        messages[i].text = text
        tick &+= 1
    }

    private func finish(reply: String, error: Error?, question: String, provider: AIProvider, model: String, session: UUID) {
        busy = false
        failure = error?.localizedDescription
        // A reply that never arrived leaves no empty bubble behind.
        if reply.isEmpty, messages.last?.role == .assistant { messages.removeLast() }
        CursorCompanion.shared.setState(.idle)
        NotchAIVoice.shared.conversationFinished(reply: reply.isEmpty ? nil : reply, error: error)
        guard session == sessionID, !reply.isEmpty else { return }   // not saved if the chat was reset meanwhile, or nothing came back
        let history = ChatHistoryStore.shared
        if !questionSaved {
            questionSaved = true
            history.record(sessionID: session, provider: provider, model: model, role: "user", text: question, hadScreenshot: false)
        }
        history.record(sessionID: session, provider: provider, model: model, role: "assistant", text: reply, hadScreenshot: false)
        #if DEBUG
        // Test hook (DEBUG only): `-notchai.selftest.regenerate YES` regenerates the first answer once, with no input.
        if UserDefaults.standard.bool(forKey: "notchai.selftest.regenerate"), selftestRegenerations == 0 {
            selftestRegenerations += 1
            regenerate()
        }
        #endif
    }
}
