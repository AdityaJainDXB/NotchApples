//
//  UndoToast.swift
//  Notch apple
//
//  Undo for destructive actions: deleting a note, to-do, clipboard item, shelf
//  file or Home widget shows "Deleted · Undo" at the bottom of the notch for
//  six seconds. ⌘Z works too while it's showing. No confirmation dialogs.
//

import SwiftUI

@MainActor
final class UndoCenter: ObservableObject {
    static let shared = UndoCenter()
    struct Offer: Identifiable { let id = UUID(); let message: String; let undo: () -> Void }
    @Published private(set) var current: Offer?
    private var work: DispatchWorkItem?

    func offer(_ message: String, undo: @escaping () -> Void) {
        work?.cancel()
        current = Offer(message: message, undo: undo)
        let w = DispatchWorkItem { [weak self] in self?.current = nil }
        work = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 6, execute: w)
    }

    func undo() {
        guard let c = current else { return }
        c.undo()
        current = nil
    }
}

struct UndoToast: View {
    @ObservedObject private var center = UndoCenter.shared

    var body: some View {
        if let offer = center.current {
            HStack(spacing: 12) {
                Text(offer.message).font(.system(size: 12, weight: .medium)).foregroundStyle(.white)
                Button("Undo") { withAnimation(Theme.spring) { center.undo() } }
                    .buttonStyle(.plain).font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.accentBright)
                    .keyboardShortcut("z", modifiers: .command)
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(.black.opacity(0.85), in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.separator))
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
        }
    }
}
