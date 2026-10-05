//
//  GameSupport.swift
//  Notch apple
//
//  Shared by the mini-games: sound effects (one switch for all, in the Games sidebar), a steady
//  background game loop that doesn't block the UI thread, and a key monitor that reads key presses
//  straight from AppKit, so fast taps are never lost to SwiftUI focus.
//

import AppKit
import SwiftUI

enum GameSound {
    static let key = "games.sound"
    static var enabled: Bool { UserDefaults.standard.object(forKey: key) as? Bool ?? true }

    /// A short macOS system sound ("Tink", "Pop", "Glass", "Basso", "Funk", "Ping").
    @MainActor static func play(_ name: String) {
        guard enabled, let s = NSSound(named: name) else { return }
        s.volume = 0.4
        s.stop()
        s.play()
    }
}

/// Calls `tick(dt)` at a fixed rate from a background queue, so game logic never waits on drawing
/// and drawing never waits on game logic.
final class GameLoop: @unchecked Sendable {
    private let queue = DispatchQueue(label: "notchapple.game", qos: .userInteractive)
    private var timer: DispatchSourceTimer?
    private var last = DispatchTime.now()

    func start(hz: Double, tick: @escaping @Sendable (Double) -> Void) {
        stop()
        let t = DispatchSource.makeTimerSource(queue: queue)
        last = .now()
        t.schedule(deadline: .now(), repeating: 1.0 / hz, leeway: .milliseconds(1))
        t.setEventHandler { [weak self] in
            guard let self else { return }
            let now = DispatchTime.now()
            let dt = Double(now.uptimeNanoseconds - self.last.uptimeNanoseconds) / 1_000_000_000
            self.last = now
            tick(dt)
        }
        timer = t
        t.resume()
    }

    func stop() {
        timer?.cancel()
        timer = nil
    }

    deinit { stop() }
}

/// Reads keys with `NSEvent.addLocalMonitorForEvents`, only while a game is on screen and the notch panel
/// is the window receiving them. Returning nil for handled keys also stops the system alert beep.
@MainActor
final class GameKeyMonitor {
    private var monitor: Any?

    /// `handler(event, isDown)` returns true when it used the key.
    func start(_ handler: @escaping (NSEvent, Bool) -> Bool) {
        stop()
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { event in
            guard event.window is NSPanel else { return event }
            if !event.modifierFlags.intersection([.command, .control, .option]).isEmpty { return event }
            return handler(event, event.type == .keyDown) ? nil : event
        }
    }

    func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }

    deinit { if let monitor { NSEvent.removeMonitor(monitor) } }
}

extension SnakeEngine.Direction {
    /// Arrow keys and WASD.
    init?(event: NSEvent) {
        switch event.keyCode {
        case 126: self = .up
        case 125: self = .down
        case 123: self = .left
        case 124: self = .right
        default:
            switch event.charactersIgnoringModifiers?.lowercased() {
            case "w": self = .up
            case "s": self = .down
            case "a": self = .left
            case "d": self = .right
            default: return nil
            }
        }
    }
}

/// A value shared between the game thread and the main thread.
final class Locked<Value>: @unchecked Sendable {
    private var value: Value
    private let lock = NSLock()
    init(_ value: Value) { self.value = value }
    @discardableResult func with<R>(_ body: (inout Value) -> R) -> R { lock.lock(); defer { lock.unlock() }; return body(&value) }
    func get() -> Value { with { $0 } }
    func set(_ v: Value) { with { $0 = v } }
}

/// The header every game shares: score, best, and the buttons.
struct GameHeader<Trailing: View>: View {
    let score: String
    let best: Int
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack {
            Text(score).font(.system(size: 12, weight: .bold).monospacedDigit()).foregroundStyle(.white)
            Text("Best \(best)").font(.system(size: 11).monospacedDigit()).foregroundStyle(Theme.textSecondary)
            Spacer()
            trailing
        }
    }
}

/// "Game over" card with a restart button, drawn over the board.
struct GameOverCard: View {
    let title: String
    let detail: String
    let button: String
    let action: () -> Void

    var body: some View {
        VStack(spacing: 6) {
            Text(title).font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
            Text(detail).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            Button(button, action: action).buttonStyle(PurpleButtonStyle())
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.accent.opacity(0.4)))
        .transition(.scale(scale: 0.9).combined(with: .opacity))
    }
}
