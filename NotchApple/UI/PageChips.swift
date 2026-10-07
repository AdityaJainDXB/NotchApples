//
//  PageChips.swift
//  Notch apple
//
//  A row of small pill buttons that switch between the pages inside a tab (Tools, Non-Necessities).
//

import SwiftUI

struct PageChips<Item: Identifiable & Equatable>: View {
    let items: [Item]
    let selected: Item?
    let title: KeyPath<Item, String>
    let symbol: KeyPath<Item, String>
    let choose: (Item) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(items) { item in
                    let on = item == selected
                    Button { choose(item) } label: {
                        Label(item[keyPath: title], systemImage: item[keyPath: symbol])
                            .font(.system(size: 11, weight: .semibold)).lineLimit(1)
                            .padding(.horizontal, 10).frame(height: 26)
                            .background(Capsule().fill(on ? AnyShapeStyle(Theme.accent.opacity(0.45)) : AnyShapeStyle(Theme.surface)))
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}
