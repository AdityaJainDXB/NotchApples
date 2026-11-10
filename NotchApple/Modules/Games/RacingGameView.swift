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
    var standalone = false
    var body: some View {
        if let url = Bundle.main.url(forResource: "RacingGame", withExtension: "html") {
            RacingWebView(url: url, standalone: standalone)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        } else {
            Text("The Racing game is missing from this copy of Notch Apple.")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

final class RacingWKWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        super.mouseDown(with: event)
    }
}

@MainActor
enum RacingGameControl {
    fileprivate static weak var web: WKWebView?
    fileprivate static var kept: RacingWKWebView?
    private static var releaseTask: Task<Void, Never>?
    fileprivate static var owner: ObjectIdentifier?

    fileprivate static func setAside(_ view: RacingWKWebView) {
        view.evaluateJavaScript("window.NotchRaceGame && window.NotchRaceGame.suspend && window.NotchRaceGame.suspend()")
        releaseTask?.cancel()
        releaseTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(3600))
            guard !Task.isCancelled, web == nil else { return }
            kept?.loadHTMLString("", baseURL: nil)
            kept = nil
        }
    }

    fileprivate static func bringBack(_ view: RacingWKWebView) {
        releaseTask?.cancel(); releaseTask = nil
        view.evaluateJavaScript("window.NotchRaceGame && window.NotchRaceGame.resume && window.NotchRaceGame.resume()")
    }

    static var isRunning: Bool { web != nil }

    @discardableResult
    static func togglePause() -> Bool {
        guard let web else { return false }
        web.evaluateJavaScript("window.NotchRaceGame && window.NotchRaceGame.key && (window.NotchRaceGame.key('p', true), window.NotchRaceGame.key('p', false))")
        return true
    }
}

private struct RacingWebView: NSViewRepresentable {
    let url: URL
    var standalone = false
    @AppStorage(GameSound.key) private var soundOn = true

    @MainActor final class Coordinator: NSObject, WKUIDelegate, WKScriptMessageHandler {
        weak var web: RacingWKWebView?
        var monitor: Any?
        var standalone = false
        private var heard = ""

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let web else { return }
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
                NSApp.activate(ignoringOtherApps: true)
                web.window?.makeKey()
                web.window?.makeFirstResponder(web)
            case "stop":
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

        func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) {
            let panel = NSOpenPanel()
            panel.allowedContentTypes = [.image]
            panel.allowsMultipleSelection = false
            panel.message = "Pick a picture of a circuit to turn into a track"
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
            web?.evaluateJavaScript("window.NotchRaceGame && NotchRaceGame.radioProblem && NotchRaceGame.radioProblem(\(arg)[0])")
        }

        func forward(_ e: NSEvent) -> Bool {
            guard let web, let window = web.window, e.window === window,
                  !e.modifierFlags.contains(.command), e.keyCode != 53 else { return false }
            if let responder = window.firstResponder as? NSView, responder === web || responder.isDescendant(of: web) { return false }
            if NSApp.keyWindow?.firstResponder is NSText { return false }
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
        if !standalone, let kept = RacingGameControl.kept {
            let coordinator = context.coordinator
            coordinator.web = kept
            RacingGameControl.web = kept
            RacingGameControl.owner = ObjectIdentifier(coordinator)
            kept.uiDelegate = coordinator
            kept.configuration.userContentController.removeScriptMessageHandler(forName: "radio")
            kept.configuration.userContentController.add(coordinator, name: "radio")
            coordinator.monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { [weak coordinator] event in
                let consumed = MainActor.assumeIsolated { coordinator?.forward(event) ?? false }
                return consumed ? nil : event
            }
            RacingGameControl.bringBack(kept)
            DispatchQueue.main.async { kept.window?.makeFirstResponder(kept) }
            return kept
        }
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.addUserScript(WKUserScript(source: "window.NotchHostSound=\(GameSound.enabled); window.NotchLowPower=\(ProcessInfo.processInfo.isLowPowerModeEnabled);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(context.coordinator, name: "radio")
        let view = RacingWKWebView(frame: .zero, configuration: config)
        view.setValue(false, forKey: "drawsBackground")
        view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        DispatchQueue.main.async { view.window?.makeFirstResponder(view) }
        let coordinator = context.coordinator
        coordinator.web = view
        coordinator.standalone = standalone
        if !standalone {
            RacingGameControl.web = view
            RacingGameControl.kept = view
            RacingGameControl.owner = ObjectIdentifier(coordinator)
        }
        coordinator.monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { [weak coordinator] event in
            let consumed = MainActor.assumeIsolated { coordinator?.forward(event) ?? false }
            return consumed ? nil : event
        }
        return view
    }

    func updateNSView(_ nsView: RacingWKWebView, context: Context) {
        nsView.evaluateJavaScript("window.NotchLowPower=\(ProcessInfo.processInfo.isLowPowerModeEnabled); window.NotchHostSound=\(soundOn); window.NotchRaceGame && window.NotchRaceGame.setSoundEnabled && window.NotchRaceGame.setSoundEnabled(\(soundOn))")
    }

    static func dismantleNSView(_ nsView: RacingWKWebView, coordinator: Coordinator) {
        if let m = coordinator.monitor { NSEvent.removeMonitor(m) }
        coordinator.monitor = nil
        nsView.configuration.userContentController.removeScriptMessageHandler(forName: "radio")
        if VoiceInput.shared.isListening { VoiceInput.shared.stop() }
        if coordinator.standalone {
            nsView.evaluateJavaScript("window.NotchRaceGame && window.NotchRaceGame.suspend && window.NotchRaceGame.suspend()")
            nsView.loadHTMLString("", baseURL: nil)
            return
        }
        guard RacingGameControl.owner == ObjectIdentifier(coordinator) else { return }
        RacingGameControl.owner = nil
        if RacingGameControl.web === nsView { RacingGameControl.web = nil }
        RacingGameControl.setAside(nsView)
    }
}
