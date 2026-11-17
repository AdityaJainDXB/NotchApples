//
//  ThreeCardPokerView.swift
//  Notch Apple
//
//  Three-Card Poker (issue #101): you against one to three computer players, with play-money chips. Everyone antes, everyone
//  gets three cards, you see yours and choose Play (bet the ante again) or Fold. Computer players play with Queen-high or
//  better. The best hand among the players who stayed takes the pot. A side panel lists the hand rankings, and a scoreboard
//  keeps wins, losses and draws. The rules are in ThreeCardLogic.swift.
//

import SwiftUI

@MainActor
final class ThreeCardModel: ObservableObject {
    struct Seat: Identifiable { let id: Int; var name: String; var chips: Int; var cards: [PlayingCard] = []; var playing = true }
    enum Phase { case idle, deciding, done }

    @Published var opponents = UserDefaults.standard.object(forKey: "games.3card.opponents") as? Int ?? 1 { didSet { UserDefaults.standard.set(opponents, forKey: "games.3card.opponents") } }
    @Published var ante = UserDefaults.standard.object(forKey: "games.3card.ante") as? Int ?? 10 { didSet { UserDefaults.standard.set(ante, forKey: "games.3card.ante") } }
    @Published private(set) var chips = UserDefaults.standard.object(forKey: "games.3card.chips") as? Int ?? 1000
    @Published private(set) var cpus: [Seat] = []
    @Published private(set) var mine: [PlayingCard] = []
    @Published private(set) var pot = 0
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var message = "Pick an ante and deal."
    @Published private(set) var winnerIDs: Set<Int> = []      // -1 is you
    @Published private(set) var wins = UserDefaults.standard.integer(forKey: "games.3card.wins")
    @Published private(set) var losses = UserDefaults.standard.integer(forKey: "games.3card.losses")
    @Published private(set) var draws = UserDefaults.standard.integer(forKey: "games.3card.draws")

    private static let names = ["Dealer", "Sam", "Ava"]

    var myRank: ThreeCard.Rank? { mine.count == 3 ? ThreeCard.evaluate(mine) : nil }

    func deal() {
        if chips < ante * 2 { chips = 1000; message = "Out of chips: here are 1,000 more." }
        var deck = Cards.deck().shuffled()
        func three() -> [PlayingCard] { let h = Array(deck.prefix(3)); deck.removeFirst(3); return h }
        cpus = (0..<opponents).map { i in
            let old = cpus.first { $0.id == i }
            var s = Seat(id: i, name: Self.names[i], chips: (old?.chips ?? 1000) < ante * 2 ? 1000 : (old?.chips ?? 1000))
            s.cards = three(); s.chips -= ante; return s
        }
        mine = three()
        chips -= ante
        pot = ante * (opponents + 1)
        winnerIDs = []
        phase = .deciding
        message = "You have \(ThreeCard.evaluate(mine).category.name.lowercased()). Play (bet \(ante) more) or fold?"
        save()
    }

    func play() {
        guard phase == .deciding else { return }
        chips -= ante; pot += ante
        for i in cpus.indices {
            cpus[i].playing = ThreeCard.cpuPlays(cpus[i].cards)
            if cpus[i].playing { cpus[i].chips -= ante; pot += ante }
        }
        let inHand = cpus.filter(\.playing)
        if inHand.isEmpty {
            chips += pot; winnerIDs = [-1]; wins += 1
            message = "Everyone else folds. You win \(pot) chips with \(ThreeCard.evaluate(mine).category.name)."
        } else {
            let hands = [mine] + inHand.map(\.cards)
            let ids = [-1] + inHand.map(\.id)
            let best = ThreeCard.winners(hands).map { ids[$0] }
            winnerIDs = Set(best)
            let shares = ThreeCard.split(pot, among: best.count)
            for (k, id) in best.enumerated() {
                if id == -1 { chips += shares[k] } else if let i = cpus.firstIndex(where: { $0.id == id }) { cpus[i].chips += shares[k] }
            }
            let name = ThreeCard.evaluate(hands[ThreeCard.winners(hands)[0]]).category.name
            if best == [-1] { wins += 1; message = "You win \(pot) chips with \(name)." }
            else if best.contains(-1) { draws += 1; message = "A draw: the pot is split (\(name))." }
            else { losses += 1; message = "\(best.compactMap { id in cpus.first { $0.id == id }?.name }.joined(separator: " and ")) wins with \(name)." }
        }
        pot = 0; phase = .done; save()
    }

    func fold() {
        guard phase == .deciding else { return }
        for i in cpus.indices { cpus[i].playing = ThreeCard.cpuPlays(cpus[i].cards) }
        let inHand = cpus.filter(\.playing)
        let takers = inHand.isEmpty ? cpus : inHand
        let best = ThreeCard.winners(takers.map(\.cards)).map { takers[$0].id }
        let shares = ThreeCard.split(pot, among: best.count)
        for (k, id) in best.enumerated() { if let i = cpus.firstIndex(where: { $0.id == id }) { cpus[i].chips += shares[k] } }
        winnerIDs = Set(best); losses += 1
        message = "You fold and lose your \(ante)-chip ante."
        pot = 0; phase = .done; save()
    }

    func resetScore() { wins = 0; losses = 0; draws = 0; save() }

    private func save() {
        let d = UserDefaults.standard
        d.set(chips, forKey: "games.3card.chips"); d.set(wins, forKey: "games.3card.wins")
        d.set(losses, forKey: "games.3card.losses"); d.set(draws, forKey: "games.3card.draws")
    }
}

