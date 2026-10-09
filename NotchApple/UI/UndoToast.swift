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
    static let duration: Double = 5
    struct Offer: Identifiable { let id = UUID(); let message: String; let undo: () -> Void }
    @Published private(set) var current: Offer?
    private var work: DispatchWorkItem?

    func offer(_ message: String, undo: @escaping () -> Void) {
        work?.cancel()
        current = Offer(message: message, undo: undo)
        let w = DispatchWorkItem { [weak self] in self?.current = nil }
        work = w
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.duration, execute: w)
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
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).accessibilityHidden(true)
                Text(offer.message).font(.system(size: 12, weight: .medium)).foregroundStyle(.white)
                UndoCountdownButton(id: offer.id) { withAnimation(Theme.spring) { center.undo() } }
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

/// "Undo" with a fill that drains over the time left to undo.
private struct UndoCountdownButton: View {
    let id: UUID
    let action: () -> Void
    @State private var left: CGFloat = 1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var content: some View {
        Label("Undo", systemImage: "arrow.counterclockwise").font(.system(size: 12, weight: .bold)).padding(.horizontal, 10).padding(.vertical, 4)
    }

    var body: some View {
        Button(action: action) {
            content.foregroundStyle(Theme.accentBright)
                .background(Capsule().fill(Color.white.opacity(0.08)))
                .overlay(alignment: .leading) {
                    content.foregroundStyle(.black).background(Capsule().fill(Theme.accentBright))
                        .mask(alignment: .leading) { GeometryReader { g in Rectangle().frame(width: g.size.width * left) } }
                }
        }
        .buttonStyle(.plain)
        .id(id)
        .onAppear { left = 1; withAnimation(reduceMotion ? nil : .linear(duration: UndoCenter.duration)) { left = 0 } }
    }
}
