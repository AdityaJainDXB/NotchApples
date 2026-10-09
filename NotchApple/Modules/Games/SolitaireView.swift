//
//  SolitaireView.swift
//  Notch apple
//
//  Klondike Solitaire, draw one. Click a card (or a run of face-up cards), then click where it goes; double-click a
//  card to send it to a foundation; click the stock to turn a card, and again when it is empty to turn the waste back.
//

import SwiftUI

@MainActor
final class SolitaireModel: ObservableObject {
    enum Spot: Equatable { case waste, found(Int), tableau(Int, Int) }   // tableau(pile, index of the card)
    @Published var s = Cards.solDeal(Cards.deck().shuffled())
    @Published var sel: Spot?
    @Published var moves = 0

    func newGame() { s = Cards.solDeal(Cards.deck().shuffled()); sel = nil; moves = 0 }

    private func cards(_ from: Spot) -> [PlayingCard] {
        switch from {
        case .waste: return s.waste.last.map { [$0] } ?? []
        case .found(let i): return s.found[i].last.map { [$0] } ?? []
        case .tableau(let p, let i): return i < s.tableau[p].count ? Array(s.tableau[p][i...]) : []
        }
    }
    private func take(_ from: Spot) {
        switch from {
        case .waste: s.waste.removeLast()
        case .found(let i): s.found[i].removeLast()
        case .tableau(let p, let i):
            s.tableau[p].removeSubrange(i...)
            if !s.tableau[p].isEmpty { s.tableau[p][s.tableau[p].count - 1].up = true }
        }
    }
    @discardableResult private func move(_ from: Spot, to: Spot) -> Bool {
        let c = cards(from); guard let first = c.first else { return false }
        switch to {
        case .tableau(let p, _):
            guard Cards.canPlaceTableau(first, on: s.tableau[p]) else { return false }
            take(from); s.tableau[p].append(contentsOf: c.map { var x = $0; x.up = true; return x })
        case .found(let i):
            guard c.count == 1, Cards.canPlaceFoundation(first, on: s.found[i]) else { return false }
            take(from); s.found[i].append(first)
        case .waste: return false
        }
        moves += 1; return true
    }
    func tap(_ spot: Spot) {
        if s.won { return }
        if let from = sel, from != spot {
            switch spot { case .tableau, .found: if move(from, to: spot) { sel = nil; return }; default: break }
        }
        if case .tableau(let p, let i) = spot, i >= 0, i < s.tableau[p].count, !s.tableau[p][i].up {
            if i == s.tableau[p].count - 1 { s.tableau[p][i].up = true }
            sel = nil; return
        }
        sel = (sel == spot || cards(spot).isEmpty) ? nil : spot
    }
    func auto(_ from: Spot) {
        guard cards(from).count == 1 else { return }
        for i in 0..<4 where move(from, to: .found(i)) { sel = nil; return }
    }
    func flipStock() {
        if let c = s.stock.popLast() { var x = c; x.up = true; s.waste.append(x) }
        else { s.stock = s.waste.reversed().map { var x = $0; x.up = false; return x }; s.waste = [] }
        sel = nil; moves += 1
    }
}

struct SolitaireView: View {
    @StateObject private var m = SolitaireModel()
    private let w: CGFloat = 42
    private var h: CGFloat { w * 1.4 }

    private func slot<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        content().frame(width: w, height: h)
            .background(RoundedRectangle(cornerRadius: 6).strokeBorder(.white.opacity(0.2), style: StrokeStyle(lineWidth: 1, dash: [3])))
    }
    private func selected(_ spot: SolitaireModel.Spot) -> Bool {
        guard let s = m.sel else { return false }
        if case .tableau(let p, let i) = spot, case .tableau(let sp, let si) = s { return p == sp && i >= si }
        return s == spot
    }

    var body: some View {
        VStack(spacing: 6) {
            HStack(alignment: .top, spacing: 5) {
                slot { if m.s.stock.isEmpty { Image(systemName: "arrow.counterclockwise").foregroundStyle(Theme.textSecondary) } else { PlayingCardView(card: m.s.stock[0], width: w, faceUp: false) } }
                    .contentShape(Rectangle()).onTapGesture { withAnimation(Theme.spring) { m.flipStock() } }
                    .accessibilityLabel("Stock").accessibilityAddTraits(.isButton)
                slot { if let c = m.s.waste.last { PlayingCardView(card: c, width: w).overlay(sel(.waste)).onTapGesture(count: 2) { withAnimation(Theme.spring) { m.auto(.waste) } } } }
                    .contentShape(Rectangle()).onTapGesture { withAnimation(Theme.spring) { m.tap(.waste) } }
                Spacer().frame(width: w)
                ForEach(0..<4, id: \.self) { i in
                    slot { if let c = m.s.found[i].last { PlayingCardView(card: c, width: w) } else { Image(systemName: Suit.allCases[i].symbol).foregroundStyle(.white.opacity(0.25)) } }
                        .contentShape(Rectangle()).onTapGesture { withAnimation(Theme.spring) { m.tap(.found(i)) } }
                }
            }
            HStack(alignment: .top, spacing: 5) {
                ForEach(0..<7, id: \.self) { p in pile(p) }
            }
            HStack(spacing: 10) {
                Text(m.s.won ? "You won in \(m.moves) moves!" : "Moves \(m.moves)").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                Button("New game") { withAnimation(Theme.spring) { m.newGame() } }.buttonStyle(PurpleButtonStyle(prominent: false))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private func sel(_ spot: SolitaireModel.Spot) -> some View {
        RoundedRectangle(cornerRadius: 6).strokeBorder(Theme.accentBright, lineWidth: selected(spot) ? 2 : 0)
    }

    private func pile(_ p: Int) -> some View {
        let cards = m.s.tableau[p]
        var offsets: [CGFloat] = [], y: CGFloat = 0
        for c in cards { offsets.append(y); y += c.up ? h * 0.3 : h * 0.12 }
        return ZStack(alignment: .top) {
            Color.clear.frame(width: w, height: h).contentShape(Rectangle())
                .onTapGesture { withAnimation(Theme.spring) { m.tap(.tableau(p, 0)) } }
            ForEach(Array(cards.enumerated()), id: \.element.id) { i, c in
                PlayingCardView(card: c, width: w, faceUp: c.up)
                    .overlay(sel(.tableau(p, i)))
                    .offset(y: offsets[i])
                    .onTapGesture(count: 2) { if i == cards.count - 1 { withAnimation(Theme.spring) { m.auto(.tableau(p, i)) } } }
                    .onTapGesture { withAnimation(Theme.spring) { m.tap(.tableau(p, i)) } }
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .frame(width: w, height: max(h, y + h * 0.7), alignment: .top)
    }
}
