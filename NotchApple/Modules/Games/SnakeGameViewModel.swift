//
//  SnakeGameViewModel.swift
//  Notch apple
//
//  Snake without the lag. The old version overwrote one "next direction" per tick, so two quick
//  taps lost the first, and it redrew every segment as a SwiftUI view on the main thread.
//
//   • Taps go into a small FIFO queue (SnakeEngine: up to 2 turns per tick), read straight from
//     NSEvent.addLocalMonitorForEvents(.keyDown), so nothing waits on SwiftUI focus.
//   • The game ticks on a background timer; only a finished snapshot is handed to the main thread.
//   • The board is one Canvas (SnakeGameView), not a view per cell.
//

import AppKit
import SwiftUI

@MainActor
final class SnakeGameViewModel: ObservableObject {
    struct Snapshot: Equatable {
        var body: [SnakeEngine.Cell]
        var food: SnakeEngine.Cell
        var alive: Bool
        var started: Bool
        var paused: Bool
        var score: Int
    }

    @Published private(set) var snapshot: Snapshot
    @Published private(set) var best: Int = UserDefaults.standard.integer(forKey: "games.snake.best")
    @Published private(set) var newBest = false

    private let state = Locked(SnakeEngine())
    private let pausedFlag = Locked(true)
    private let loop = GameLoop()
    private let keys = GameKeyMonitor()
    private static let tickRate = 9.0   // moves per second (about 0.11 s each), as before

    init() {
        let e = SnakeEngine()
        snapshot = Snapshot(body: e.body, food: e.food, alive: true, started: false, paused: false, score: 0)
    }

    // MARK: Lifecycle (only while the tab is on screen)

    func activate() {
        keys.start { [weak self] event, isDown in
            guard let self, isDown else { return false }
            return MainActor.assumeIsolated { self.handle(event) }
        }
        loop.start(hz: Self.tickRate) { [weak self] _ in self?.tick() }
    }

    func deactivate() {
        keys.stop()
        loop.stop()
        pausedFlag.set(true)
        publish()
    }

    // MARK: Input

    private func handle(_ event: NSEvent) -> Bool {
        if event.keyCode == 49 { togglePause(); return true }             // space
        guard let d = SnakeEngine.Direction(event: event) else { return false }
        turn(d)
        return true
    }

    func turn(_ d: SnakeEngine.Direction) {
        if !state.with({ $0.alive }) { restart() }
        pausedFlag.set(false)
        state.with { $0.enqueue(d) }
        publish()
    }

    func togglePause() {
        let e = state.get()
        if !e.alive { restart(); return }
        if !e.started { state.with { $0.start() }; pausedFlag.set(false) } else { pausedFlag.set(!pausedFlag.get()) }
        publish()
    }

    func restart() {
        state.with { $0 = SnakeEngine(); $0.start() }
        pausedFlag.set(false)
        newBest = false
        publish()
    }

    // MARK: Ticking (background queue)

    private nonisolated func tick() {
        guard !pausedFlag.get() else { return }
        let event = state.with { $0.step() }
        guard event != .idle else { return }
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                switch event {
                case .ate: GameSound.play("Pop")
                case .died, .won: self.finish()
                default: break
                }
                self.publish()
            }
        }
    }

    private func finish() {
        GameSound.play("Basso")
        let score = state.get().score
        if score > best {
            best = score
            newBest = true
            UserDefaults.standard.set(score, forKey: "games.snake.best")
        }
    }

    private func publish() {
        let e = state.get()
        let next = Snapshot(body: e.body, food: e.food, alive: e.alive, started: e.started, paused: pausedFlag.get(), score: e.score)
        if next != snapshot { snapshot = next }
    }
}
