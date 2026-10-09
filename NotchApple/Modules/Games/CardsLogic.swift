//
//  CardsLogic.swift
//  Notch apple
//
//  The rules for Blackjack and Solitaire, free of any display code. The same rules, with the same test vectors,
//  are in the Windows app (games/cardslogic.js).
//

import Foundation

enum Suit: String, CaseIterable, Equatable { case clubs, diamonds, hearts, spades
    var isRed: Bool { self == .diamonds || self == .hearts }
    var symbol: String { switch self { case .clubs: "suit.club.fill"; case .diamonds: "suit.diamond.fill"; case .hearts: "suit.heart.fill"; case .spades: "suit.spade.fill" } }
}

struct PlayingCard: Identifiable, Equatable {
    static let ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
    let id: String
    let rank: String
    let suit: Suit
    var up = true
    /// A = 1 … K = 13.
    var value: Int { (Self.ranks.firstIndex(of: rank) ?? 0) + 1 }
}

enum Cards {
    static func deck(decks: Int = 1) -> [PlayingCard] {
        var out: [PlayingCard] = []
        for d in 0..<decks { for s in Suit.allCases { for r in PlayingCard.ranks { out.append(PlayingCard(id: "\(r)\(s.rawValue.first!)\(d)", rank: r, suit: s)) } } }
        return out
    }

    // MARK: Blackjack

    /// Best total: aces count 11 while that doesn't bust. `soft` means an ace still counts 11.
    static func bjValue(_ hand: [PlayingCard]) -> (total: Int, soft: Bool) {
        var total = 0, aces = 0
        for c in hand {
            if c.rank == "A" { aces += 1; total += 11 } else { total += ["J", "Q", "K"].contains(c.rank) ? 10 : Int(c.rank) ?? 0 }
        }
        while total > 21 && aces > 0 { total -= 10; aces -= 1 }
        return (total, aces > 0)
    }
    static func isBlackjack(_ hand: [PlayingCard]) -> Bool { hand.count == 2 && bjValue(hand).total == 21 }
    /// The dealer stands on every 17, soft ones included.
    static func dealerShouldHit(_ hand: [PlayingCard]) -> Bool { bjValue(hand).total < 17 }

    enum BJResult: String { case blackjack, win, push, lose, bust }
    /// What a finished round pays as a multiple of the bet (negative = lost).
    static func bjOutcome(player: [PlayingCard], dealer: [PlayingCard]) -> (result: BJResult, pay: Double) {
        let p = bjValue(player).total, d = bjValue(dealer).total
        if p > 21 { return (.bust, -1) }
        if isBlackjack(player) { return isBlackjack(dealer) ? (.push, 0) : (.blackjack, 1.5) }
        if isBlackjack(dealer) { return (.lose, -1) }
        if d > 21 || p > d { return (.win, 1) }
        return p == d ? (.push, 0) : (.lose, -1)
    }

    // MARK: Klondike Solitaire (draw one)

    struct Solitaire {
        var tableau: [[PlayingCard]]
        var stock: [PlayingCard]
        var waste: [PlayingCard] = []
        var found: [[PlayingCard]] = [[], [], [], []]
        var won: Bool { found.allSatisfy { $0.count == 13 } }
    }
    static func solDeal(_ deck: [PlayingCard]) -> Solitaire {
        var cards = deck, tableau: [[PlayingCard]] = []
        for i in 0..<7 {
            var pile = Array(cards.prefix(i + 1)); cards.removeFirst(i + 1)
            for k in pile.indices { pile[k].up = k == pile.count - 1 }
            tableau.append(pile)
        }
        return Solitaire(tableau: tableau, stock: cards.map { var c = $0; c.up = false; return c })
    }
    /// One lower and the opposite colour, or a king on an empty pile.
    static func canPlaceTableau(_ card: PlayingCard, on pile: [PlayingCard]) -> Bool {
        guard let top = pile.last else { return card.rank == "K" }
        return top.up && top.suit.isRed != card.suit.isRed && top.value == card.value + 1
    }
    /// A foundation takes its suit in order from the ace.
    static func canPlaceFoundation(_ card: PlayingCard, on pile: [PlayingCard]) -> Bool {
        guard let top = pile.last else { return card.rank == "A" }
        return top.suit == card.suit && card.value == top.value + 1
    }
}
