//
//  EmojiLogic.swift
//  Notch apple
//
//  Emoji and symbol search for the command palette ("emoji heart", ":fire"). Words you type must all match
//  the name or an everyday search word ("love" finds hearts). The Windows app (emoji.js) runs the same
//  scoring and test vectors.
//

import Foundation

enum EmojiLogic {
    struct Entry: Equatable {
        let emoji: String
        let name: String
        let extra: String
        var title: String { "\(emoji)  \(name)" }
    }

    static let all: [Entry] = EmojiData.raw.split(separator: "\n").compactMap { line in
        let p = line.split(separator: "|", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
        return p.count == 3 ? Entry(emoji: p[0], name: p[1], extra: p[2]) : nil
    }

    static let popular = ["😀", "😂", "❤️", "👍", "🙏", "🎉", "🔥", "✨", "👀", "✅", "🚀", "💡"]

    /// "emoji heart" → "heart", ":fire" → "fire", "emoji" → "". nil when the text isn't an emoji search.
    static func trigger(_ query: String) -> String? {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if q.hasPrefix(":") { return String(q.dropFirst()).trimmingCharacters(in: .whitespaces) }
        for word in ["emojis", "emoji", "symbols", "symbol"] where q == word || q.hasPrefix(word + " ") {
            return String(q.dropFirst(word.count)).trimmingCharacters(in: .whitespaces)
        }
        return nil
    }

    /// Best matches first. An empty search gives the popular ones.
    static func search(_ query: String, limit: Int = 12) -> [Entry] {
        let tokens = query.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
        if tokens.isEmpty { return popular.compactMap { p in all.first { $0.emoji == p } }.prefix(limit).map { $0 } }
        var scored: [(entry: Entry, score: Int, index: Int)] = []
        for (i, e) in all.enumerated() {
            let words = e.name.split(separator: " ").map(String.init)
            var total = 0
            for t in tokens {
                if e.name == t { total += 10 }
                else if e.name.hasPrefix(t) { total += 6 }
                else if words.contains(where: { $0.hasPrefix(t) }) { total += 4 }
                else if e.name.contains(t) { total += 2 }
                else if e.extra.split(separator: " ").contains(where: { $0.hasPrefix(t) }) { total += 1 }
                else { total = -1; break }
            }
            if total > 0 { scored.append((e, total + (popular.contains(e.emoji) ? 5 : 0), i)) }   // everyday ones first
        }
        scored.sort { a, b in
            a.score != b.score ? a.score > b.score : a.entry.name.count != b.entry.name.count ? a.entry.name.count < b.entry.name.count : a.index < b.index
        }
        return scored.prefix(limit).map(\.entry)
    }
}
