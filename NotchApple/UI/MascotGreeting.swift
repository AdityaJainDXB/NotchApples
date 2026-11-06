//
//  MascotGreeting.swift
//  Notch Apple
//
//  The hello can be a mascot instead of the handwriting: when your Mac wakes up, the notch opens and a character moves
//  across it its own way (Pip flies, Pomo bounces, Mochi hops, Orbit circles, Wisp drifts, Notchy drops out and waves).
//  The drawing and the moves are mascots.js, shared with the Windows app; this file only shows it in a see-through window
//  over the notch. Settings → Notch Extras picks the character. Nothing is sent anywhere.
//

import AppKit
import WebKit

@MainActor
enum MascotGreeting {
    static let characterKey = "hello.character"
    static let handwriting = "hello"
    /// id, name and how it moves (the same list as mascots.js).
    static let all: [(id: String, name: String, how: String)] = [
        ("notchy", "Notchy", "Drops out of the notch and waves"),
        ("pomo", "Pomo", "Bounces across the notch"),
        ("wisp", "Wisp", "Drifts across, wakes up on the way"),
        ("mochi", "Mochi", "Hops across the notch"),
        ("orbit", "Orbit", "Circles around the notch"),
        ("pip", "Pip", "Flies across the notch"),
        ("f1lights", "F1: Lights out", "Five start lights, then your team’s car launches"),
        ("f1lap", "F1: Flying lap", "Your team’s car streaks across the notch"),
        ("f1pit", "F1: Pit stop", "Your team’s car pits for fresh tyres"),
    ]
    /// The F1 teams a car can be painted as (the same list as mascots.js; "notch" is Notch Apple's own purple).
    static let teams: [(id: String, name: String)] = [
        ("notch", "Notch Apple purple"), ("ferrari", "Ferrari"), ("mercedes", "Mercedes"), ("redbull", "Red Bull"), ("mclaren", "McLaren"),
        ("aston", "Aston Martin"), ("alpine", "Alpine"), ("williams", "Williams"), ("racingbulls", "Racing Bulls"), ("haas", "Haas"),
        ("audi", "Audi"), ("cadillac", "Cadillac"),
    ]
    static let teamKey = "hello.team"
    /// The team the car is painted as: the one picked in Settings, else your favourite team from the F1 tab, else Notch purple.
    static var team: String {
        let picked = UserDefaults.standard.string(forKey: teamKey) ?? ""
        return picked.isEmpty ? (UserDefaults.standard.string(forKey: "f1.team") ?? "") : picked
    }
    /// What is sent to the page: the character, and for an F1 car the team after a colon ("f1lap:ferrari").
    static var pageID: String { current.hasPrefix("f1") ? "\(current):\(team)" : current }

    /// The chosen character's id, or "hello" for the handwriting.
    static var current: String {
        let stored = UserDefaults.standard.string(forKey: characterKey) ?? handwriting
        return all.contains { $0.id == stored } ? stored : handwriting
    }
    static var isMascot: Bool { current != handwriting }

    private static var panel: NSPanel?
    private static var handler: DoneHandler?

    static func show(id: String, name: String, screen: NSScreen, notchHeight: CGFloat) {
        close()
        let size = CGSize(width: 420, height: notchHeight + 112)
        let params: [String: Any] = ["id": id, "name": name, "notchHeight": notchHeight, "width": size.width, "height": size.height]
        guard let data = try? JSONSerialization.data(withJSONObject: params), let json = String(data: data, encoding: .utf8),
              let page = Bundle.main.url(forResource: "MascotGreeting", withExtension: "html") else { return }

        let done = DoneHandler { close() }
        let config = WKWebViewConfiguration()
        config.userContentController.addUserScript(WKUserScript(source: "window.NOTCH_MASCOT=\(json);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(done, name: "mascotDone")
        let web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())

        let p = NSPanel(contentRect: NSRect(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY - size.height, width: size.width, height: size.height),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false
        p.level = .statusBar + 2; p.ignoresMouseEvents = true
        p.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        p.contentView = web
        p.orderFrontRegardless()
        panel = p
        handler = done
        // If the page never says it's done (it should, after about five seconds), close anyway.
        DispatchQueue.main.asyncAfter(deadline: .now() + 9) { if panel === p { close() } }
    }

    static func close() {
        if let web = panel?.contentView as? WKWebView { web.configuration.userContentController.removeScriptMessageHandler(forName: "mascotDone") }
        panel?.orderOut(nil)
        panel = nil
        handler = nil
    }

    private final class DoneHandler: NSObject, WKScriptMessageHandler {
        let finished: @MainActor () -> Void
        init(_ finished: @escaping @MainActor () -> Void) { self.finished = finished }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            Task { @MainActor in finished() }
        }
    }
}
