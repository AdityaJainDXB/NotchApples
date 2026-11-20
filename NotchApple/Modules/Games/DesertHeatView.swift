//
//  DesertHeatView.swift
//  Notch Apple
//
//  Desert Heat, the open-world Dubai game (docs/game/DESERT_HEAT_PROMPT.md). The game is a web page shared with the Windows
//  app (NotchWindows/src/js/games/desertheat/play.html, copied in as the "desertheat" resource folder with three.js and the
//  map data). The notch shows a small card with a Play button; the game itself runs full screen in its own window
//  (GameWindow), because an open world needs the whole screen.
//

import SwiftUI
import WebKit

/// The card in the notch's Games tab.
struct DesertHeatLauncher: View {
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(colors: [Color(red: 0.42, green: 0.24, blue: 0.09), Color(red: 0.88, green: 0.64, blue: 0.35)], startPoint: .bottom, endPoint: .top)
            VStack(alignment: .leading, spacing: 6) {
                Text("DESERT HEAT").font(.system(size: 26, weight: .semibold, design: .default)).tracking(6).foregroundStyle(.white)
                Text("Dubai, Deira to the Marina. Stage 1: the roads.").font(.system(size: 11)).foregroundStyle(.white.opacity(0.8))
                Button { GameWindow.open(.desertHeat) } label: {
                    Label("Play full screen", systemImage: "play.fill").font(.system(size: 12, weight: .semibold))
                        .padding(.horizontal, 14).padding(.vertical, 7)
                        .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
            .padding(18)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// The game in a web view (used by the full-screen window).
struct DesertHeatView: View {
    var body: some View {
        if let url = Bundle.main.url(forResource: "play", withExtension: "html", subdirectory: "desertheat") {
            DesertHeatWebView(url: url)
        } else {
            Text("Desert Heat is missing from this copy of Notch Apple.")
                .font(.system(size: 13)).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

final class DesertHeatWKWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        super.mouseDown(with: event)
    }
}

struct DesertHeatWebView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // The map is loaded as local script files next to the page; nothing is fetched from the internet.
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        let view = DesertHeatWKWebView(frame: .zero, configuration: config)
        view.setValue(false, forKey: "drawsBackground")
        view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        DispatchQueue.main.async { view.window?.makeFirstResponder(view) }
        return view
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}

    static func dismantleNSView(_ nsView: WKWebView, coordinator: ()) {
        nsView.loadHTMLString("", baseURL: nil)     // stops the game loop and its sound
    }
}
