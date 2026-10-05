//
//  MemoryGameView.swift
//  Notch apple
//
//  Memory pattern matcher (Simon): four coloured pads light up in a pattern; repeat it by clicking the pads
//  or with the arrow keys. Each round adds one more light. Your best round is kept on this Mac.
//

import AppKit
import SwiftUI

@MainActor
final class MemoryModel: ObservableObject {
    enum Phase: Equatable { case idle, showing, input, over }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var lit: Int?
    @Published private(set) var round = 0
    @Published private(set) var best = UserDefaults.standard.integer(forKey: "games.memory.best")
    @Published private(set) var newBest = false
    @Published private(set) var message = "Watch the lights, then repeat them."

    private var engine = MemoryEngine()
    private var task: Task<Void, Never>?
    private let keys = GameKeyMonitor()

    /// Each pad has its own colour and sound.
    static let sounds = ["Tink", "Pop", "Glass", "Ping"]

    func activate() {
        keys.start { [weak self] event, isDown in
            guard let self, isDown else { return false }
            return MainActor.assumeIsolated { self.handle(event) }
        }
    }

    func deactivate() {
        keys.stop()
        task?.cancel()
        task = nil
        if phase == .showing { phase = .idle }
        lit = nil
    }

    private func handle(_ event: NSEvent) -> Bool {
        switch event.keyCode {
        case 126: press(0); return true     // ↑
        case 124: press(1); return true     // →
        case 125: press(2); return true     // ↓
        case 123: press(3); return true     // ←
        case 49: if phase == .idle || phase == .over { start() }; return true
        default: return false
        }
    }

    func start() {
        engine.reset()
        round = 0
        newBest = false
        nextRound()
    }

    private func nextRound() {
        engine.nextRound()
        round = engine.round
        phase = .showing
        message = "Watch…"
        task?.cancel()
        task = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard let self else { return }
            for pad in self.engine.sequence {
                if Task.isCancelled { return }
                self.flash(pad)
                try? await Task.sleep(for: .milliseconds(Int(max(260, 520 - Double(self.round) * 18))))
                self.lit = nil
                try? await Task.sleep(for: .milliseconds(140))
            }
            if Task.isCancelled { return }
            self.phase = .input
            self.message = "Your turn"
        }
    }

    private func flash(_ pad: Int) {
        withAnimation(.spring(response: 0.18, dampingFraction: 0.6)) { lit = pad }
        GameSound.play(Self.sounds[pad])
    }

    func press(_ pad: Int) {
        guard phase == .input else { return }
        flash(pad)
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(160))
            withAnimation(.easeOut(duration: 0.15)) { self?.lit = nil }
        }
        switch engine.press(pad) {
        case .correct:
            break
        case .roundComplete:
            phase = .showing
            message = "Nice!"
            task?.cancel()
            task = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(650))
                guard !Task.isCancelled else { return }
                self?.nextRound()
            }
        case .wrong:
            GameSound.play("Basso")
            let score = engine.score
            if score > best { best = score; newBest = true; UserDefaults.standard.set(score, forKey: "games.memory.best") }
            phase = .over
            message = "Wrong pad"
        }
    }

    var score: Int { phase == .over ? engine.score : max(0, round - 1) }
}

struct MemoryGameView: View {
    @StateObject private var model = MemoryModel()

    private static let colors: [Color] = [.red, .blue, .green, .yellow]
    private static let symbols = ["arrow.up", "arrow.right", "arrow.down", "arrow.left"]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            GameHeader(score: model.phase == .idle ? "Round 0" : "Round \(model.round)", best: model.best) {
                Button(model.phase == .idle ? "Start" : model.phase == .over ? "Play again" : "Restart") { model.start() }
                    .buttonStyle(PurpleButtonStyle(prominent: model.phase == .idle || model.phase == .over))
            }
            ZStack {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    // Order on screen is the arrow layout: up/right on the top row, left/down below.
                    ForEach([0, 1, 3, 2], id: \.self) { pad in padView(pad) }
                }
                .opacity(model.phase == .over ? 0.35 : 1)
                if model.phase == .over {
                    GameOverCard(title: "Game over · \(model.score)", detail: model.newBest ? "New best!" : "Best \(model.best)", button: "Play again") { model.start() }
                }
            }
            .animation(.snappy(duration: 0.2), value: model.phase)
            Text(model.message).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).frame(maxWidth: .infinity)
        }
        .onAppear { model.activate() }
        .onDisappear { model.deactivate() }
        .accessibilityLabel("Memory pattern game. Round \(model.round).")
    }

    private func padView(_ pad: Int) -> some View {
        let on = model.lit == pad
        return Button { model.press(pad) } label: {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Self.colors[pad].opacity(on ? 1 : 0.35))
                .overlay(Image(systemName: Self.symbols[pad]).font(.system(size: 18, weight: .bold)).foregroundStyle(.white.opacity(on ? 1 : 0.5)))
                .shadow(color: Self.colors[pad].opacity(on ? 0.8 : 0), radius: on ? 14 : 0)
                .scaleEffect(on ? 1.04 : 1)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .buttonStyle(.plain)
        .disabled(model.phase != .input)
        .accessibilityLabel(["Up", "Right", "Down", "Left"][pad] + " pad")
    }
}
