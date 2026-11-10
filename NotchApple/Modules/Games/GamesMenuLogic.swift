//
//  GamesMenuLogic.swift
//  Notch Apple
//
//  The Games menu: which games there are, how they are grouped, and how a search and a filter narrow them down. Foundation only, so it
//  is tested on its own. The Windows app has the same list (NotchWindows/src/js/modules/gameslogic.js); a test keeps them equal.
//

import Foundation

enum GamesCatalog {
    struct Category: Identifiable, Equatable {
        let id: String
        let name: String
        init(_ id: String, _ name: String) { self.id = id; self.name = name }
    }

    static let categories: [Category] = [
        .init("all", "All"), .init("arcade", "Arcade"), .init("fly", "Flying & racing"), .init("strategy", "Strategy"),
        .init("cards", "Cards & board"), .init("online", "Online"), .init("daily", "Daily"), .init("private", "Private"),
    ]

    /// `art` is the two colours of the card's picture. A `locked` game needs an access code first.
    struct Entry: Identifiable, Equatable {
        let id: String
        let name: String
        let cats: [String]
        let tags: [String]
        let icon: String
        let art: [String]
        var locked = false
    }

    static let games: [Entry] = [
        .init(id: "fe", name: "Flight Economy", cats: ["strategy", "private"], tags: ["Private"], icon: "✈️", art: ["#1c3b6e", "#2f8fd6"], locked: true),
        .init(id: "plane", name: "Plane", cats: ["fly", "online"], tags: ["Online"], icon: "🛩️", art: ["#1d6fa5", "#56c1ff"]),
        .init(id: "racing", name: "Racing", cats: ["fly", "online"], tags: ["Online"], icon: "🏎️", art: ["#a3201f", "#ff6b4a"]),
        .init(id: "rocket", name: "Rocket League", cats: ["fly", "online"], tags: ["Online"], icon: "⚽", art: ["#1e5d3a", "#52d68a"]),
        .init(id: "ctf", name: "Capture the Flag", cats: ["online"], tags: ["Online"], icon: "🚩", art: ["#6b2d8c", "#c07bff"]),
        .init(id: "scribble", name: "Scribble", cats: ["online"], tags: ["Online"], icon: "✏️", art: ["#8a5a14", "#ffc95c"]),
        .init(id: "chess", name: "Chess", cats: ["cards", "online"], tags: ["Online", "2P"], icon: "♟️", art: ["#2a2a35", "#6a6a82"]),
        .init(id: "nightshift", name: "Night Shift", cats: ["arcade"], tags: ["New"], icon: "🔦", art: ["#150a22", "#47206b"]),
        .init(id: "eagle", name: "Eagle Ride", cats: ["fly"], tags: ["New"], icon: "🦅", art: ["#87ceeb", "#ffd700"]),
        .init(id: "fnaf", name: "FNAF 1", cats: ["online"], tags: ["New", "Online"], icon: "🐻", art: ["#2a1608", "#b8691f"]),   // Mac only: it plays fnaf1.io in a web view (the Windows app blocks frames)
        .init(id: "tetris", name: "Tetris", cats: ["arcade"], tags: [], icon: "🧱", art: ["#1c2e6b", "#4d7cff"]),
        .init(id: "snake", name: "Snake", cats: ["arcade"], tags: [], icon: "🐍", art: ["#1e5d2a", "#6fe36b"]),
        .init(id: "breakout", name: "Breakout", cats: ["arcade"], tags: [], icon: "🧨", art: ["#7a2a1c", "#ff9a5c"]),
        .init(id: "runner", name: "Runner", cats: ["arcade"], tags: [], icon: "🏃", art: ["#176a6a", "#4de0d0"]),
        .init(id: "2048", name: "2048", cats: ["arcade"], tags: [], icon: "🔢", art: ["#8a6a1c", "#f2c94c"]),
        .init(id: "memory", name: "Memory", cats: ["arcade"], tags: [], icon: "💡", art: ["#4a2a8a", "#9b7bff"]),
        .init(id: "reaction", name: "Reaction", cats: ["arcade"], tags: [], icon: "⚡", art: ["#8a7a1c", "#fff06b"]),
        .init(id: "cookie", name: "Cookies", cats: ["strategy"], tags: [], icon: "🍪", art: ["#6b4220", "#d99a5c"]),
        .init(id: "wordle", name: "Daily Word", cats: ["daily"], tags: ["Daily"], icon: "🔤", art: ["#2a6b4a", "#7ee7a8"]),
        .init(id: "trivia", name: "Daily Trivia", cats: ["daily"], tags: ["Daily"], icon: "❓", art: ["#6b2a5a", "#ff8ac8"]),
        .init(id: "blackjack", name: "Blackjack", cats: ["cards"], tags: [], icon: "🂡", art: ["#0f4a2a", "#2fae6a"]),
        .init(id: "solitaire", name: "Solitaire", cats: ["cards"], tags: [], icon: "🃏", art: ["#1a4a5a", "#4db3d1"]),
        .init(id: "poker", name: "Poker", cats: ["cards"], tags: [], icon: "♣️", art: ["#3a1a4a", "#9a4dd1"]),
    ]

    static func entry(_ id: String) -> Entry? { games.first { $0.id == id } }

    /// The games a search word and a filter leave. The search matches anywhere in the name, ignoring capitals.
    static func filter(_ list: [Entry], query: String, category: String) -> [Entry] {
        let word = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return list.filter { (word.isEmpty || $0.name.lowercased().contains(word)) && (category == "all" || $0.cats.contains(category)) }
    }

    /// How many games each filter has (shown small beside its name).
    static func counts(_ list: [Entry]) -> [String: Int] {
        var out: [String: Int] = [:]
        for c in categories { out[c.id] = c.id == "all" ? list.count : list.filter { $0.cats.contains(c.id) }.count }
        return out
    }

    /// The "Jump back in" list: the game just played goes first, no repeats, at most three, and only games that exist.
    static func recordRecent(_ list: [String], _ id: String) -> [String] {
        let known = Set(games.map(\.id))
        return Array(([id] + list.filter { $0 != id }).filter { known.contains($0) }.prefix(3))
    }
}

/// The games played most recently, kept on this Mac.
enum GamesRecents {
    static let key = "games.recent"
    static var list: [String] { UserDefaults.standard.stringArray(forKey: key) ?? [] }
    static func note(_ id: String) { UserDefaults.standard.set(GamesCatalog.recordRecent(list, id), forKey: key) }
}

/// Access codes for a private game: what a person typed, cleaned and shown the way codes are (ABCD-EFGH-IJKL).
enum GameCode {
    /// The 12 letters and numbers of a code, or nil when it is not one.
    static func clean(_ raw: String) -> String? {
        let c = String(raw.uppercased().unicodeScalars.filter { ($0.value >= 48 && $0.value <= 57) || ($0.value >= 65 && $0.value <= 90) }.map(Character.init))
        return c.count == 12 ? c : nil
    }
    static func pretty(_ raw: String) -> String {
        let c = Array(String(raw.uppercased().unicodeScalars.filter { ($0.value >= 48 && $0.value <= 57) || ($0.value >= 65 && $0.value <= 90) }.map(Character.init)).prefix(12))
        return stride(from: 0, to: c.count, by: 4).map { String(c[$0..<min($0 + 4, c.count)]) }.joined(separator: "-")
    }
}
