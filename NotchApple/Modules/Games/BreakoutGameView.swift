//
//  BreakoutGameView.swift
//  Notch apple
//
//  Breakout in the notch: the mouse (or ← → / A D) moves the paddle, click or Space launches the ball.
//  Three lives; each cleared wall is a new, faster level. High score is kept on this Mac.
//  The ball moves on a 120 Hz background loop; the board is one Canvas redrawn from a snapshot.
//

import AppKit
import SwiftUI

@MainActor
final class BreakoutModel: ObservableObject {
    @Published private(set) var snapshot = BreakoutModel.snap(BreakoutEngine())
    @Published private(set) var best = UserDefaults.standard.integer(forKey: "games.breakout.best")
    @Published private(set) var newBest = false

    struct Snap: Equatable {
        var bricks: [BreakoutEngine.Brick]
        var paddleX: CGFloat
        var ball: CGPoint
        var score: Int, lives: Int, level: Int
        var launched: Bool, over: Bool
    }

    private let engine = Locked(BreakoutEngine())
    private let heldDirection = Locked<CGFloat>(0)     // -1 left, +1 right (keys)
    private let loop = GameLoop()
    private let keys = GameKeyMonitor()
    private let dirty = Locked(false)

    nonisolated static func snap(_ e: BreakoutEngine) -> Snap {
        Snap(bricks: e.bricks, paddleX: e.paddleX, ball: e.ball, score: e.score, lives: e.lives, level: e.level, launched: e.launched, over: e.over)
    }

    func activate() {
        keys.start { [weak self] event, isDown in
            guard let self else { return false }
            return MainActor.assumeIsolated { self.handle(event, isDown: isDown) }
        }
        loop.start(hz: 120) { [weak self] dt in self?.tick(dt) }
    }

    func deactivate() {
        keys.stop()
        loop.stop()
        heldDirection.set(0)
    }

    private func handle(_ event: NSEvent, isDown: Bool) -> Bool {
        switch event.keyCode {
        case 123: heldDirection.set(isDown ? -1 : 0); return true               // ←
        case 124: heldDirection.set(isDown ? 1 : 0); return true                // →
        case 49: if isDown { launchOrRestart() }; return true                    // space
        default:
            switch event.charactersIgnoringModifiers?.lowercased() {
            case "a": heldDirection.set(isDown ? -1 : 0); return true
            case "d": heldDirection.set(isDown ? 1 : 0); return true
            default: return false
            }
        }
    }

    /// Pointer position in field units (0…360).
    func movePaddle(to x: CGFloat) { engine.with { $0.movePaddle(to: x) }; dirty.set(true) }

    func launchOrRestart() {
        if engine.get().over { restart() } else { engine.with { $0.launch() }; dirty.set(true) }
    }

    func restart() {
        engine.with { $0.restart() }
        newBest = false
        dirty.set(true)
    }

    // MARK: Background tick

    private nonisolated func tick(_ dt: Double) {
        let held = heldDirection.get()
        let events: [BreakoutEngine.Event] = engine.with { e in
            if held != 0 { e.nudgePaddle(held * 300 * CGFloat(min(dt, 0.05))) }
            return e.step(dt)
        }
        let launchedOrMoving = engine.get()
        if events.isEmpty && !dirty.get() && !launchedOrMoving.launched && held == 0 { return }
        dirty.set(false)
        let next = Self.snap(launchedOrMoving)
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                for ev in events { self.sound(for: ev) }
                if events.contains(.gameOver) { self.finish(score: next.score) }
                if next != self.snapshot { self.snapshot = next }
            }
        }
    }

    private func sound(for e: BreakoutEngine.Event) {
        switch e {
        case .brick: GameSound.play("Tink")
        case .paddle: GameSound.play("Pop")
        case .wall: break
        case .lifeLost: GameSound.play("Funk")
        case .levelCleared: GameSound.play("Glass")
        case .gameOver: GameSound.play("Basso")
        }
    }

    private func finish(score: Int) {
        if score > best {
            best = score
            newBest = true
            UserDefaults.standard.set(score, forKey: "games.breakout.best")
        }
    }
}

struct BreakoutGameView: View {
    @StateObject private var model = BreakoutModel()

    private static let rowColors: [Color] = [.red, .orange, .yellow, .green, .cyan]

    var body: some View {
        let s = model.snapshot
        VStack(alignment: .leading, spacing: 6) {
            GameHeader(score: "Score \(s.score)", best: model.best) {
                HStack(spacing: 8) {
                    Text("Level \(s.level)").font(.system(size: 11).monospacedDigit()).foregroundStyle(Theme.textSecondary)
                    HStack(spacing: 3) {
                        ForEach(0..<3, id: \.self) { i in
                            Image(systemName: "heart.fill").font(.system(size: 10)).foregroundStyle(i < s.lives ? Color.red : Color.white.opacity(0.15))
                        }
                    }
                    Button(s.over ? "Play again" : s.launched ? "Restart" : "Launch") { s.launched && !s.over ? model.restart() : model.launchOrRestart() }
                        .buttonStyle(PurpleButtonStyle(prominent: !s.launched))
                }
            }
            GeometryReader { geo in
                let scale = min(geo.size.width / BreakoutEngine.width, geo.size.height / BreakoutEngine.height)
                let ox = (geo.size.width - BreakoutEngine.width * scale) / 2
                Canvas { ctx, _ in
                    ctx.translateBy(x: ox, y: 0)
                    ctx.scaleBy(x: scale, y: scale)
                    ctx.fill(Path(roundedRect: CGRect(x: 0, y: 0, width: BreakoutEngine.width, height: BreakoutEngine.height), cornerRadius: 10), with: .color(.white.opacity(0.05)))
                    for b in s.bricks {
                        ctx.fill(Path(roundedRect: b.rect, cornerRadius: 3), with: .color(Self.rowColors[b.row % Self.rowColors.count].opacity(0.9)))
                    }
                    let paddle = CGRect(x: s.paddleX - BreakoutEngine.paddleWidth / 2, y: BreakoutEngine.paddleY, width: BreakoutEngine.paddleWidth, height: BreakoutEngine.paddleHeight)
                    ctx.fill(Path(roundedRect: paddle, cornerRadius: 4), with: .color(Theme.accentBright))
                    let r = BreakoutEngine.radius
                    ctx.fill(Path(ellipseIn: CGRect(x: s.ball.x - r, y: s.ball.y - r, width: r * 2, height: r * 2)), with: .color(.white))
                }
                .contentShape(Rectangle())
                .onContinuousHover { phase in
                    if case .active(let p) = phase { model.movePaddle(to: (p.x - ox) / scale) }
                }
                .onTapGesture { model.launchOrRestart() }
                .overlay {
                    if s.over {
                        GameOverCard(title: "Game over · \(s.score)", detail: model.newBest ? "New best!" : "Best \(model.best)", button: "Play again") { model.restart() }
                    } else if !s.launched {
                        Text(s.level == 1 && s.score == 0 ? "Move the mouse · click or press Space to launch" : "Level \(s.level) · click to launch")
                            .font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                            .padding(7).background(.black.opacity(0.55), in: Capsule())
                            .offset(y: 30)
                    }
                }
                .animation(.snappy(duration: 0.2), value: s.over)
            }
        }
        .onAppear { model.activate() }
        .onDisappear { model.deactivate() }
        .accessibilityLabel("Breakout. Score \(s.score), \(s.lives) lives. Move the mouse or use the arrow keys.")
    }
}
