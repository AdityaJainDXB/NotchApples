//
//  GameFullScreen.swift
//  Notch Apple
//
//  A Full screen button for the small games (2048, Snake, Breakout, Memory, Reaction, Cookies, Runner, Blackjack, Poker):
//  the same game opens in its own window that fills the screen, drawn at the panel's size and scaled up evenly, so it
//  is easy to see from a distance. Plane and Racing open their own copy of the web game in a window that fills the screen
//  (the notch closes, and ⌘W closes the window). Solitaire has its own (cards sized to fit); Capture the Flag, Chess,
//  Tetris, Daily Word and Daily Trivia are web games that already fill a bigger panel.
//

import SwiftUI
import AppKit

extension GamesView.Game {
    /// Games that get the shared Full screen button.
    var hasFullScreenButton: Bool {
        switch self {
        case .ctf, .chess, .tetris, .fnaf, .dailyWord, .dailyTrivia, .solitaire: false
        default: true
        }
    }
}

/// The game at the size it is designed for in the notch, scaled to the window.
struct GameFullView: View {
    let game: GamesView.Game
    private let designW: CGFloat = 520, designH: CGFloat = 320

    var body: some View {
        GeometryReader { g in
            let k = max(0.5, min(g.size.width / designW, g.size.height / designH))
            GamesView.content(for: game)
                .frame(width: designW, height: designH)
                .scaleEffect(k)
                .frame(width: g.size.width, height: g.size.height)
        }
        .background(Theme.backdrop)
        .preferredColorScheme(.dark)
    }
}

/// Opens a game in its own window and puts it into macOS full screen (leave with the green button or Esc).
@MainActor
enum GameWindow {
    private static var windows: [String: NSWindow] = [:]

    static func open(_ game: GamesView.Game) {
        if let w = windows[game.rawValue] {
            w.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
            if !w.styleMask.contains(.fullScreen) { w.toggleFullScreen(nil) }
            return
        }
        let w = GameNSWindow(contentRect: NSRect(x: 0, y: 0, width: 1040, height: 640),
                             styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        w.title = game.rawValue
        w.isReleasedWhenClosed = false
        w.collectionBehavior = [.fullScreenPrimary]
        w.appearance = NSAppearance(named: .darkAqua)
        switch game {
        case .plane: w.contentView = NSHostingView(rootView: PlaneGameView(standalone: true).background(Color.black).preferredColorScheme(.dark))
        case .racing: w.contentView = NSHostingView(rootView: RacingGameView(standalone: true).background(Color.black).preferredColorScheme(.dark))
        default: w.contentView = NSHostingView(rootView: GameFullView(game: game))
        }
        if game == .plane || game == .racing { AppDelegate.current?.notch?.closeNotch() }      // one copy of the game at a time
        w.minSize = NSSize(width: 520, height: 320)
        w.center()
        let key = game.rawValue
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { _ in
            MainActor.assumeIsolated { windows[key]?.contentView = nil; windows[key] = nil }      // stops the game's timers
        }
        windows[key] = w
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
        w.toggleFullScreen(nil)
    }
}

/// A game window that also closes with ⌘W (the app has no Window menu to do it).
final class GameNSWindow: NSWindow {
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.type == .keyDown, event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command, event.charactersIgnoringModifiers == "w" {
            performClose(nil); return true
        }
        return super.performKeyEquivalent(with: event)
    }

    /// A key nobody wants would ring the system alert beep: the game window stays quiet, like the notch.
    override func noResponder(for eventSelector: Selector) {
        if eventSelector == #selector(NSResponder.keyDown(with:)) { return }
        super.noResponder(for: eventSelector)
    }
}

/// The small round button in a game's corner.
struct GameFullScreenButton: View {
    let game: GamesView.Game
    var body: some View {
        Button { GameWindow.open(game) } label: {
            Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 9, weight: .bold))
                .frame(width: 20, height: 20).background(Circle().fill(Color.black.opacity(0.35)))
                .foregroundStyle(Theme.textSecondary)
        }
        .buttonStyle(.plain)
        .help("Full screen: opens \(game.rawValue) in a big window that fills the screen")
        .accessibilityLabel("Full screen")
    }
}
