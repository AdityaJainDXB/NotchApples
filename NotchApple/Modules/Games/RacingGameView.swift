//
//  RacingGameView.swift
//  Notch Apple
//
//  Racing: a top-down car racing game (a straight sprint, a curved circuit and a mixed track, three cars, computer
//  rivals, lap times, and online rooms to race friends with a code). The game is a web page shared with the Windows app
//  (racing.js), shown here in a web view. Best times stay in the web view's local storage on this Mac. It stops when you
//  switch to another game or close the notch.
//

import SwiftUI
import WebKit
import UniformTypeIdentifiers

struct RacingGameView: View {
    var body: some View {
        if let url = Bundle.main.url(forResource: "RacingGame", withExtension: "html") {
            RacingWebView(url: url)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        } else {
            Text("The Racing game is missing from this copy of Notch Apple.")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// A web view that takes the first click (the notch is a non-activating panel) and keeps the keyboard while you race.
final class RacingWKWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        super.mouseDown(with: event)
    }
}

private struct RacingWebView: NSViewRepresentable {
    let url: URL
    /// The Games sidebar's Sound switch: it turns the engine, tyres and crash sounds on and off too.
    @AppStorage(GameSound.key) private var soundOn = true

    /// Forwards the game's keys to the page whenever the web view doesn't have the keyboard itself (the notch is a
    /// non-activating panel, and focus can sit elsewhere in it), so the arrows, W A S D and Space always drive the car.
    @MainActor final class Coordinator: NSObject, WKUIDelegate {
        weak var web: RacingWKWebView?
        var monitor: Any?

        /// The track designer's "From a picture" button: a file picker for an image of a circuit.
        func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) {
            let panel = NSOpenPanel()
            panel.allowedContentTypes = [.image]
            panel.allowsMultipleSelection = false
            panel.message = "Pick a picture of a circuit to turn into a track"
            NSApp.activate(ignoringOtherApps: true)
            panel.begin { response in completionHandler(response == .OK ? panel.urls : nil) }
        }

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
            web.evaluateJavaScript("window.NotchRaceGame && window.NotchRaceGame.key && window.NotchRaceGame.key(\(arg)[0], \(e.type == .keyDown))")
            return true
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> RacingWKWebView {
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.addUserScript(WKUserScript(source: "window.NotchHostSound=\(GameSound.enabled);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = RacingWKWebView(frame: .zero, configuration: config)
        view.uiDelegate = context.coordinator
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

    func updateNSView(_ nsView: RacingWKWebView, context: Context) {
        nsView.evaluateJavaScript("window.NotchHostSound=\(soundOn); window.NotchRaceGame && window.NotchRaceGame.setSoundEnabled && window.NotchRaceGame.setSoundEnabled(\(soundOn))")
    }

    static func dismantleNSView(_ nsView: RacingWKWebView, coordinator: Coordinator) {
        if let m = coordinator.monitor { NSEvent.removeMonitor(m) }
        coordinator.monitor = nil
        // Leaving the game ends the race and stops the engine sound.
        nsView.evaluateJavaScript("window.NotchRaceGame && window.NotchRaceGame.suspend && window.NotchRaceGame.suspend()")
        nsView.loadHTMLString("", baseURL: nil)
    }
}
