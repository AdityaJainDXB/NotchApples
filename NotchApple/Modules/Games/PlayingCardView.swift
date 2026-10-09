//
//  PlayingCardView.swift
//  Notch apple
//
//  A playing card in the classic 5:7 shape with corner indices and the traditional pip layouts, and a fanned hand
//  whose hovered card lifts. Court cards show a framed letter and the suit.
//

import SwiftUI

struct PlayingCardView: View {
    let card: PlayingCard
    var width: CGFloat = 52
    var faceUp = true

    private static let pips: [String: [(x: CGFloat, y: CGFloat, flip: Bool)]] = {
        let l: CGFloat = 0, c: CGFloat = 0.5, r: CGFloat = 1
        return [
            "2": [(c, 0, false), (c, 1, true)], "3": [(c, 0, false), (c, 0.5, false), (c, 1, true)],
            "4": [(l, 0, false), (r, 0, false), (l, 1, true), (r, 1, true)],
            "5": [(l, 0, false), (r, 0, false), (c, 0.5, false), (l, 1, true), (r, 1, true)],
            "6": [(l, 0, false), (r, 0, false), (l, 0.5, false), (r, 0.5, false), (l, 1, true), (r, 1, true)],
            "7": [(l, 0, false), (r, 0, false), (c, 0.25, false), (l, 0.5, false), (r, 0.5, false), (l, 1, true), (r, 1, true)],
            "8": [(l, 0, false), (r, 0, false), (c, 0.25, false), (l, 0.5, false), (r, 0.5, false), (c, 0.75, true), (l, 1, true), (r, 1, true)],
            "9": [(l, 0, false), (r, 0, false), (l, 0.333, false), (r, 0.333, false), (c, 0.5, false), (l, 0.667, true), (r, 0.667, true), (l, 1, true), (r, 1, true)],
            "10": [(l, 0, false), (r, 0, false), (c, 0.167, false), (l, 0.333, false), (r, 0.333, false), (l, 0.667, true), (r, 0.667, true), (c, 0.833, true), (l, 1, true), (r, 1, true)],
        ]
    }()

    private var ink: Color { card.suit.isRed ? Color(red: 0.76, green: 0.18, blue: 0.18) : Color(red: 0.14, green: 0.15, blue: 0.18) }
    private var u: CGFloat { width / 14 }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: u * 0.9).fill(faceUp ? Color.white : Color(red: 0.62, green: 0.17, blue: 0.21))
            if faceUp { face } else { back }
            RoundedRectangle(cornerRadius: u * 0.9).strokeBorder(.black.opacity(0.14))
        }
        .frame(width: width, height: width * 1.4)
        .shadow(color: .black.opacity(0.25), radius: 3, y: 1.5)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(faceUp ? "\(card.rank) of \(card.suit.rawValue)" : "Face-down card")
    }

    private var back: some View {
        RoundedRectangle(cornerRadius: u * 0.5).strokeBorder(.white.opacity(0.4)).padding(u * 0.55)
            .overlay { Image(systemName: "seal.fill").font(.system(size: u * 3)).foregroundStyle(.white.opacity(0.18)) }
    }

    private func corner(flipped: Bool) -> some View {
        VStack(spacing: u * 0.2) {
            Text(card.rank).font(.system(size: u * 1.55, weight: .bold)).minimumScaleFactor(0.6)
            Image(systemName: card.suit.symbol).font(.system(size: u * 1.05))
        }
        .foregroundStyle(ink)
        .rotationEffect(.degrees(flipped ? 180 : 0))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: flipped ? .bottomTrailing : .topLeading)
        .padding(.leading, u * 0.65).padding(.trailing, u * 0.65).padding(.vertical, u * 0.6)
    }

    private var face: some View {
        ZStack {
            corner(flipped: false); corner(flipped: true)
            if card.rank == "A" {
                Image(systemName: card.suit.symbol).font(.system(size: u * 4.6)).foregroundStyle(ink)
            } else if ["J", "Q", "K"].contains(card.rank) {
                VStack(spacing: u * 0.3) {
                    Text(card.rank).font(.system(size: u * 3.2, weight: .bold, design: .serif))
                    Image(systemName: card.suit.symbol).font(.system(size: u * 2.2))
                }
                .foregroundStyle(ink)
                .frame(width: width * 0.52, height: width * 1.4 * 0.68)
                .background(RoundedRectangle(cornerRadius: u * 0.4).fill(ink.opacity(0.06)))
                .overlay(RoundedRectangle(cornerRadius: u * 0.4).strokeBorder(ink.opacity(0.5)))
            } else if let layout = Self.pips[card.rank] {
                GeometryReader { g in
                    let w = width * 0.52, h = width * 1.4 * 0.7
                    ZStack {
                        ForEach(Array(layout.enumerated()), id: \.offset) { _, p in
                            Image(systemName: card.suit.symbol).font(.system(size: u * 2.1)).foregroundStyle(ink)
                                .rotationEffect(.degrees(p.flip ? 180 : 0))
                                .position(x: g.size.width / 2 - w / 2 + p.x * w, y: g.size.height / 2 - h / 2 + p.y * h)
                        }
                    }
                }
            }
        }
    }
}

/// A hand drawn as a fan: cards spread in an arc and the hovered one lifts. `hideFrom` turns cards from that index face down.
struct CardFanView: View {
    let cards: [PlayingCard]
    var width: CGFloat = 52
    var hideFrom: Int? = nil
    @State private var hovered: String?

    var body: some View {
        let n = cards.count, step = n > 1 ? min(9, 40 / Double(n - 1)) : 0, space: CGFloat = n > 5 ? 28 : 34
        ZStack {
            ForEach(Array(cards.enumerated()), id: \.element.id) { i, c in
                let off = Double(i) - Double(n - 1) / 2, rot = off * step, on = hovered == c.id
                PlayingCardView(card: c, width: width, faceUp: hideFrom.map { i < $0 } ?? true)
                    .rotationEffect(.degrees(on ? rot * 0.3 : rot))
                    .offset(x: CGFloat(off) * space, y: on ? -12 : CGFloat(abs(rot)) * 1.4)
                    .scaleEffect(on ? 1.06 : 1)
                    .zIndex(on ? 100 : Double(i))
                    .onHover { inside in hovered = inside ? c.id : (hovered == c.id ? nil : hovered) }
                    .animation(.interpolatingSpring(stiffness: 340, damping: 30), value: on)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .frame(width: max(width, CGFloat(max(n - 1, 0)) * space + width + 16), height: width * 1.4 + 20)
        .animation(.interpolatingSpring(stiffness: 280, damping: 26), value: n)
    }
}
