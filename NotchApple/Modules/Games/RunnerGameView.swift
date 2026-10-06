//
//  RunnerGameView.swift
//  Notch apple
//
//  Arcade runner (a small Geometry Dash-style game): the cube runs on its own; Space, ↑, W or a click jumps over
//  the spikes and blocks. It speeds up the longer you last. Your best distance is kept on this Mac.
//  The rules live in RunnerEngine (GameEngines.swift); this file is the loop, the keys and the drawing.
//

import AppKit
import SwiftUI

@MainActor
final class RunnerModel: ObservableObject {
    struct Snap: Equatable {
        var obstacles: [RunnerEngine.Obstacle]
        var playerY: CGFloat
        var rotation: CGFloat
        var score: Int
        var over: Bool
        var started: Bool
        var distance: CGFloat
    }

    @Published private(set) var snapshot = RunnerModel.snap(RunnerEngine())
    @Published private(set) var best = UserDefaults.standard.integer(forKey: "games.runner.best")
    @Published private(set) var newBest = false

    private let engine = Locked(RunnerEngine())
    private let loop = GameLoop()
    private let keys = GameKeyMonitor()

    nonisolated static func snap(_ e: RunnerEngine) -> Snap {
        Snap(obstacles: e.obstacles, playerY: e.playerY, rotation: e.rotation, score: e.score, over: e.over, started: e.started, distance: e.distance)
    }

    func activate() {
        keys.start { [weak self] event, isDown in
            guard let self, isDown else { return false }
            return MainActor.assumeIsolated { self.handle(event) }
        }
        loop.start(hz: 90) { [weak self] dt in self?.tick(dt) }
    }

    func deactivate() {
        keys.stop()
        loop.stop()
    }

    private func handle(_ event: NSEvent) -> Bool {
        if event.keyCode == 49 || event.keyCode == 126 { jumpOrRestart(); return true }       // space, ↑
        if event.charactersIgnoringModifiers?.lowercased() == "w" { jumpOrRestart(); return true }
        return false
    }

    func jumpOrRestart() {
        if engine.get().over { restart(); return }
        if engine.with({ $0.jump() }) == .jumped { GameSound.play("Tink") }
    }

    func restart() {
        engine.with { $0.restart() }
        newBest = false
    }

    private nonisolated func tick(_ dt: Double) {
        let state = engine.get()
        guard state.started, !state.over else { return }
        let event = engine.with { $0.step(dt) }
        let next = Self.snap(engine.get())
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                if event == .died { self.finish(score: next.score) }
                if next != self.snapshot { self.snapshot = next }
            }
        }
    }

    private func finish(score: Int) {
        GameSound.play("Basso")
        if score > best {
            best = score
            newBest = true
            UserDefaults.standard.set(score, forKey: "games.runner.best")
        }
    }
}

struct RunnerGameView: View {
    @StateObject private var model = RunnerModel()

    var body: some View {
        let s = model.snapshot
        VStack(alignment: .leading, spacing: 6) {
            GameHeader(score: "Score \(s.score)", best: model.best) {
                Button(s.over ? "Play again" : s.started ? "Restart" : "Start") { s.started && !s.over ? model.restart() : model.jumpOrRestart() }
                    .buttonStyle(PurpleButtonStyle(prominent: !s.started || s.over))
            }
            Canvas { ctx, size in draw(ctx, size, s) }
                .contentShape(Rectangle())
                .onTapGesture { model.jumpOrRestart() }
                .overlay {
                    if s.over {
                        GameOverCard(title: "Crashed · \(s.score)", detail: model.newBest ? "New best!" : "Best \(model.best)", button: "Play again") { model.restart() }
                    } else if !s.started {
                        Text("Press Space or click to jump")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                            .padding(8).background(.black.opacity(0.6), in: Capsule())
                    }
                }
                .animation(.snappy(duration: 0.2), value: s.over)
        }
        .onAppear { model.activate() }
        .onDisappear { model.deactivate() }
        .accessibilityLabel("Runner. Score \(s.score). Press space to jump.")
    }

    /// The field is 360×180 units, scaled to fit.
    private func draw(_ ctx: GraphicsContext, _ size: CGSize, _ s: RunnerModel.Snap) {
        let scale = min(size.width / RunnerEngine.width, size.height / RunnerEngine.height)
        let ox = (size.width - RunnerEngine.width * scale) / 2
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * scale, y: y * scale) }
        func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect { CGRect(x: ox + x * scale, y: y * scale, width: w * scale, height: h * scale) }

        ctx.fill(Path(roundedRect: rect(0, 0, RunnerEngine.width, RunnerEngine.height), cornerRadius: 8 * scale), with: .color(.white.opacity(0.05)))
        // Background stripes drift to show speed.
        let drift = s.distance.truncatingRemainder(dividingBy: 60)
        for i in -1..<8 {
            let x = CGFloat(i) * 60 - drift * 0.4
            ctx.fill(Path(rect(x, 20, 2, RunnerEngine.groundY - 20)), with: .color(.white.opacity(0.04)))
        }
        // Floor.
        ctx.fill(Path(rect(0, RunnerEngine.groundY, RunnerEngine.width, RunnerEngine.height - RunnerEngine.groundY)), with: .color(Theme.accent.opacity(0.35)))
        ctx.fill(Path(rect(0, RunnerEngine.groundY, RunnerEngine.width, 2)), with: .color(Theme.accentBright))

        // Obstacles.
        for o in s.obstacles {
            switch o.kind {
            case .block:
                ctx.fill(Path(roundedRect: rect(o.x, RunnerEngine.groundY - o.height, o.width, o.height), cornerRadius: 3 * scale), with: .color(.pink))
            case .spike, .doubleSpike:
                let count = o.kind == .doubleSpike ? 2 : 1
                let each = o.width / CGFloat(count)
                for k in 0..<count {
                    let x = o.x + CGFloat(k) * each
                    var path = Path()
                    path.move(to: pt(x, RunnerEngine.groundY))
                    path.addLine(to: pt(x + each / 2, RunnerEngine.groundY - o.height))
                    path.addLine(to: pt(x + each, RunnerEngine.groundY))
                    path.closeSubpath()
                    ctx.fill(path, with: .color(.red))
                }
            }
        }

        // The cube, spinning while it is in the air.
        let c = pt(RunnerEngine.playerX + RunnerEngine.playerSize / 2, s.playerY + RunnerEngine.playerSize / 2)
        var cube = ctx
        cube.translateBy(x: c.x, y: c.y)
        cube.rotate(by: .degrees(Double(s.rotation)))
        let side = RunnerEngine.playerSize * scale
        let body = CGRect(x: -side / 2, y: -side / 2, width: side, height: side)
        cube.addFilter(.shadow(color: Theme.accentBright.opacity(0.8), radius: 6))
        cube.fill(Path(roundedRect: body, cornerRadius: 4 * scale), with: .color(Theme.accentBright))
        cube.stroke(Path(roundedRect: body.insetBy(dx: 4 * scale, dy: 4 * scale), cornerRadius: 2 * scale), with: .color(.white.opacity(0.85)), lineWidth: 1.5)
    }
}
