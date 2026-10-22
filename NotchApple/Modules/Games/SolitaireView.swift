//
//  SolitaireView.swift
//  Notch Apple
//
//  Klondike Solitaire, draw one. Click a card (or a run of face-up cards), then click where it goes; double-click a
//  card to send it to a foundation; click the stock to turn a card, and again when it is empty to turn the waste back.
//

import SwiftUI

@MainActor
final class SolitaireModel: ObservableObject {
    enum Spot: Equatable { case waste, found(Int), tableau(Int, Int) }   // tableau(pile, index of the card)
    /// One game shared by the notch and the full-screen window, so you can carry on where you were.
    static let shared = SolitaireModel()
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
    @ObservedObject private var m = SolitaireModel.shared
    /// The width of a card: 42 in the notch, bigger in the full-screen window.
    var cardWidth: CGFloat = 42
    var showsFullScreenButton = true
    private var w: CGFloat { cardWidth }
    private var h: CGFloat { w * 1.4 }
    private var gap: CGFloat { max(5, w * 0.12) }

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
        VStack(spacing: max(6, w * 0.14)) {
            HStack(alignment: .top, spacing: gap) {
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
            HStack(alignment: .top, spacing: gap) {
                ForEach(0..<7, id: \.self) { p in pile(p) }
            }
            HStack(spacing: 10) {
                Text(m.s.won ? "You won in \(m.moves) moves!" : "Moves \(m.moves)").font(.system(size: max(11, w * 0.25))).foregroundStyle(Theme.textSecondary)
                Button("New game") { withAnimation(Theme.spring) { m.newGame() } }.buttonStyle(PurpleButtonStyle(prominent: false))
                if showsFullScreenButton {
                    Button { SolitaireWindow.open() } label: { Label("Full screen", systemImage: "arrow.up.left.and.arrow.down.right") }
                        .buttonStyle(PurpleButtonStyle(prominent: false)).help("Open Solitaire in a big window that fills the screen, with bigger cards")
                }
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

/// The full-screen game: the same cards, as big as the window allows.
struct SolitaireFullView: View {
    var body: some View {
        GeometryReader { g in
            // Seven columns across, and the tallest pile (a king's run of 13 face-up cards under 6 face-down ones) plus the top row down.
            let byWidth = (g.size.width - 80) / 7.6, byHeight = (g.size.height - 90) / (1.4 * 7.1)
            SolitaireView(cardWidth: max(42, min(byWidth, byHeight, 160)), showsFullScreenButton: false)
                .padding(.top, 24).frame(maxWidth: .infinity)
        }
        .background(Theme.backdrop)
        .preferredColorScheme(.dark)
    }
}

/// Opens Solitaire in its own window and puts it into macOS full screen (leave with the green button or Esc).
@MainActor
enum SolitaireWindow {
    private static var window: NSWindow?

    static func open() {
        if let window {
            window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
            if !window.styleMask.contains(.fullScreen) { window.toggleFullScreen(nil) }
            return
        }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 780),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        w.title = "Solitaire"
        w.isReleasedWhenClosed = false
        w.collectionBehavior = [.fullScreenPrimary]
        w.appearance = NSAppearance(named: .darkAqua)
        w.contentView = NSHostingView(rootView: SolitaireFullView())
        w.minSize = NSSize(width: 640, height: 520)
        w.center()
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { _ in
            MainActor.assumeIsolated { window = nil }
        }
        window = w
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
        w.toggleFullScreen(nil)
    }
}
