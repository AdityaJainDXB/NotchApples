//
//  PrivateGame.swift
//  Notch Apple
//
//  Private games (Flight Economy): a game that only people with an access code can open. The game's page is never in the app:
//  the license server sends it after it accepts a code, and the app keeps it in a folder of its own and opens it in a window of
//  its own. The code is checked again every few days, so a cancelled code stops working; offline, a game stays open for up to
//  two weeks. The Windows app does the same (services/privategame.js).
//

import AppKit
import Security
import SwiftUI
import WebKit

@MainActor
final class PrivateGames: ObservableObject {
    static let shared = PrivateGames()
    nonisolated static let flightEconomy = "flight-economy"
    @Published private(set) var revision = 0

    private let recheck: TimeInterval = 3 * 86_400     // ask the server again after this long
    private let offlineLimit: TimeInterval = 14 * 86_400   // and give up on a game that could not be checked for this long

    struct State: Codable { var code: String; var version: String; var name: String; var checked: Date; var ultimate: Bool? }

    /// A sentence for the person: what went wrong. `refused` = the server said no (a bad, ended or cancelled code), `offline` = no answer.
    enum Failure: LocalizedError {
        case refused(Int, String), offline, message(String)
        var errorDescription: String? {
            switch self {
            case .refused(_, let m), .message(let m): m
            case .offline: "Couldn't reach the server. Check your connection and try again."
            }
        }
    }

    private func key(_ id: String) -> String { "game.private.\(id)" }

    func state(_ id: String = PrivateGames.flightEconomy) -> State? {
        guard let data = UserDefaults.standard.data(forKey: key(id)) else { return nil }
        let d = JSONDecoder(); d.dateDecodingStrategy = .secondsSince1970
        return try? d.decode(State.self, from: data)
    }
    func isUnlocked(_ id: String = PrivateGames.flightEconomy) -> Bool { state(id) != nil }

    private func save(_ s: State, _ id: String) {
        let e = JSONEncoder(); e.dateEncodingStrategy = .secondsSince1970
        if let data = try? e.encode(s) { UserDefaults.standard.set(data, forKey: key(id)) }
        revision += 1
    }

    /// A random id for this Mac that the server only ever sees hashed (it counts how many devices use a code).
    private var deviceID: String {
        if let d = UserDefaults.standard.string(forKey: "game.device"), d.count >= 16 { return d }
        var bytes = [UInt8](repeating: 0, count: 18)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let d = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        UserDefaults.standard.set(d, forKey: "game.device")
        return d
    }

    private func fileURL(_ id: String) throws -> URL {
        guard id.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil else { throw Failure.message("Unknown game.") }
        let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let dir = base.appendingPathComponent("Notch Apple/Games", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("\(id).html")
    }

    /// One question to the license server. Throws `.refused` when it says no and `.offline` when it doesn't answer.
    private func ask(code: String, have: String?) async throws -> [String: Any] {
        try await send("game/unlock", ["code": code], have: have)
    }

    /// The same question with the person's Ultimate license key instead of a code (no extra code is needed).
    private func askUltimate(key: String, have: String?) async throws -> [String: Any] {
        try await send("game/ultimate", ["key": key], have: have)
    }

    private func send(_ path: String, _ extra: [String: Any], have: String?) async throws -> [String: Any] {
        guard let base = await LicenseServer.url() else { throw Failure.offline }
        var r = URLRequest(url: base.appendingPathComponent(path), timeoutInterval: 60)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "content-type")
        var body: [String: Any] = extra.merging(["device": deviceID]) { a, _ in a }
        if let have { body["have"] = have }
        r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        let result: (Data, URLResponse)
        do { result = try await URLSession.shared.data(for: r) } catch { throw Failure.offline }
        let (data, response) = result
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else { throw Failure.refused(status, (json["error"] as? String) ?? "The server answered \(status).") }
        return json
    }

    /// Checks a code. On success the game is saved on this Mac and counts as unlocked.
    func unlock(code raw: String, id: String = PrivateGames.flightEconomy) async throws {
        guard let code = GameCode.clean(raw) else { throw Failure.message("Enter the whole access code: 12 letters and numbers.") }
        let r = try await ask(code: code, have: nil)
        guard (r["game"] as? String) == id else { throw Failure.message("That code is for a different game.") }
        guard let html = r["html"] as? String, !html.isEmpty else { throw Failure.message("The server did not send the game. Try again.") }
        try html.write(to: try fileURL(id), atomically: true, encoding: .utf8)
        save(State(code: code, version: (r["version"] as? String) ?? "", name: (r["name"] as? String) ?? "Flight Economy", checked: Date(), ultimate: nil), id)
    }

