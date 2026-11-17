//
//  ThreeCardLogic.swift
//  Notch Apple
//
//  Three-Card Poker (issue #101): the hand rankings and the winner, with no UI. Rankings, strongest first: Three of a Kind,
//  Straight Flush, Straight, Flush, Pair, High Card (Three of a Kind beats a Straight Flush in this game). Ace is high, and also
//  low in A-2-3, the lowest straight. Suits never break a tie; equal hands are a draw. The same rules are in
//  NotchWindows/src/js/games/threecard-logic.js.
//

import Foundation

enum ThreeCard {
    enum Category: Int, Comparable, CaseIterable {
        case highCard = 0, pair, flush, straight, straightFlush, threeOfAKind
        static func < (a: Category, b: Category) -> Bool { a.rawValue < b.rawValue }
        var name: String {
            switch self {
            case .highCard: "High Card"
            case .pair: "Pair"
            case .flush: "Flush"
            case .straight: "Straight"
            case .straightFlush: "Straight Flush"
            case .threeOfAKind: "Three of a Kind"
            }
        }
        var detail: String {
            switch self {
            case .threeOfAKind: "Three cards of the same value"
            case .straightFlush: "Three in a row, same suit"
            case .straight: "Three in a row, mixed suits"
            case .flush: "Three of the same suit"
            case .pair: "Two cards of the same value"
            case .highCard: "None of the above"
            }
        }
    }

    struct Rank: Comparable, Equatable {
        let category: Category
        /// What breaks a tie inside the category, most important first (card values, Ace = 14).
        let tiebreak: [Int]
        static func < (a: Rank, b: Rank) -> Bool {
            if a.category != b.category { return a.category < b.category }
            for (x, y) in zip(a.tiebreak, b.tiebreak) where x != y { return x < y }
            return false
        }
    }

    /// Ace high: A = 14, K = 13 … 2 = 2.
    static func value(_ c: PlayingCard) -> Int { c.rank == "A" ? 14 : c.value }

    static func evaluate(_ cards: [PlayingCard]) -> Rank {
        precondition(cards.count == 3, "Three-Card Poker hands have exactly three cards")
        let v = cards.map(value).sorted(by: >)
        let flush = Set(cards.map(\.suit)).count == 1
        let straightHigh: Int? = v == [14, 3, 2] ? 3 : (v[0] - 1 == v[1] && v[1] - 1 == v[2] ? v[0] : nil)
        if v[0] == v[2] { return Rank(category: .threeOfAKind, tiebreak: [v[0]]) }
        if let h = straightHigh, flush { return Rank(category: .straightFlush, tiebreak: [h]) }
        if let h = straightHigh { return Rank(category: .straight, tiebreak: [h]) }
        if flush { return Rank(category: .flush, tiebreak: v) }
        if v[0] == v[1] { return Rank(category: .pair, tiebreak: [v[0], v[2]]) }
        if v[1] == v[2] { return Rank(category: .pair, tiebreak: [v[1], v[0]]) }
        return Rank(category: .highCard, tiebreak: v)
    }

    /// The indexes of the best hands among `hands` (more than one when they tie exactly).
    static func winners(_ hands: [[PlayingCard]]) -> [Int] {
        let ranks = hands.map(evaluate)
        guard let best = ranks.max() else { return [] }
        return ranks.indices.filter { ranks[$0] == best }
    }

    /// A computer player stays in with a pair or better, or Queen-high or better (the usual "Q-6-4" rule of thumb).
    static func cpuPlays(_ cards: [PlayingCard]) -> Bool {
        let r = evaluate(cards)
        return r.category > .highCard || (r.tiebreak.first ?? 0) >= 12
    }

    /// Splits `pot` between the winners: equal shares, the odd chips to the first winners.
    static func split(_ pot: Int, among count: Int) -> [Int] {
        guard count > 0 else { return [] }
        return (0..<count).map { pot / count + ($0 < pot % count ? 1 : 0) }
    }
}
