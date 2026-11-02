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

    var body: some View {
        if let url = Bundle.main.url(forResource: page, withExtension: "html") {
            WebScriptGameWebView(url: url, global: global, usesSound: usesSound)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
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
