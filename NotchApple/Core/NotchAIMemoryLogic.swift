//
//  NotchAIMemoryLogic.swift
//  Notch Apple
//
//  The pure rules of NotchAI's memory: what may be remembered, and how remembered items and style preferences become
//  part of the model's instructions. Memory is separate from the conversation (which is temporary) and only ever
//  holds what the user added or approved; obvious secrets are refused. Unit tested.
//

import Foundation

struct MemoryItem: Identifiable, Codable, Equatable {
    enum Kind: String, Codable, CaseIterable, Identifiable {
        case preference, project, fact
        var id: String { rawValue }
        var title: String { switch self { case .preference: "Preference"; case .project: "Project"; case .fact: "About me" } }
    }
    var id = UUID()
    var kind: Kind
    var text: String
    var enabled = true
    var added = Date()
}

enum ResponseStyle: String, CaseIterable, Identifiable, Codable {
    case none, concise, detailed, simple, structured
    var id: String { rawValue }
    var title: String {
        switch self {
        case .none: "No preference"
        case .concise: "Concise"
        case .detailed: "Detailed"
        case .simple: "Simple words"
        case .structured: "Structured (headings, lists)"
        }
    }
    var instruction: String? {
        switch self {
        case .none: nil
        case .concise: "Keep answers short and to the point."
        case .detailed: "Give thorough, detailed answers with reasoning."
        case .simple: "Explain in plain, simple words, avoiding jargon."
        case .structured: "Structure answers with short headings and bullet lists."
        }
    }
}

enum NotchAIMemoryLogic {
    static let maxItemLength = 280
    static let maxItems = 100

    enum Rejection: Equatable, LocalizedError {
        case empty, tooLong, duplicate, tooMany, sensitive

        var errorDescription: String? {
            switch self {
            case .empty: "Type something to remember."
            case .tooLong: "Keep it under \(NotchAIMemoryLogic.maxItemLength) characters."
            case .duplicate: "That is already remembered."
            case .tooMany: "Memory is full (\(NotchAIMemoryLogic.maxItems) items). Delete some first."
            case .sensitive: "That looks like a password, key or card number. NotchAI won't store it."
            }
        }
    }

    /// Obvious secrets: API-key shapes, long hex/base64 tokens, card numbers, "password is ...".
    static func looksSensitive(_ text: String) -> Bool {
        let patterns = [
            "\\bsk-[A-Za-z0-9_-]{16,}", "\\bAIza[0-9A-Za-z_-]{20,}", "\\bgh[pousr]_[A-Za-z0-9]{20,}", "\\bxox[abprs]-[A-Za-z0-9-]{10,}",
            "\\b(?:\\d[ -]?){13,19}\\b", "(?i)\\b(password|passcode|pin|secret|token|api[ _-]?key)\\b\\s*(is|=|:)\\s*\\S+",
            "\\b[A-Fa-f0-9]{32,}\\b", "-----BEGIN [A-Z ]*PRIVATE KEY-----",
        ]
        return patterns.contains { text.range(of: $0, options: .regularExpression) != nil }
    }

    static func validate(_ text: String, existing: [MemoryItem]) -> Result<String, Rejection> {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return .failure(.empty) }
        if t.count > maxItemLength { return .failure(.tooLong) }
        if looksSensitive(t) { return .failure(.sensitive) }
        if existing.count >= maxItems { return .failure(.tooMany) }
        if existing.contains(where: { $0.text.caseInsensitiveCompare(t) == .orderedSame }) { return .failure(.duplicate) }
        return .success(t)
    }

    /// The instructions the model receives: the base prompt, then the style, then enabled memory. Nothing is added when
    /// memory is off or empty, so the model sees exactly the base prompt.
    static func systemPrompt(base: String, items: [MemoryItem], style: ResponseStyle, useMemory: Bool) -> String {
        var parts = [base]
        if useMemory {
            if let s = style.instruction { parts.append(s) }
            let on = items.filter(\.enabled)
            if !on.isEmpty {
                parts.append("Things the user asked you to remember (use them when relevant; never mention this list unless asked):\n"
                             + on.map { "- [\($0.kind.title)] \($0.text)" }.joined(separator: "\n"))
            }
        }
        return parts.joined(separator: "\n\n")
    }
}