struct ThreeCardPokerView: View {
    @StateObject private var model = ThreeCardModel()
    private let cardWidth: CGFloat = 30

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            table.frame(maxWidth: .infinity)
            sidePanel.frame(width: 170)
        }
        .padding(.vertical, 4)
    }

    private var table: some View {
        VStack(spacing: 6) {
            ForEach(model.cpus) { s in
                HStack(spacing: 6) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(s.name).font(.system(size: 11, weight: .bold))
                        chipLabel(s.chips)
                    }.frame(width: 70, alignment: .leading)
                    cards(s.cards, faceUp: model.phase == .done)
                    if model.phase == .done {
                        Text(s.playing ? ThreeCard.evaluate(s.cards).category.name : "Folded").font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(model.winnerIDs.contains(s.id) ? Color.green : Theme.textSecondary)
                    }
                    Spacer(minLength: 0)
                }
            }
            HStack(spacing: 6) {
                ChipStack(amount: model.pot)
                Text("Pot \(model.pot)").font(.system(size: 13, weight: .bold, design: .rounded)).foregroundStyle(Theme.accentBright)
            }
            .frame(height: 26)
            HStack(spacing: 6) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("You").font(.system(size: 11, weight: .bold))
                    chipLabel(model.chips)
                }.frame(width: 70, alignment: .leading)
                cards(model.mine, faceUp: true)
                if let r = model.myRank { Text(r.category.name).font(.system(size: 10, weight: .semibold)).foregroundStyle(model.winnerIDs.contains(-1) ? Color.green : .white) }
                Spacer(minLength: 0)
            }
            Text(model.message).font(.system(size: 11, weight: .medium)).foregroundStyle(.white).multilineTextAlignment(.center).lineLimit(2).frame(minHeight: 28)
            HStack(spacing: 6) {
                if model.phase == .deciding {
                    Button("Play (\(model.ante))") { model.play() }.buttonStyle(PurpleButtonStyle())
                    Button("Fold") { model.fold() }.buttonStyle(PurpleButtonStyle(prominent: false))
                } else {
                    Picker("", selection: $model.ante) { ForEach([10, 25, 50, 100], id: \.self) { Text("Ante \($0)").tag($0) } }.labelsHidden().frame(width: 92)
                    Picker("", selection: $model.opponents) { ForEach(1...3, id: \.self) { Text("\($0) other\($0 == 1 ? "" : "s")").tag($0) } }.labelsHidden().frame(width: 92)
                    Button(model.phase == .idle ? "Deal cards" : "New round") { model.deal() }.buttonStyle(PurpleButtonStyle())
                }
            }
        }
    }

    private var sidePanel: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Hand rankings").font(.system(size: 11, weight: .bold))
            ForEach(ThreeCard.Category.allCases.reversed(), id: \.self) { c in
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("\(6 - c.rawValue).").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.textSecondary).frame(width: 12, alignment: .trailing)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(c.name).font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(model.myRank?.category == c ? Theme.accentBright : .white)
                        Text(c.detail).font(.system(size: 8.5)).foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            Text("A-2-3 is the lowest straight. Suits never break a tie.").font(.system(size: 8.5)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
            Divider().overlay(Color.white.opacity(0.15))
            Text("Scoreboard").font(.system(size: 11, weight: .bold))
            HStack(spacing: 8) {
                score("Wins", model.wins, .green); score("Losses", model.losses, .red); score("Draws", model.draws, Theme.textSecondary)
            }
            Button("Reset") { model.resetScore() }.buttonStyle(MetalPlainStyle()).font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
        }
        .padding(8)
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func score(_ label: String, _ n: Int, _ color: Color) -> some View {
        VStack(spacing: 0) { Text("\(n)").font(.system(size: 13, weight: .bold, design: .rounded)).foregroundStyle(color); Text(label).font(.system(size: 8)).foregroundStyle(Theme.textSecondary) }
    }

    private func chipLabel(_ n: Int) -> some View {
        HStack(spacing: 3) { Circle().fill(Color.yellow).frame(width: 7, height: 7).overlay(Circle().stroke(.white.opacity(0.6), lineWidth: 1)); Text("\(n)").font(.system(size: 10, weight: .semibold, design: .rounded)).foregroundStyle(Theme.textSecondary) }
    }

    @ViewBuilder private func cards(_ cards: [PlayingCard], faceUp: Bool) -> some View {
        HStack(spacing: 3) {
            ForEach(cards) { card in PlayingCardView(card: card, width: cardWidth, faceUp: faceUp) }
            if cards.isEmpty { ForEach(0..<3, id: \.self) { _ in RoundedRectangle(cornerRadius: 4).stroke(Color.white.opacity(0.15)).frame(width: cardWidth, height: cardWidth * 1.4) } }
        }
    }
}

/// A small stack of poker chips that grows with the amount (up to eight chips), so the pot is visible at a glance.
struct ChipStack: View {
    let amount: Int
    private static let colors: [Color] = [.red, .blue, .green, .yellow, .purple, .orange, .pink, .teal]
    var body: some View {
        let n = amount == 0 ? 0 : min(8, max(1, Int((Double(amount) / 25).squareRoot().rounded(.up))))
        ZStack(alignment: .bottom) {
            ForEach(0..<n, id: \.self) { i in
                Ellipse().fill(Self.colors[i % Self.colors.count]).frame(width: 22, height: 8)
                    .overlay(Ellipse().stroke(.white.opacity(0.8), style: StrokeStyle(lineWidth: 1, dash: [2, 2])))
                    .offset(y: -CGFloat(i) * 2.5)
            }
        }
        .frame(width: 24, height: 26, alignment: .bottom)
    }
}
