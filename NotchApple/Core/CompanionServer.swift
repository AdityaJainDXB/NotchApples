//
//  CompanionServer.swift
//  Notch apple
//
//  The Mac end of the iPhone companion (Ultimate; protocol in CompanionKit).
//  Off until you turn it on in Settings → iPhone. While on, it listens on the
//  local network only, advertises itself with Bonjour, and answers paired
//  iPhones: things they send appear in the notch, and they can see the Mac's
//  battery and music and run a few controls. Nothing goes through a server.
//

import AppKit
import CryptoKit
import Network
import SwiftUI

struct PairedPhone: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var token: String   // base64
    var added: Date
    var lastSeen: Date?
}

struct CompanionItem: Identifiable, Equatable {
    let id = UUID()
    let from: String
    let text: String?
    let url: URL?
    let date = Date()
}

@MainActor
final class CompanionServer: ObservableObject {
    static let shared = CompanionServer()

    @AppStorage("companion.enabled") var enabled = false { didSet { apply() } }
    @AppStorage("companion.copyText") var copyText = true
    @AppStorage("companion.openLinks") var openLinks = false
    @Published private(set) var phones: [PairedPhone] = []
    @Published private(set) var code: String?
    @Published private(set) var codeExpires: Date?
    @Published private(set) var inbox: [CompanionItem] = []
    @Published private(set) var listening = false
    @Published private(set) var problem: String?

    private var listener: NWListener?
    private var codeTimer: Timer?

    private init() {
        if let data = KeychainHelper.get(.companionPhones)?.data(using: .utf8),
           let list = try? JSONDecoder().decode([PairedPhone].self, from: data) { phones = list }
    }

    var allowed: Bool { Entitlements.shared.canUse(.iphoneCompanion) }

    func apply() {
        listener?.cancel(); listener = nil; listening = false
        guard enabled, allowed else { return }
        do {
            let params = NWParameters.tcp
            params.includePeerToPeer = false
            let l = try NWListener(using: params)
            l.service = NWListener.Service(name: Host.current().localizedName ?? "Mac", type: Companion.serviceType)
            l.stateUpdateHandler = { state in
                Task { @MainActor in
                    switch state {
                    case .ready: self.listening = true; self.problem = nil
                    case .failed(let e): self.listening = false; self.problem = "Couldn't listen on the network: \(e.localizedDescription)"
                    default: break
                    }
                }
            }
            l.newConnectionHandler = { conn in Task { @MainActor in self.handle(conn) } }
            l.start(queue: .main)
            listener = l
        } catch {
            problem = error.localizedDescription
        }
    }

    // MARK: Pairing

    func startPairing(code fixed: String? = nil) {
        code = fixed ?? Companion.newCode()
        codeExpires = .now.addingTimeInterval(120)
        codeTimer?.invalidate()
        codeTimer = Timer.scheduledTimer(withTimeInterval: 120, repeats: false) { _ in
            Task { @MainActor in self.code = nil; self.codeExpires = nil }
        }
    }

    func remove(_ phone: PairedPhone) {
        phones.removeAll { $0.id == phone.id }
        save()
    }

    private func save() {
        if let data = try? JSONEncoder().encode(phones), let s = String(data: data, encoding: .utf8) { KeychainHelper.set(s, for: .companionPhones) }
    }

    // MARK: Requests

    private func handle(_ conn: NWConnection) {
        conn.start(queue: .main)
        receive(conn, buffer: Data())
        // Never keep a connection longer than 10 seconds.
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { conn.cancel() }
    }

    private func receive(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { data, _, done, error in
            Task { @MainActor in
                var buf = buffer
                if let data { buf.append(data) }
                if let need = Companion.frameLength(buf), buf.count >= need {
                    self.respond(conn, frame: buf)
                } else if error == nil, !done, buf.count < 1_000_000 {
                    self.receive(conn, buffer: buf)
                } else {
                    conn.cancel()
                }
            }
        }
    }

    private func respond(_ conn: NWConnection, frame: Data) {
        guard let env = Companion.envelope(from: frame) else { conn.cancel(); return }
        let reply: Companion.Message
        let key: SymmetricKey
        if env.d == "pair" {
            guard let code, let codeExpires, codeExpires > .now,
                  let msg = Companion.open(env, key: Companion.pairingKey(code: code)), msg.type == .pair else { conn.cancel(); return }
            key = Companion.pairingKey(code: code)
            let token = Companion.newToken()
            let phone = PairedPhone(id: UUID().uuidString, name: String((msg.name ?? "iPhone").prefix(40)), token: token.base64EncodedString(), added: .now)
            phones.append(phone)
            save()
            self.code = nil
            self.codeExpires = nil
            reply = Companion.Message(type: .paired, name: Host.current().localizedName ?? "Mac", device: phone.id, token: phone.token)
            LiveActivityCenter.shared.flash(LiveActivity(symbol: "iphone", label: "Paired", tint: .systemGreen), seconds: 2)
        } else {
            guard allowed, let i = phones.firstIndex(where: { $0.id == env.d }),
                  let token = Data(base64Encoded: phones[i].token) else { conn.cancel(); return }
            key = Companion.key(token: token)
            guard let msg = Companion.open(env, key: key) else { conn.cancel(); return }
            phones[i].lastSeen = .now
            reply = handle(msg, from: phones[i])
        }
        if let data = try? Companion.seal(reply, from: "mac", key: key) {
            conn.send(content: data, completion: .contentProcessed { _ in conn.cancel() })
        } else {
            conn.cancel()
        }
    }

