//
//  NotchAIConversationLogic.swift
//  Notch Apple
//
//  The pure rules behind NotchAI's shared conversation (Quick Ask and the NotchAI tab continue the same chat):
//  what "Regenerate" re-asks, and how a long chat is trimmed to fit a model's context. No UI, no network, unit tested.
//

import Foundation

enum NotchAIConversationLogic {
    struct Turn: Equatable {
        var role: String     // "user" or "assistant"
        var text: String
    }

    /// For Regenerate: drop the trailing assistant reply (or replies) and return the turns before the last question
    /// plus that question. Nil when there is no question to re-ask.
    static func regeneration(_ turns: [Turn]) -> (history: [Turn], question: String)? {
        var t = turns
        while let last = t.last, last.role == "assistant" { t.removeLast() }
        guard let q = t.last, q.role == "user", !q.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        t.removeLast()
        return (t, q.text)
    }

    /// Keeps the newest turns that fit in `maxCharacters` (about a quarter as many tokens), always keeps the last turn,
    /// and never starts on an assistant reply, so the model sees a well-formed chat.
    static func trimmed(_ turns: [Turn], maxCharacters: Int) -> [Turn] {
        guard let last = turns.last else { return [] }
        var kept: [Turn] = [last]
        var used = last.text.count
        for turn in turns.dropLast().reversed() {
            if used + turn.text.count > maxCharacters { break }
            kept.insert(turn, at: 0)
            used += turn.text.count
        }
        while kept.count > 1, kept.first?.role == "assistant" { kept.removeFirst() }
        return kept
    }

    /// Context budget in characters for a model, from its window in tokens when known (about 4 characters a token,
    /// keeping a quarter of the window free for the reply). A default when the window is unknown.
    static func contextBudget(windowTokens: Int?) -> Int {
        guard let w = windowTokens, w > 0 else { return 24_000 }
        return max(2_000, Int(Double(w) * 4 * 0.75))
    }
}
