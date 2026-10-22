//
//  PlaneGameView.swift
//  Notch Apple
//
//  Plane: a 3D flight game (pick a plane, fly through hoops, time trials, landings, challenges and a leaderboard).
//  The game is a WebGL page shared with the Windows app (plane-sim.js), shown here in a web view. Scores and
//  settings stay in the web view's local storage on this Mac. The game is kept between visits: closing the notch or
//  switching tab pauses the flight and mutes it, and coming back puts it back as it was (it is let go of after an
//  hour away).
//

import SwiftUI
import WebKit

struct PlaneGameView: View {
    var body: some View {
        if let url = Bundle.main.url(forResource: "PlaneGame", withExtension: "html") {
            PlaneWebView(url: url)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        } else {
            Text("The Plane game is missing from this copy of Notch Apple.")
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

/// The Plane game's web view while it is on screen, so the menu-bar quick-dock can pause it without the notch open.
@MainActor
enum PlaneGameControl {
    fileprivate(set) static weak var web: WKWebView?
    /// The game's web view, kept alive between visits so the flight is not lost when the notch closes.
    fileprivate static var kept: PlaneWKWebView?
    /// Which on-screen copy of the game view owns the web view now (a newer copy may be made before an older one is torn down).
    fileprivate static var owner: ObjectIdentifier?
    private static var releaseTask: Task<Void, Never>?

    /// The game was put away: pause and mute it, and let go of it if it is not wanted again for an hour.
    fileprivate static func setAside(_ view: PlaneWKWebView) {
        view.evaluateJavaScript("window.NotchPlaneGame && window.NotchPlaneGame.suspend && window.NotchPlaneGame.suspend()")
        releaseTask?.cancel()
        releaseTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(3600))
            guard !Task.isCancelled, web == nil else { return }
            kept?.loadHTMLString("", baseURL: nil)     // stops the game loop and the engine sound
            kept = nil
        }
    }

    /// The game is wanted again.
    fileprivate static func bringBack(_ view: PlaneWKWebView) {
        releaseTask?.cancel(); releaseTask = nil
        view.evaluateJavaScript("window.NotchPlaneGame && window.NotchPlaneGame.resume && window.NotchPlaneGame.resume()")
    }

    static var isRunning: Bool { web != nil }

    /// Sends the game its pause key (P). Returns false when the game isn't open.
    @discardableResult
    static func togglePause() -> Bool {
        guard let web else { return false }
        web.evaluateJavaScript("window.NotchPlaneGame && window.NotchPlaneGame.key && (window.NotchPlaneGame.key('p', true), window.NotchPlaneGame.key('p', false))")
        return true
    }

    /// Opens the notch on the Plane game (choosing Plane in the Games tab first).
    static func launch() {
        UserDefaults.standard.set(GamesView.Game.plane.rawValue, forKey: "games.last")
        AppDelegate.showNotch(tab: .games)
    }
}

private struct PlaneWebView: NSViewRepresentable {
    let url: URL
    /// The Games sidebar's Sound switch: it also turns the game's engine, warnings and effects on and off.
    @AppStorage(GameSound.key) private var soundOn = true

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
        // Coming back to a game that is being kept: the same web view, with the flight as it was.
        if let kept = PlaneGameControl.kept {
            let coordinator = context.coordinator
            coordinator.web = kept
            PlaneGameControl.web = kept
            PlaneGameControl.owner = ObjectIdentifier(coordinator)
            coordinator.monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { [weak coordinator] event in
                let consumed = MainActor.assumeIsolated { coordinator?.forward(event) ?? false }
                return consumed ? nil : event
            }
            PlaneGameControl.bringBack(kept)
            DispatchQueue.main.async { kept.window?.makeFirstResponder(kept) }
            return kept
        }
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        // Starts with the Sound switch as it is now (the game reads this before it makes any noise).
        config.userContentController.addUserScript(WKUserScript(source: "window.NotchHostSound=\(GameSound.enabled);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Where the user is (their Weather location), so the Plane game can pick the nearest scenery.
        let here = SharedStore.weatherLocation
        if here.latitude != 0 || here.longitude != 0 {
            let name = here.name.replacingOccurrences(of: "\\", with: "").replacingOccurrences(of: "\"", with: "")
            config.userContentController.addUserScript(WKUserScript(
                source: "window.NotchDeviceLocation={lat:\(here.latitude),lon:\(here.longitude),name:\"\(name)\"};",
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let view = PlaneWKWebView(frame: .zero, configuration: config)
        view.setValue(false, forKey: "drawsBackground")
        view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        DispatchQueue.main.async { view.window?.makeFirstResponder(view) }
        let coordinator = context.coordinator
        coordinator.web = view
        PlaneGameControl.web = view
        PlaneGameControl.kept = view
        PlaneGameControl.owner = ObjectIdentifier(coordinator)
        coordinator.monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { [weak coordinator] event in
            let consumed = MainActor.assumeIsolated { coordinator?.forward(event) ?? false }
            return consumed ? nil : event
        }
        return view
    }

    func updateNSView(_ nsView: PlaneWKWebView, context: Context) {
        nsView.evaluateJavaScript("window.NotchHostSound=\(soundOn); window.NotchPlaneGame && window.NotchPlaneGame.setSoundEnabled && window.NotchPlaneGame.setSoundEnabled(\(soundOn))")
    }

    static func dismantleNSView(_ nsView: PlaneWKWebView, coordinator: Coordinator) {
        if let m = coordinator.monitor { NSEvent.removeMonitor(m) }
        coordinator.monitor = nil
        guard PlaneGameControl.owner == ObjectIdentifier(coordinator) else { return }     // a newer copy has taken over
        PlaneGameControl.owner = nil
        if PlaneGameControl.web === nsView { PlaneGameControl.web = nil }
        // Not destroyed: the flight is paused, muted and kept for when the notch opens again.
        PlaneGameControl.setAside(nsView)
    }
}
