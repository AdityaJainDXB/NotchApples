//
//  PokerView.swift
//  Notch Apple
//
//  A quick, play-money Texas Hold'em table against a computer opponent.
//

import SwiftUI

@MainActor
final class PokerModel: ObservableObject {
    enum Street: String { case preflop = "Pre-flop", flop = "Flop", turn = "Turn", river = "River", done = "Hand over" }

    @Published private(set) var street: Street = .done
    @Published private(set) var playerCards: [PlayingCard] = []
    @Published private(set) var cpuCards: [PlayingCard] = []
    @Published private(set) var board: [PlayingCard] = []
    @Published private(set) var bank = UserDefaults.standard.object(forKey: "games.poker.bank") as? Int ?? 500
    @Published private(set) var cpuBank = 500
    @Published private(set) var pot = 0
    @Published private(set) var toCall = 0
    @Published private(set) var message = "Deal a hand of Texas Hold’em."
    @Published private(set) var revealCPU = false
    private var deck: [PlayingCard] = []
    private var dealt = 0

    var visibleBoard: [PlayingCard] { Array(board.prefix(boardCount)) }
    private var boardCount: Int { switch street { case .preflop: 0; case .flop: 3; case .turn: 4; case .river, .done: 5 } }
    var canPlay: Bool { street != .done && bank >= toCall }

    func deal() {
        if bank < 1 { bank = 500; save() }
        if cpuBank < 20 { cpuBank = 500 }
        deck = Cards.deck().shuffled(); dealt = 0
        playerCards = [draw(), draw()]
        cpuCards = [draw(), draw()]
        board = (0..<5).map { _ in draw() }
        bank -= 20; cpuBank -= 10; pot = 30; toCall = 10
        street = .preflop; message = "Blinds are in. Call 10, raise, or fold."; revealCPU = false
        save()
    }

    func checkOrCall() {
        guard canPlay else { return }
        let paid = min(toCall, bank); bank -= paid; pot += paid; toCall = 0
        if street == .river { showdown(); return }
        advance()
        message = "\(street.rawValue): check or raise."
        save()
    }

    func raise() {
        guard canPlay else { return }
        let paid = min(bank, toCall + 20)
        guard paid > toCall else { checkOrCall(); return }
        bank -= paid; pot += paid
        let cpuCost = min(cpuBank, paid)
        let strength = cpuStrength()
        if strength < 0.28 && cpuCost >= 20 && Int.random(in: 0..<100) < 62 {
            bank += pot; pot = 0; street = .done; revealCPU = false
            message = "The other player folds. You take the pot."
        } else {
            cpuBank -= cpuCost; pot += cpuCost
            if cpuCost < paid { showdown() }
            else if street == .river { showdown() }
            else { advance(); message = "Called. \(street.rawValue): check, raise, or fold." }
        }
        save()
    }

    func fold() {
        guard street != .done else { return }
        cpuBank += pot; pot = 0; street = .done; revealCPU = false
        message = "You fold. Deal another hand when you’re ready."
        save()
    }

    private func advance() {
        switch street {
        case .preflop: street = .flop
        case .flop: street = .turn
        case .turn: street = .river
        case .river, .done: showdown()
        }
    }

    private func showdown() {
        revealCPU = true; street = .done
        guard let p = Cards.pokerRank(playerCards + board), let c = Cards.pokerRank(cpuCards + board) else {
            message = "Could not read the hand. Deal again."; return
        }
        if p > c { bank += pot; message = "You win the \(pot)-chip pot." }
        else if p < c { cpuBank += pot; message = "The other player wins the \(pot)-chip pot." }
        else { let half = pot / 2; bank += half; cpuBank += pot - half; message = "Split pot: \(pot) chips." }
        pot = 0
    }

    /// A light opponent: it values made hands and high pairs, then folds some weak hands to a raise.
    private func cpuStrength() -> Double {
        if let rank = Cards.pokerRank(cpuCards + visibleBoard), visibleBoard.count == 5 {
            return min(0.98, 0.4 + Double(rank.category) * 0.075 + Double(rank.kickers.first ?? 0) / 200)
        }
        guard cpuCards.count == 2 else { return 0.2 }
        let a = cpuCards[0].rank == "A" ? 14 : cpuCards[0].value
        let b = cpuCards[1].rank == "A" ? 14 : cpuCards[1].value
        let pair = a == b
        let suited = cpuCards[0].suit == cpuCards[1].suit
        let high = max(a, b), gap = abs(a - b)
        var score = 0.12 + Double(high) * 0.027 + (pair ? 0.32 : 0) + (suited ? 0.06 : 0) + (gap <= 2 ? 0.05 : 0)
        if !visibleBoard.isEmpty {
            let boardRanks = Set(visibleBoard.map { $0.rank == "A" ? 14 : $0.value })
            if boardRanks.contains(a) || boardRanks.contains(b) { score += 0.17 }
        }
        return min(score, 0.92)
    }

    private func draw() -> PlayingCard {
        var card = deck[dealt]; dealt += 1
        card = PlayingCard(id: "poker-\(dealt)", rank: card.rank, suit: card.suit)
        return card
    }
    private func save() { UserDefaults.standard.set(bank, forKey: "games.poker.bank") }
}

struct PokerView: View {
    @StateObject private var model = PokerModel()
    private let cardWidth: CGFloat = 35

    var body: some View {
        VStack(spacing: 6) {
            HStack {
                Text("You · \(model.bank)").font(.system(size: 11, weight: .bold))
                Spacer()
                Text("Pot \(model.pot)").font(.system(size: 12, weight: .bold, design: .rounded)).foregroundStyle(Theme.accentBright)
                Spacer()
                Text("CPU · \(model.cpuBank)").font(.system(size: 11, weight: .bold))
            }
            Text("Other player · \(model.revealCPU ? "showdown" : "cards hidden")")
                .font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
            cardRow(model.cpuCards, faceUp: model.revealCPU)
            Text("\(model.street.rawValue) · Community cards").font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.textSecondary)
            cardRow(model.visibleBoard, faceUp: true)
            cardRow(model.playerCards, faceUp: true)
            Text("Your cards").font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
            Text(model.message).font(.system(size: 10, weight: .medium)).foregroundStyle(.white)
                .multilineTextAlignment(.center).lineLimit(2).frame(minHeight: 25)
            HStack(spacing: 5) {
                if model.street == .done {
                    Button("Deal") { model.deal() }.buttonStyle(PurpleButtonStyle())
                } else {
                    Button(model.toCall == 0 ? "Check" : "Call \(model.toCall)") { model.checkOrCall() }
                        .buttonStyle(PurpleButtonStyle())
                    Button("Raise 20") { model.raise() }.buttonStyle(PurpleButtonStyle(prominent: false)).disabled(model.bank <= model.toCall)
                    Button("Fold") { model.fold() }.buttonStyle(PurpleButtonStyle(prominent: false))
                }
            }
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder private func cardRow(_ cards: [PlayingCard], faceUp: Bool) -> some View {
        HStack(spacing: 3) {
            ForEach(cards) { card in PlayingCardView(card: card, width: cardWidth, faceUp: faceUp) }
            if cards.isEmpty { Text("—").foregroundStyle(Theme.textSecondary) }
        }
        .frame(height: cardWidth * 1.4 + 2)
    }
}
