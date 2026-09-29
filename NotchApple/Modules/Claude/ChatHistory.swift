//
//  ChatHistory.swift
//  Notch apple
//
//  Saves every AI conversation so you can look back at it in
//  Settings → AI History: which provider and model answered, what you asked,
//  and the full back-and-forth.
//
//  Stored as JSON in Application Support on this Mac. Screenshots themselves
//  are not saved (only a note that one was attached), for privacy and size.
//

import Foundation
import SwiftUI

struct ChatSession: Identifiable, Codable, Equatable {
    struct Message: Codable, Equatable {
        var role: String            // "user" / "assistant"
        var text: String
        var hadScreenshot: Bool
        var date: Date
        var model: String?          // the model that wrote this reply
    }

    var id = UUID()
    var provider: String            // AIProvider.rawValue
    var model: String
    var started = Date()
    var updated = Date()
    var messages: [Message] = []

    var firstQuestion: String {
        messages.first { $0.role == "user" }?.text.trimmingCharacters(in: .whitespacesAndNewlines) ?? "Untitled chat"
    }

    var providerTitle: String { AIProvider(rawValue: provider)?.title ?? provider }

    /// Every distinct model used in this chat (you can switch mid-conversation).
    var modelsUsed: [String] {
        var seen: [String] = []
        for m in messages.compactMap(\.model) where !seen.contains(m) { seen.append(m) }
        return seen.isEmpty ? [model] : seen
    }
}

@MainActor
final class ChatHistoryStore: ObservableObject {
    static let shared = ChatHistoryStore()

    @AppStorage("ai.saveHistory") var isEnabled = true
    @Published private(set) var sessions: [ChatSession] = []

    private let url: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Notch apple", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("ai-history.json")
    }()

    init() {
        if DemoMode.isOn { sessions = DemoMode.chats; return }
        if let data = try? Data(contentsOf: url),
           let saved = try? JSONDecoder().decode([ChatSession].self, from: data) {
            sessions = saved.sorted { $0.updated > $1.updated }
        }
    }

    /// Adds a message to a session, creating the session on its first message.
    func record(sessionID: UUID, provider: AIProvider, model: String, role: String, text: String, hadScreenshot: Bool) {
        guard isEnabled else { return }
        let message = ChatSession.Message(role: role, text: text, hadScreenshot: hadScreenshot, date: .now,
                                          model: role == "assistant" ? model : nil)
        if let i = sessions.firstIndex(where: { $0.id == sessionID }) {
            sessions[i].messages.append(message)
            sessions[i].updated = .now
            sessions[i].model = model
            let session = sessions.remove(at: i)
            sessions.insert(session, at: 0)
        } else {
            sessions.insert(ChatSession(id: sessionID, provider: provider.rawValue, model: model, messages: [message]), at: 0)
        }
        save()
    }

    func delete(_ id: UUID) {
        sessions.removeAll { $0.id == id }
        save()
    }

    func deleteAll() {
        sessions.removeAll()
        save()
    }

    /// Plain-text transcript for copying or exporting.
    func transcript(_ s: ChatSession) -> String {
        var out = "\(s.firstQuestion)\n\(s.providerTitle) · \(s.modelsUsed.joined(separator: ", ")) · \(s.started.formatted(date: .abbreviated, time: .shortened))\n\n"
        for m in s.messages {
            out += (m.role == "user" ? "You" : "AI\(m.model.map { " (\($0))" } ?? "")") + (m.hadScreenshot ? " [screenshot attached]" : "") + ":\n"
            out += m.text + "\n\n"
        }
        return out
    }

    private func save() {
        guard !DemoMode.isOn, let data = try? JSONEncoder().encode(sessions) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
