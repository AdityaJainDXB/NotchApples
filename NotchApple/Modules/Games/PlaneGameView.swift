//
//  PlaneGameView.swift
//  Notch apple
//
//  Plane: a 3D flight game (pick a plane, fly through hoops, time trials, landings, challenges and a leaderboard).
//  The game is a WebGL page shared with the Windows app (plane-sim.js), shown here in a web view. Scores and
//  settings stay in the web view's local storage on this Mac. Nothing runs once the tab is closed.
//

import SwiftUI
import WebKit

struct PlaneGameView: View {
    var body: some View {
        if let url = Bundle.main.url(forResource: "PlaneGame", withExtension: "html") {
            PlaneWebView(url: url)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        } else {
            Text("The Plane game is missing from this copy of Notch apple.")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// A web view that takes the first click (the notch is a non-activating panel) and keeps the keyboard while you fly.
final class PlaneWKWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        super.mouseDown(with: event)
    }
}

private struct PlaneWebView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> PlaneWKWebView {
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        let view = PlaneWKWebView(frame: .zero, configuration: config)
        view.setValue(false, forKey: "drawsBackground")
        view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        DispatchQueue.main.async { view.window?.makeFirstResponder(view) }
        return view
    }

    func updateNSView(_ nsView: PlaneWKWebView, context: Context) {}

    static func dismantleNSView(_ nsView: PlaneWKWebView, coordinator: ()) {
        // Stop the game loop and the engine sound straight away.
        nsView.loadHTMLString("", baseURL: nil)
    }
}
