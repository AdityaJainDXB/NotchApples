//
//  ChatHistory.swift
//  Notch apple
//
//  Saves every AI conversation so you can look back at it in
//  Settings → AI History: which provider and model answered, what you asked,
//  and the full back-and-forth.
//
//  Stored as JSON in Application Support on this Mac, never uploaded. The
//  captured image is kept next to it (ai-images/, at most 1600 px) so a task
//  can be reopened and continued; turn that off in Settings → AI History, or
//  turn history off entirely. Old chats are removed after the retention period.
//

import AppKit
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
    var mode: String?               // AIMode.rawValue for capture tasks
    var inputKind: String?          // CapturedInput.Kind.rawValue, or "text"
    var inputSource: String?        // e.g. "Region 640 × 412 · Built-in Display"
    var hasImage: Bool?             // an image file is saved for this chat

    var modeTitle: String? { mode.flatMap(AIMode.init(rawValue:))?.title }

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
    /// Keep the captured image with the chat so it can be continued later.
    @AppStorage("ai.saveImages") var saveImages = true
    /// Days to keep chats; 0 = forever.
    @AppStorage("ai.retentionDays") var retentionDays = 0 { didSet { prune() } }
    @Published private(set) var sessions: [ChatSession] = []

    let imagesDir: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Notch apple/ai-images", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    func imageURL(_ id: UUID) -> URL { imagesDir.appendingPathComponent("\(id.uuidString).jpg") }

    func image(for session: ChatSession) -> CGImage? {
        guard session.hasImage == true, let data = try? Data(contentsOf: imageURL(session.id)),
              let rep = NSBitmapImageRep(data: data) else { return nil }
        return rep.cgImage
    }

    /// Notes what a task started from (mode, input, image) on its session.
    func describe(sessionID: UUID, mode: AIMode?, input: CapturedInput?, textInput: Bool) {
        guard isEnabled, let i = sessions.firstIndex(where: { $0.id == sessionID }) else { return }
        sessions[i].mode = mode?.rawValue
        sessions[i].inputKind = input?.kind.rawValue ?? (textInput ? "text" : nil)
        sessions[i].inputSource = input?.source
        if let input, saveImages {
            let rep = NSBitmapImageRep(cgImage: Self.downscaled(input.image, maxEdge: 1600))
            if let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.8]) {
                try? data.write(to: imageURL(sessionID), options: .atomic)
                sessions[i].hasImage = true
            }
        }
        save()
    }

    /// Searches questions, answers, mode, provider, model and date, on this Mac.
    func search(_ query: String) -> [ChatSession] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return sessions }
        return sessions.filter { s in
            let date = s.started.formatted(date: .complete, time: .omitted).lowercased()
            return s.messages.contains { $0.text.lowercased().contains(q) }
                || (s.modeTitle ?? "").lowercased().contains(q) || s.providerTitle.lowercased().contains(q)
                || s.model.lowercased().contains(q) || date.contains(q) || (s.inputSource ?? "").lowercased().contains(q)
        }
    }

    /// Markdown export of a conversation.
    func markdown(_ s: ChatSession) -> String {
        var out = "# \(s.firstQuestion.prefix(80))\n\n"
        out += "*\(s.providerTitle) · \(s.modelsUsed.joined(separator: ", ")) · \(s.started.formatted(date: .abbreviated, time: .shortened))"
        if let m = s.modeTitle { out += " · \(m)" }
        out += "*\n\n"
        for m in s.messages {
            out += m.role == "user" ? "**You:** " : "**AI\(m.model.map { " (\($0))" } ?? ""):**\n\n"
            out += m.text + "\n\n"
        }
        return out
    }

    func prune() {
        guard retentionDays > 0 else { return }
        let cutoff = Date().addingTimeInterval(-Double(retentionDays) * 86_400)
        let old = sessions.filter { $0.updated < cutoff }
        guard !old.isEmpty else { return }
        old.forEach { try? FileManager.default.removeItem(at: imageURL($0.id)) }
        sessions.removeAll { $0.updated < cutoff }
        save()
    }

    static func downscaled(_ image: CGImage, maxEdge: CGFloat) -> CGImage {
        let f = min(1, maxEdge / CGFloat(max(image.width, image.height)))
        guard f < 1 else { return image }
        let w = Int(CGFloat(image.width) * f), h = Int(CGFloat(image.height) * f)
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return image }
        ctx.interpolationQuality = .high
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        return ctx.makeImage() ?? image
    }

    private let url: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Notch apple", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("ai-history.json")
    }()

    init() {
        if let data = try? Data(contentsOf: url),
           let saved = try? JSONDecoder().decode([ChatSession].self, from: data) {
            sessions = saved.sorted { $0.updated > $1.updated }
        }
        prune()
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
        try? FileManager.default.removeItem(at: imageURL(id))
        sessions.removeAll { $0.id == id }
        save()
    }

    func deleteAll() {
        try? FileManager.default.removeItem(at: imagesDir)
        try? FileManager.default.createDirectory(at: imagesDir, withIntermediateDirectories: true)
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
        guard let data = try? JSONEncoder().encode(sessions) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
