//
//  ClipboardLink.swift
//  Notch apple
//
//  The connection side of Clipboard Link (Ultimate; the format and rules are in ClipboardLinkLogic.swift).
//  Off until you turn it on in Settings → Clipboard. While on, text you copy here is sealed with your link
//  code and sent through Notch apple's room relay to your other devices, and text copied there lands on this
//  Mac's clipboard. Password-manager items are never sent, because the clipboard history never saves them.
//

import AppKit
import CryptoKit
import SwiftUI

@MainActor
final class ClipboardLink: ObservableObject {
    static let shared = ClipboardLink()
    static let relay = "wss://notchapple-rooms.adityajain1225.workers.dev"

    enum State: Equatable { case off, connecting, live, failed(String) }

    @AppStorage("clipLink.enabled") var enabled = false { didSet { apply() } }
    @Published private(set) var state: State = .off
    @Published private(set) var code: String

    private var socket: URLSessionWebSocketTask?
    private var generation = 0
    private var retry = 0
    private var seen = Set<String>()
    private var pingTimer: Timer?
    private let deviceID: String

    private init() {
        let d = UserDefaults.standard
        if let id = d.string(forKey: "clipLink.device") { deviceID = id } else { deviceID = UUID().uuidString; d.set(deviceID, forKey: "clipLink.device") }
        code = KeychainHelper.get(.clipboardLinkCode) ?? ""
    }

    var allowed: Bool { Entitlements.shared.canUse(.clipboardLink) }
    var deviceName: String { Host.current().localizedName ?? "Mac" }

    /// Makes a new code (for the first device) or takes one from another device. Returns false if it isn't a valid code.
    @discardableResult
    func setCode(_ raw: String?) -> Bool {
        let new = raw.map { ClipboardLinkLogic.normalize($0) } ?? ClipboardLinkLogic.normalize(ClipboardLinkLogic.newCode())
        guard ClipboardLinkLogic.isValid(new) else { return false }
        let shown = stride(from: 0, to: 20, by: 4).map { String(Array(new)[$0..<$0 + 4]) }.joined(separator: "-")
        KeychainHelper.set(shown, for: .clipboardLinkCode)
        code = shown
        apply()
        return true
    }

    func apply() {
        generation += 1
        pingTimer?.invalidate(); pingTimer = nil
        socket?.cancel(with: .goingAway, reason: nil); socket = nil
        guard enabled, allowed, ClipboardLinkLogic.isValid(code) else { state = .off; return }
        retry = 0
        connect()
    }

    private func connect() {
        guard let url = URL(string: "\(Self.relay)/\(ClipboardLinkLogic.topic(code: code))/ws") else { return }
        state = .connecting
        let gen = generation
        let task = URLSession.shared.webSocketTask(with: url)
        socket = task
        task.resume()
        listen(task, gen)
        pingTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak task] _ in task?.send(.string("ping")) { _ in } }
    }

    private func listen(_ task: URLSessionWebSocketTask, _ gen: Int) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, gen == self.generation else { return }
                switch result {
                case .success(let message):
                    if case .string(let text) = message { self.handle(text) }
                    self.listen(task, gen)
                case .failure(let error):
                    self.lost(error.localizedDescription, gen)
                }
            }
        }
    }

    private func lost(_ why: String, _ gen: Int) {
        guard gen == generation, enabled else { return }
        pingTimer?.invalidate(); pingTimer = nil
        socket = nil
        retry += 1
        state = .failed("Reconnecting…")
        let wait = min(60, 3 * pow(2, Double(min(retry, 5))))
        DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
            guard let self, gen == self.generation, self.enabled else { return }
            self.connect()
        }
    }

    private func handle(_ text: String) {
        if text == "pong" { return }
        if let obj = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any], obj["event"] as? String == "open" {
            state = .live; retry = 0
            return
        }
        guard let sealed = ClipboardLinkLogic.sealed(fromFrame: text),
              let env = ClipboardLinkLogic.open(sealed, key: ClipboardLinkLogic.key(code: code)),
              ClipboardLinkLogic.judge(env, selfID: deviceID, seen: &seen) == .accept else { return }
        ClipboardHistory.shared.applyRemote(env.text, from: env.name)
        LiveActivityCenter.shared.flash(LiveActivity(symbol: "doc.on.clipboard", label: "From \(env.name)", tint: .systemTeal), seconds: 3)
    }

    /// Called by the clipboard history for every text you copy here.
    func send(_ text: String) {
        guard state == .live, text.count <= ClipboardLinkLogic.maxText else { return }
        let env = ClipboardLinkLogic.Envelope(id: UUID().uuidString, from: deviceID, name: deviceName, text: text, ts: Int64(Date().timeIntervalSince1970 * 1000))
        seen.insert(env.id)
        guard let sealed = ClipboardLinkLogic.seal(env, key: ClipboardLinkLogic.key(code: code)) else { return }
        socket?.send(.string(ClipboardLinkLogic.frame(sealed: sealed))) { _ in }
    }
}

/// Settings → Clipboard → Clipboard Link.
struct ClipboardLinkSettings: View {
    @StateObject private var link = ClipboardLink.shared
    @ObservedObject private var entitlements = Entitlements.shared
    @State private var typed = ""
    @State private var bad = false

    var body: some View {
        Section {
            Toggle(isOn: $link.enabled) {
                Text("Share my clipboard with my other devices")
                Text("Text you copy here appears on your other Macs and PCs, and the other way round. It is scrambled with your code before it leaves, so only your devices can read it.")
            }
            .disabled(!entitlements.canUse(.clipboardLink))
            if link.enabled && entitlements.canUse(.clipboardLink) {
                if link.code.isEmpty {
                    Button("Make a link code for my devices") { link.setCode(nil) }
                    HStack {
                        TextField("…or type the code from another device", text: $typed)
                        Button("Use it") { bad = !link.setCode(typed); if !bad { typed = "" } }.disabled(typed.isEmpty)
                    }
                    if bad { Text("That isn't a valid code. It has 20 letters and numbers.").foregroundStyle(.orange) }
                } else {
                    LabeledContent("Your link code") {
                        HStack {
                            Text(link.code).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                            Button("Copy") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(link.code, forType: .string) }
                        }
                    }
                    LabeledContent("Status", value: statusText)
                    Button("Make a new code (the old one stops working)") { link.setCode(nil) }
                }
            }
        } header: {
            HStack(spacing: 6) { Text("Clipboard Link"); if !entitlements.canUse(.clipboardLink) { TierBadge(tier: .ultimate) } }
        } footer: {
            Text("Enter the same code on each device: Settings → Clipboard on a Mac, Settings → Clipboard on Windows. Anything a password manager marks as secret is never sent. Text only, up to 100,000 characters.")
        }
    }

    private var statusText: String {
        switch link.state {
        case .off: "Off"
        case .connecting: "Connecting…"
        case .live: "Linked"
        case .failed(let why): why
        }
    }
}
