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
import AVFoundation
import Speech

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
    @MainActor final class Coordinator: NSObject, WKUIDelegate, WKScriptMessageHandler {
        weak var web: RacingWKWebView?
        var monitor: Any?
        private var heard = ""

        /// The race radio: the game asks for the microphone ("permission"), starts listening when you open the radio
        /// ("start") and stops when you send ("stop"); what you said goes back to the game, which answers it. Speech is
        /// recognised on this Mac whenever it can be (the same dictation as the AI tab).
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let web else { return }
            // A question for the race engineer: the AI you set up in the AI tab answers it, knowing the state of your race.
            if let ask = message.body as? [String: Any], ask["kind"] as? String == "ask", let id = ask["id"] as? Int,
               let question = ask["question"] as? String, let system = ask["system"] as? String {
                Task { @MainActor in
                    var out = "", problem = ""
                    let config = AIConfig.shared
                    do {
                        for try await piece in AIClient.stream([ChatMessage(role: .user, text: question)], provider: config.provider, model: config.model, system: system) { out += piece }
                    } catch { out = ""; problem = "\(config.provider.title): \(error.localizedDescription)" }
                    let reply = MathText.plain(out).trimmingCharacters(in: .whitespacesAndNewlines)
                    if reply.isEmpty && problem.isEmpty { problem = "\(config.provider.title) gave no answer" }
                    // The answer, or why there is none (shown in the race, so a missing key or a busy model is plain to see).
                    guard let data = try? JSONSerialization.data(withJSONObject: [reply, problem]), let arg = String(data: data, encoding: .utf8) else { return }
                    web.evaluateJavaScript("window.NotchRaceGame && NotchRaceGame.radioAnswer && NotchRaceGame.radioAnswer(\(id), \(arg)[0], \(arg)[1])", completionHandler: nil)
                }
                return
            }
            guard let what = message.body as? String else { return }
            switch what {
            case "permission":
                AVCaptureDevice.requestAccess(for: .audio) { mic in
                    SFSpeechRecognizer.requestAuthorization { status in
                        Task { @MainActor in web.evaluateJavaScript("window.NotchRaceGame && NotchRaceGame.radioPermission && NotchRaceGame.radioPermission(\(mic && status == .authorized))") }
                    }
                }
            case "start":
                heard = ""
                // Say plainly when the microphone or speech recognition is switched off for the app.
                if AVCaptureDevice.authorizationStatus(for: .audio) == .denied || AVCaptureDevice.authorizationStatus(for: .audio) == .restricted {
                    problem("The microphone is off for Notch Apple: turn it on in System Settings → Privacy & Security → Microphone"); return
                }
                if SFSpeechRecognizer.authorizationStatus() == .denied || SFSpeechRecognizer.authorizationStatus() == .restricted {
                    problem("Speech recognition is off for Notch Apple: turn it on in System Settings → Privacy & Security → Speech Recognition"); return
                }
                VoiceInput.shared.start { [weak self] text in self?.heard = text }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
                    if let p = VoiceInput.shared.problem { self?.problem(p) }
                }
            case "focus":
                // Typing a question: the notch's window takes the keyboard and the page gets it (not the game's keys).
                NSApp.activate(ignoringOtherApps: true)
                web.window?.makeKey()
                web.window?.makeFirstResponder(web)
            case "stop":
                // A moment for the last words to come through, then send what was heard.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in
                    guard let self else { return }
                    let p = VoiceInput.shared.problem
                    VoiceInput.shared.stop()
                    if self.heard.isEmpty, let p { self.problem(p); return }
                    guard let data = try? JSONSerialization.data(withJSONObject: [self.heard]), let arg = String(data: data, encoding: .utf8) else { return }
                    self.web?.evaluateJavaScript("window.NotchRaceGame && NotchRaceGame.radioHeard && NotchRaceGame.radioHeard(\(arg)[0])")
                }
            default: break
            }
        }

        /// The track designer's "From a picture" button: a file picker for an image of a circuit.
        func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) {
            let panel = NSOpenPanel()
            panel.allowedContentTypes = [.image]
            panel.allowsMultipleSelection = false
            panel.message = "Pick a picture of a circuit to turn into a track"
            // The notch window floats above normal windows, so the picker opens one level above it (it used to open behind
            // the notch, out of reach), and the notch stays open until a picture is chosen.
            panel.level = NSWindow.Level(rawValue: (webView.window?.level ?? .statusBar).rawValue + 1)
            NotchWindowController.holdOpen += 1
            NSApp.activate(ignoringOtherApps: true)
            panel.begin { response in
                NotchWindowController.holdOpen = max(0, NotchWindowController.holdOpen - 1)
                completionHandler(response == .OK ? panel.urls : nil)
            }
            panel.orderFrontRegardless()
        }

        private func problem(_ text: String) {
            guard let data = try? JSONSerialization.data(withJSONObject: [text]), let arg = String(data: data, encoding: .utf8) else { return }
            web?.evaluateJavaScript("window.NotchRaceGame && NotchRaceGame.radioProblem && NotchRaceGame.radioProblem(\(arg)[0])", completionHandler: nil)
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
        config.userContentController.add(context.coordinator, name: "radio")
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
        nsView.configuration.userContentController.removeScriptMessageHandler(forName: "radio")   // it holds the coordinator
        if VoiceInput.shared.isListening { VoiceInput.shared.stop() }
        // Leaving the game ends the race and stops the engine sound.
        nsView.evaluateJavaScript("window.NotchRaceGame && window.NotchRaceGame.suspend && window.NotchRaceGame.suspend()")
        nsView.loadHTMLString("", baseURL: nil)
    }
}
