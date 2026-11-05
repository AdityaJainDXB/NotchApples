//
//  WebScriptGame.swift
//  Notch Apple
//
//  A game that is a web page shared with the Windows app (Tetris and Daily Word), shown in a web view. The web view keeps
//  the keyboard while you play; if it does not have it (the notch is a non-activating panel), the keys are forwarded to the
//  page. Leaving the game, or closing the notch, pauses it and drops the page. Nothing runs in the background.
//

import SwiftUI
import WebKit

struct WebScriptGameView: View {
    /// The HTML resource (without .html), the page's global object (like "NotchTetrisGame"), and the name for the error text.
    let page: String
    let global: String
    let title: String
    var usesSound = false
    /// Lets the page read the day's NYT puzzle (see PuzzleFetcher); no other address can be fetched.
    var fetchesNYTPuzzle = false
    /// Parameters for the page (like "room=ABC234&host=1"), read by the page from its address.
    var query: String? = nil

    var body: some View {
        if let base = Bundle.main.url(forResource: page, withExtension: "html") {
            let url = query.flatMap { URL(string: base.absoluteString + "?" + $0) } ?? base
            WebScriptGameWebView(url: url, global: global, usesSound: usesSound, fetchesNYTPuzzle: fetchesNYTPuzzle)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .id(url)
        } else {
            Text("\(title) is missing from this copy of Notch Apple.")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct WebScriptGameWebView: NSViewRepresentable {
    let url: URL
    let global: String
    let usesSound: Bool
    let fetchesNYTPuzzle: Bool
    @AppStorage(GameSound.key) private var soundOn = true

    /// Forwards the keys to the page whenever the web view doesn't have the keyboard itself.
    @MainActor final class Coordinator {
        weak var web: CtfWKWebView?
        var monitor: Any?
        var global = ""

        /// True when the key went to the game (and should go no further).
        func forward(_ e: NSEvent) -> Bool {
            guard let web, let window = web.window, e.window === window,
                  !e.modifierFlags.contains(.command), e.keyCode != 53 else { return false }   // ⌘ shortcuts and Esc stay the notch's
            if let responder = window.firstResponder as? NSView, responder === web || responder.isDescendant(of: web) { return false }
            if NSApp.keyWindow?.firstResponder is NSText { return false }                // typing in a text field elsewhere
            let named: [UInt16: String] = [126: "ArrowUp", 125: "ArrowDown", 123: "ArrowLeft", 124: "ArrowRight", 49: " ", 36: "Enter", 51: "Backspace"]
            let key = named[e.keyCode] ?? (e.charactersIgnoringModifiers ?? "").lowercased()
            guard !key.isEmpty, let data = try? JSONSerialization.data(withJSONObject: [key]), let arg = String(data: data, encoding: .utf8) else { return false }
            if e.type == .keyDown && e.isARepeat { return true }
            web.evaluateJavaScript("window.\(global) && window.\(global).key && window.\(global).key(\(arg)[0], \(e.type == .keyDown))")
            return true
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> CtfWKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.addUserScript(WKUserScript(source: "window.NotchHostSound=\(GameSound.enabled);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if fetchesNYTPuzzle {
            // The page cannot read the NYT feed itself (no CORS), so this hands it a function that asks the app, for that one address only.
            config.userContentController.addScriptMessageHandler(PuzzleFetcher(), contentWorld: .page, name: "hostFetch")
            config.userContentController.addUserScript(WKUserScript(source: "window.NotchHostFetch=function(u){return window.webkit.messageHandlers.hostFetch.postMessage(u);};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let view = CtfWKWebView(frame: .zero, configuration: config)   // takes the first click: the notch is a non-activating panel
        view.setValue(false, forKey: "drawsBackground")
        view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        DispatchQueue.main.async { view.window?.makeFirstResponder(view) }
        let coordinator = context.coordinator
        coordinator.web = view
        coordinator.global = global
        coordinator.monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { [weak coordinator] event in
            let consumed = MainActor.assumeIsolated { coordinator?.forward(event) ?? false }
            return consumed ? nil : event
        }
        return view
    }

    func updateNSView(_ nsView: CtfWKWebView, context: Context) {
        if usesSound { nsView.evaluateJavaScript("window.NotchHostSound=\(soundOn)") }
    }

    static func dismantleNSView(_ nsView: CtfWKWebView, coordinator: Coordinator) {
        if let m = coordinator.monitor { NSEvent.removeMonitor(m) }
        coordinator.monitor = nil
        // Leaving the game pauses it (nothing is left running), then the page is dropped.
        let g = coordinator.global
        nsView.evaluateJavaScript("window.\(g) && window.\(g).suspend && window.\(g).suspend()")
        nsView.loadHTMLString("", baseURL: nil)
    }
}

/// Answers the Daily Word page's request for the day's NYT puzzle (https://www.nytimes.com/svc/wordle/v2/YYYY-MM-DD.json) and nothing else.
private final class PuzzleFetcher: NSObject, WKScriptMessageHandlerWithReply {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
        guard let text = message.body as? String,
              text.range(of: #"^https://www\.nytimes\.com/svc/wordle/v2/\d{4}-\d{2}-\d{2}\.json$"#, options: .regularExpression) != nil,
              let url = URL(string: text) else { return (nil, "blocked") }
        var request = URLRequest(url: url, timeoutInterval: 10)
        request.httpShouldHandleCookies = false
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let body = String(data: data, encoding: .utf8) else { return (nil, "unavailable") }
        return (body, nil)
    }
}
