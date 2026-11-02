//
//  ChessGameView.swift
//  Notch Apple
//
//  Chess against the computer (four levels) or a friend in an online room, using the same 6-character codes and relay as the
//  Plane, Racing and Capture the Flag games. The game is a web page shared with the Windows app (chess.js and chess-logic.js),
//  shown here in a web view. It only needs the mouse. It stops when you switch to another game or close the notch.
//

import SwiftUI
import WebKit

struct ChessGameView: View {
    var body: some View {
        if let url = Bundle.main.url(forResource: "ChessGame", withExtension: "html") {
            ChessWebView(url: url)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        } else {
            Text("Chess is missing from this copy of Notch Apple.")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct ChessWebView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> CtfWKWebView {
        let config = WKWebViewConfiguration()
        let view = CtfWKWebView(frame: .zero, configuration: config)   // takes the first click: the notch is a non-activating panel
        view.setValue(false, forKey: "drawsBackground")
        view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        return view
    }

    func updateNSView(_ nsView: CtfWKWebView, context: Context) {}

    static func dismantleNSView(_ nsView: CtfWKWebView, coordinator: ()) {
        // Leaving the game closes the room and stops the computer thinking.
        nsView.evaluateJavaScript("window.NotchChessGame && window.NotchChessGame.suspend && window.NotchChessGame.suspend()")
        nsView.loadHTMLString("", baseURL: nil)
    }
}
