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

    /// Forwards the game's keys to the page whenever the web view doesn't have the keyboard itself (the notch is a
    /// non-activating panel, and focus can sit elsewhere in it), so the arrows, W/S and the rest always fly the plane.
    @MainActor final class Coordinator {
        weak var web: PlaneWKWebView?
        var monitor: Any?

        /// True when the key went to the game (and should go no further).
        func forward(_ e: NSEvent) -> Bool {
            guard let web, let window = web.window, e.window === window,
                  !e.modifierFlags.contains(.command), e.keyCode != 53 else { return false }   // ⌘ shortcuts and Esc stay the notch's
            if let responder = window.firstResponder as? NSView, responder === web || responder.isDescendant(of: web) { return false }
            if NSApp.keyWindow?.firstResponder is NSText { return false }                // typing in a text field elsewhere
            let named: [UInt16: String] = [126: "ArrowUp", 125: "ArrowDown", 123: "ArrowLeft", 124: "ArrowRight", 49: " ", 36: "Enter"]
            let key = named[e.keyCode] ?? (e.charactersIgnoringModifiers ?? "").lowercased()
            guard !key.isEmpty, let data = try? JSONSerialization.data(withJSONObject: [key]), let arg = String(data: data, encoding: .utf8) else { return false }
            if e.type == .keyDown && e.isARepeat { return true }
            web.evaluateJavaScript("window.NotchPlaneGame && window.NotchPlaneGame.key && window.NotchPlaneGame.key(\(arg)[0], \(e.type == .keyDown))")
            return true
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> PlaneWKWebView {
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        let view = PlaneWKWebView(frame: .zero, configuration: config)
        view.setValue(false, forKey: "drawsBackground")
        view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        DispatchQueue.main.async { view.window?.makeFirstResponder(view) }
        let coordinator = context.coordinator
        coordinator.web = view
        coordinator.monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { [weak coordinator] event in
            let consumed = MainActor.assumeIsolated { coordinator?.forward(event) ?? false }
            return consumed ? nil : event
        }
        return view
    }

    func updateNSView(_ nsView: PlaneWKWebView, context: Context) {}

    static func dismantleNSView(_ nsView: PlaneWKWebView, coordinator: Coordinator) {
        if let m = coordinator.monitor { NSEvent.removeMonitor(m) }
        coordinator.monitor = nil
        // Stop the game loop and the engine sound straight away.
        nsView.loadHTMLString("", baseURL: nil)
    }
}