    /// Ultimate members: the game opens with their license key, no access code. Throws when this Mac has no Ultimate key.
    func unlockWithLicense(_ id: String = PrivateGames.flightEconomy) async throws {
        guard let text = KeychainHelper.get(.licenseKey), case .success(let k) = LicenseKey.parse(text), k.tier == .ultimate else {
            throw Failure.message("Enter your access code first.")
        }
        let r = try await askUltimate(key: text, have: nil)
        guard (r["game"] as? String) == id else { throw Failure.message("That game is not available.") }
        guard let html = r["html"] as? String, !html.isEmpty else { throw Failure.message("The server did not send the game. Try again.") }
        try html.write(to: try fileURL(id), atomically: true, encoding: .utf8)
        save(State(code: "", version: (r["version"] as? String) ?? "", name: (r["name"] as? String) ?? "Flight Economy", checked: Date(), ultimate: true), id)
    }

    /// Forgets the code and deletes the saved game (the code was cancelled, or the person asked).
    func lock(_ id: String = PrivateGames.flightEconomy) {
        UserDefaults.standard.removeObject(forKey: key(id))
        if let url = try? fileURL(id) { try? FileManager.default.removeItem(at: url) }
        PrivateGameWindow.close(id)
        revision += 1
    }

    /// Opens the game in its own window. Every few days the code is checked again first (and a newer game version is fetched).
    func open(_ id: String = PrivateGames.flightEconomy) async throws {
        let (url, title) = try await prepare(id)
        PrivateGameWindow.show(id: id, file: url, title: title)
    }

    /// Makes the game ready (unlocks it, re-checks the code, fetches a newer version) and returns the saved page and the game's name.
    /// The notch shows it in its own panel; `open` puts it in a window.
    func prepare(_ id: String = PrivateGames.flightEconomy) async throws -> (URL, String) {
        if state(id) == nil { try await unlockWithLicense(id) }
        guard var st = state(id) else { throw Failure.message("Enter your access code first.") }
        if Date().timeIntervalSince(st.checked) > recheck {
            do {
                var r: [String: Any]
                if st.ultimate == true {
                    guard let text = KeychainHelper.get(.licenseKey), case .success = LicenseKey.parse(text) else { throw Failure.refused(403, "Your Ultimate key is no longer on this Mac.") }
                    r = try await askUltimate(key: text, have: st.version)
                } else {
                    r = try await ask(code: st.code, have: st.version)
                }
                if let html = r["html"] as? String, !html.isEmpty { try html.write(to: try fileURL(id), atomically: true, encoding: .utf8) }
                st.version = (r["version"] as? String) ?? st.version
                st.name = (r["name"] as? String) ?? st.name
                st.checked = Date()
                save(st, id)
            } catch Failure.refused(let status, let message) where status == 403 || status == 409 {
                lock(id)
                throw Failure.message("\(message) The game is locked again.")
            } catch {
                if Date().timeIntervalSince(st.checked) > offlineLimit { throw Failure.message("Connect to the internet once to keep the game unlocked.") }
                // offline for now: carry on with the saved copy
            }
        }
        let url = try fileURL(id)
        guard FileManager.default.fileExists(atPath: url.path) else {
            lock(id)
            throw Failure.message("The game isn't saved on this Mac any more. Enter your access code again.")
        }
        return (url, st.name)
    }
}

/// A private game's window: an ordinary web page with no way into the app.
@MainActor
final class PrivateGameWindow: NSObject, NSWindowDelegate {
    private static var windows: [String: PrivateGameWindow] = [:]
    /// The game checks a public GitHub file for newer versions; inside Notch Apple it never talks to GitHub (the server sends updates).
    static let noUpdateCheck = "(function(){var f=window.fetch;window.fetch=function(u){if(String(u).indexOf('raw.githubusercontent.com')>=0){return Promise.reject(new Error('offline'))}return f.apply(this,arguments)}})();"

    private let id: String
    private let window: NSWindow

    static func show(id: String, file: URL, title: String) {
        if let existing = windows[id] {
            existing.window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let w = PrivateGameWindow(id: id, file: file, title: title)
        windows[id] = w
        w.window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    static func close(_ id: String) { windows[id]?.window.close() }

    private init(id: String, file: URL, title: String) {
        self.id = id
        let config = WKWebViewConfiguration()
        config.userContentController.addUserScript(WKUserScript(source: Self.noUpdateCheck, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        let web = WKWebView(frame: .zero, configuration: config)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 780), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = title
        window.contentView = web
        window.minSize = NSSize(width: 640, height: 460)
        window.isReleasedWhenClosed = false
        window.center()
        super.init()
        window.delegate = self
        web.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
    }

    func windowWillClose(_ notification: Notification) { Self.windows[id] = nil }
}

/// The game inside the notch: the same page as the window, in a web view that fills the panel (zoomed out a little so more of the game
/// fits). It has no way into the app. The Pop out button opens the same game in its own window.
struct PrivateGameNotchView: NSViewRepresentable {
    let file: URL
    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.addUserScript(WKUserScript(source: PrivateGameWindow.noUpdateCheck, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        let web = WKWebView(frame: .zero, configuration: config)
        web.pageZoom = 0.72
        web.setValue(false, forKey: "drawsBackground")
        web.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
        return web
    }
    func updateNSView(_ web: WKWebView, context: Context) {}
}
