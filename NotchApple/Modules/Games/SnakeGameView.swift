//
//  SnakeGameView.swift
//  Notch apple
//
//  The Snake board: one Canvas, redrawn only when the game ticks. Arrow keys or WASD steer, Space pauses.
//

import SwiftUI

struct SnakeGameView: View {
    @StateObject private var model = SnakeGameViewModel()

    var body: some View {
        let s = model.snapshot
        VStack(alignment: .leading, spacing: 6) {
            GameHeader(score: "Score \(s.score)", best: model.best) {
                Button(!s.alive ? "Play again" : !s.started ? "Start" : s.paused ? "Resume" : "Pause") { model.togglePause() }
                    .buttonStyle(PurpleButtonStyle(prominent: !s.started || s.paused || !s.alive))
            }
            Canvas { ctx, size in
                let cols = CGFloat(SnakeEngine.cols), rows = CGFloat(SnakeEngine.rows)
                let cell = min(size.width / cols, size.height / rows)
                let ox = (size.width - cell * cols) / 2
                let board = CGRect(x: ox, y: 0, width: cell * cols, height: cell * rows)
                ctx.fill(Path(roundedRect: board, cornerRadius: 8), with: .color(.white.opacity(0.05)))
                let food = CGRect(x: ox + CGFloat(s.food.x) * cell + cell * 0.1, y: CGFloat(s.food.y) * cell + cell * 0.1, width: cell * 0.8, height: cell * 0.8)
                ctx.fill(Path(ellipseIn: food), with: .color(.red))
                for (i, c) in s.body.enumerated() {
                    let r = CGRect(x: ox + CGFloat(c.x) * cell + 0.5, y: CGFloat(c.y) * cell + 0.5, width: cell - 1, height: cell - 1)
                    ctx.fill(Path(roundedRect: r, cornerRadius: cell * 0.25), with: .color(i == 0 ? Theme.accentBright : Theme.accent))
                }
            }
            .overlay {
                if !s.alive {
                    GameOverCard(title: "Game over · \(s.score)", detail: model.newBest ? "New best!" : "Best \(model.best)", button: "Play again") { model.restart() }
                } else if !s.started {
                    Text("Press an arrow key or Start")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                        .padding(8).background(.black.opacity(0.6), in: Capsule())
                }
            }
            .animation(.snappy(duration: 0.2), value: s.alive)
        }
        .onAppear { model.activate() }
        .onDisappear { model.deactivate() }
        .accessibilityLabel("Snake. Score \(s.score). Use the arrow keys.")
    }
}
