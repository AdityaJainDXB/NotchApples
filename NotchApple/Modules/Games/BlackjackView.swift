//
//  BlackjackView.swift
//  Notch apple
//
//  Blackjack against the dealer, four decks. Blackjack pays 3:2, the dealer stands on every 17, you can double on
//  your first two cards. Play money only; the bank is kept on this Mac and refills when it runs out.
//

import SwiftUI

@MainActor
final class BlackjackModel: ObservableObject {
    enum Phase { case bet, play, dealer, done }
    @Published var phase: Phase = .bet
    @Published var player: [PlayingCard] = []
    @Published var dealer: [PlayingCard] = []
    @Published var bet = 25
    @Published var bank = UserDefaults.standard.object(forKey: "games.blackjack.bank") as? Int ?? 500
    @Published var message = ""
    @Published var doubled = false
    private var deck: [PlayingCard] = []
    private var counter = 0

    private func draw() -> PlayingCard {
        if deck.count < 15 { deck = Cards.deck(decks: 4).shuffled() }
        var c = deck.removeLast(); counter += 1; c = PlayingCard(id: "\(c.id)-\(counter)", rank: c.rank, suit: c.suit); return c
    }
    var stake: Int { bet * (doubled ? 2 : 1) }

    func addBet(_ n: Int) { bet = min(bank, bet + n) }
    func resetBet() { bet = min(25, bank) }
    func deal() {
        guard bet >= 1, bank >= 1 else { return }
        withAnimation { player = [draw(), draw()]; dealer = [draw(), draw()]; doubled = false; message = ""; phase = .play }
        if Cards.isBlackjack(player) || Cards.isBlackjack(dealer) { Task { await finish() } }
    }
    func hit() { withAnimation { player.append(draw()) }; if Cards.bjValue(player).total >= 21 { Task { await finish() } } }
    func stand() { Task { await finish() } }
    func double() { guard player.count == 2, bank >= bet * 2 else { return }; doubled = true; withAnimation { player.append(draw()) }; Task { await finish() } }
    func next() {
        if bank < 1 { bank = 500; save() }
        bet = max(1, min(bet, bank)); phase = .bet; player = []; dealer = []; message = ""; doubled = false
    }
    private func save() { UserDefaults.standard.set(bank, forKey: "games.blackjack.bank") }

    private func finish() async {
        phase = .dealer
        if Cards.bjValue(player).total <= 21 && !Cards.isBlackjack(player) {
            while Cards.dealerShouldHit(dealer) {
                try? await Task.sleep(nanoseconds: 520_000_000)
                withAnimation { dealer.append(draw()) }
            }
        }
        let out = Cards.bjOutcome(player: player, dealer: dealer), won = Int((Double(stake) * out.pay).rounded())
        bank += won; save()
        message = switch out.result {
        case .blackjack: "Blackjack! +\(won)"
        case .win: "You win +\(won)"
        case .push: "Push"
        case .lose: "Dealer wins \(won)"
        case .bust: "Bust \(won)"
        }
        phase = .done
    }
}

struct BlackjackView: View {
    @StateObject private var m = BlackjackModel()

    private func total(_ h: [PlayingCard]) -> String { let v = Cards.bjValue(h); return "\(v.total)\(v.soft && v.total < 21 ? " (soft)" : "")" }

    var body: some View {
        let showAll = m.phase == .done || m.phase == .dealer
        VStack(spacing: 6) {
            HStack(spacing: 14) {
                Text("Bank \(m.bank)").font(.system(size: 12, weight: .bold))
                Text("Bet \(m.phase == .bet ? m.bet : m.stake)").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            }
            Text("Dealer" + (m.dealer.isEmpty ? "" : " · \(showAll ? total(m.dealer) : "?")")).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            if m.dealer.isEmpty { Color.clear.frame(height: 90) } else { CardFanView(cards: m.dealer, width: 50, hideFrom: showAll ? nil : 1) }
            Text("You" + (m.player.isEmpty ? "" : " · \(total(m.player))")).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            if m.player.isEmpty { Color.clear.frame(height: 90) } else { CardFanView(cards: m.player, width: 50) }
            Text(m.message).font(.system(size: 13, weight: .bold)).foregroundStyle(.white).frame(minHeight: 16)
            HStack(spacing: 6) {
                switch m.phase {
                case .bet:
                    ForEach([5, 25, 100], id: \.self) { n in Button("+\(n)") { m.addBet(n) }.buttonStyle(PurpleButtonStyle(prominent: false)).disabled(n > m.bank) }
                    Button("Reset") { m.resetBet() }.buttonStyle(PurpleButtonStyle(prominent: false))
                    Button("Deal") { m.deal() }.buttonStyle(PurpleButtonStyle()).disabled(m.bet < 1)
                case .play:
                    Button("Hit") { m.hit() }.buttonStyle(PurpleButtonStyle())
                    Button("Stand") { m.stand() }.buttonStyle(PurpleButtonStyle(prominent: false))
                    Button("Double") { m.double() }.buttonStyle(PurpleButtonStyle(prominent: false)).disabled(m.player.count != 2 || m.bank < m.bet * 2)
                case .dealer: ProgressView().controlSize(.small)
                case .done: Button(m.bank < 1 ? "Out of chips: new bank of 500" : "Next hand") { m.next() }.buttonStyle(PurpleButtonStyle())
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