    private func handle(_ msg: Companion.Message, from phone: PairedPhone) -> Companion.Message {
        switch msg.type {
        case .push:
            let url = msg.url.flatMap(URL.init(string:)).flatMap { ["http", "https"].contains($0.scheme?.lowercased() ?? "") ? $0 : nil }
            let text = msg.text.map { String($0.prefix(5000)) }
            inbox.insert(CompanionItem(from: phone.name, text: text, url: url), at: 0)
            inbox = Array(inbox.prefix(20))
            if let text, copyText {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
            }
            if let url, openLinks { NSWorkspace.shared.open(url) }
            let label = url?.host ?? text.map { String($0.prefix(18)) } ?? "Sent"
            LiveActivityCenter.shared.flash(LiveActivity(symbol: url != nil ? "link" : "iphone", label: label, tint: .systemBlue), seconds: 4)
            return Companion.Message(type: .ok, text: copyText && text != nil ? "Copied on the Mac" : "Shown on the Mac")
        case .status:
            return Companion.Message(type: .status, status: status())
        case .control:
            runControl(msg.action ?? "")
            return Companion.Message(type: .ok, status: status())
        default:
            return Companion.Message(type: .error, text: "Unknown request")
        }
    }

    private func runControl(_ action: String) {
        switch action {
        case "playPause": MediaControl.send(.playPause)
        case "next": MediaControl.send(.next)
        case "previous": MediaControl.send(.previous)
        case "toggleNotch": AppDelegate.current?.toggleNotch()
        case "timer5": CountdownTimer.shared.startTimer(seconds: 300)
        case "timer25": CountdownTimer.shared.startTimer(seconds: 1500)
        case "stopTimer": CountdownTimer.shared.resetTimer()
        case "keepAwake": KeepAwake.shared.start(minutes: 60)
        default: break
        }
    }

    private func status() -> Companion.Status {
        let b = LiveActivityCenter.battery()
        let music = DemoHooks.isDemo ? nil : NowPlayingMonitor.shared.current
        let timer = CountdownTimer.shared
        return Companion.Status(macName: Host.current().localizedName ?? "Mac", battery: b?.percent, charging: b?.charging ?? false,
                                playing: music?.isPlaying ?? false, title: music?.title, artist: music?.artist,
                                timer: timer.timerRunning ? FocusTimer.format(timer.remaining) : nil,
                                notchOpen: AppDelegate.current?.notch?.isOpen ?? false, tier: Entitlements.shared.tier.name)
    }
}

/// Settings → iPhone (Ultimate).
struct CompanionSettings: View {
    @ObservedObject private var server = CompanionServer.shared
    @ObservedObject private var entitlements = Entitlements.shared

    var body: some View {
        Form {
            Section {
                Toggle(isOn: $server.enabled) {
                    Text("Allow the iPhone companion")
                    Text("Listens on your local network only. Paired iPhones can send text and links to the notch, see the battery and music, and run a few controls.")
                }
                .disabled(!entitlements.canUse(.iphoneCompanion))
                if server.enabled {
                    LabeledContent("Status", value: server.listening ? "Ready on this network" : "Starting…")
                    if let p = server.problem { Text(p).foregroundStyle(.orange) }
                }
            } header: {
                HStack(spacing: 6) {
                    Text("iPhone companion")
                    if !entitlements.canUse(.iphoneCompanion) { TierBadge(tier: .ultimate) }
                }
            } footer: {
                Text("Get the iPhone app from the latest GitHub release (NotchAppleCompanion.ipa) and install it with Sideloadly using your Apple ID. With a free Apple ID, Apple asks you to re-install it every 7 days.")
            }

            if server.enabled && entitlements.canUse(.iphoneCompanion) {
                Section {
                    if let code = server.code, let expires = server.codeExpires {
                        HStack {
                            Text(code).font(.system(size: 34, weight: .bold, design: .monospaced)).kerning(6)
                            Spacer()
                            Text(expires, style: .timer).foregroundStyle(.secondary).monospacedDigit()
                        }
                        Text("On your iPhone, open Notch apple, tap this Mac and type the code.").font(.caption).foregroundStyle(.secondary)
                    } else {
                        Button("Pair an iPhone…") { server.startPairing() }
                    }
                    ForEach(server.phones) { p in
                        HStack {
                            Image(systemName: "iphone")
                            VStack(alignment: .leading) {
                                Text(p.name)
                                Text(p.lastSeen.map { "Last used \($0.formatted(.relative(presentation: .named)))" } ?? "Paired \(p.added.formatted(date: .abbreviated, time: .omitted))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Remove", role: .destructive) { server.remove(p) }
                        }
                    }
                } header: {
                    Text("Paired iPhones")
                }

                Section {
                    Toggle("Copy text from the iPhone to the clipboard", isOn: $server.copyText)
                    Toggle("Open links from the iPhone right away", isOn: $server.openLinks)
                    ForEach(server.inbox) { item in
                        HStack {
                            Image(systemName: item.url != nil ? "link" : "text.bubble")
                            VStack(alignment: .leading) {
                                Text(item.url?.absoluteString ?? item.text ?? "").lineLimit(2)
                                Text("\(item.from) · \(item.date.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let url = item.url { Button("Open") { NSWorkspace.shared.open(url) } }
                            else if let t = item.text { Button("Copy") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(t, forType: .string) } }
                        }
                    }
                } header: {
                    Text("From your iPhone")
                }
            }
        }
        .formStyle(.grouped)
    }
}
