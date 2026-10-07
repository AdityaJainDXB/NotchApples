//
//  PairDropService.swift
//  Notch apple
//
//  Serverless, local-network file sharing and private chat ("PairDrop"-style) on the Network framework.
//
//   • Discovery: every running copy advertises `_notchapple._tcp` over Bonjour and browses for peers.
//   • Pairing:   the RECEIVER shows a random 6-digit code; the SENDER types it. The sender offers the file to every
//                nearby device and only the one showing that code accepts it. Five wrong codes in a minute lock
//                the receiver for a minute.
//   • Files:     streamed in 256 KB pieces from disk to disk (any size, folders are zipped first), with progress,
//                and the sender only says "Sent" once the receiver confirms it saved the file.
//   • Chat:      type someone's code once to open a private chat; messages are tiny frames on the same channel,
//                each carrying the code agreed for that conversation. Nothing is stored after you quit.
//
//  The wire format and the rules live in PairDropLogic.swift (tested). Nothing leaves the LAN: no server, no cost.
//

import Foundation
import Network
import AppKit
import SwiftUI

struct PairDropPeer: Identifiable, Hashable {
    let id: String          // Bonjour service name
    let endpoint: NWEndpoint

    /// Human-friendly name (service names carry a short random suffix).
    var displayName: String {
        guard let dash = id.lastIndex(of: "-") else { return id }
        return String(id[..<dash])
    }
}

struct PairDropChatMessage: Identifiable, Equatable {
    let id = UUID()
    let fromMe: Bool
    let text: String
    let date: Date
}

struct PairDropChatThread: Identifiable, Equatable {
    var id: String { peerService }
    let peerService: String
    var peerName: String
    var messages: [PairDropChatMessage] = []
    var unread = 0
}

@MainActor
final class PairDropService: ObservableObject {
    static let shared = PairDropService()
    static let serviceType = "_notchapple._tcp"
    private static let chunk = 256 * 1024

    @Published private(set) var peers: [PairDropPeer] = []
    @Published private(set) var isRunning = false
    @Published private(set) var pairingCode = PairDropService.newCode()
    @Published var status: String = "PairDrop is off"
    @Published private(set) var isSending = false
    /// 0…1 while a file is going out.
    @Published private(set) var progress: Double?
    @Published private(set) var threads: [PairDropChatThread] = []

    /// The name other people see (Settings aside, edit it right in PairDrop). Empty means this Mac's name.
    @AppStorage("pairdrop.username") var username = ""

    private var listener: NWListener?
    private var browser: NWBrowser?
    private let queue = DispatchQueue(label: "pairdrop")
    private var ownService = ""
    private var limiter = PairDropAttemptLimiter()
    private var sessions: [String: PairDropLogic.Session] = [:]
    private var incoming: [ObjectIdentifier: IncomingTransfer] = [:]

    var deviceName: String { PairDropLogic.displayName(username, fallback: Host.current().localizedName ?? "Mac") }
    var unreadChats: Int { threads.reduce(0) { $0 + $1.unread } }

    static func newCode() -> String { String(format: "%06d", Int.random(in: 0...999_999)) }

    // MARK: Lifecycle

    func start() {
        guard !isRunning else { return }
        do {
            let listener = try NWListener(using: .tcp)
            ownService = "\(deviceName)-\(UUID().uuidString.prefix(4))"
            listener.service = NWListener.Service(name: ownService, type: Self.serviceType)
            listener.newConnectionHandler = { [weak self] conn in
                Task { @MainActor in self?.accept(conn) }
            }
            listener.stateUpdateHandler = { [weak self] state in
                Task { @MainActor in
                    guard let self else { return }
                    switch state {
                    case .failed(let err): self.status = "Couldn't start PairDrop: \(err)"
                    case .waiting: self.status = "PairDrop is waiting for Local Network access. Allow Notch apple in System Settings → Privacy & Security → Local Network."
                    case .ready: if self.isRunning { self.status = "Ready to receive as \(self.deviceName)" }
                    default: break
                    }
                }
            }
            listener.start(queue: queue)
            self.listener = listener

            let browser = NWBrowser(for: .bonjour(type: Self.serviceType, domain: nil), using: .tcp)
            let own = ownService
            browser.browseResultsChangedHandler = { [weak self] results, _ in
                let found = results.compactMap { result -> PairDropPeer? in
                    guard case let .service(name, _, _, _) = result.endpoint, name != own else { return nil }
                    return PairDropPeer(id: name, endpoint: result.endpoint)
                }
                Task { @MainActor in self?.peers = found.sorted { $0.id < $1.id } }
            }
            browser.start(queue: queue)
            self.browser = browser

            isRunning = true
            status = "Ready to receive as \(deviceName)"
        } catch {
            status = "Couldn't start PairDrop: \(error.localizedDescription)"
        }
    }

    func stop() {
        listener?.cancel(); browser?.cancel()
        listener = nil; browser = nil
        peers = []
        isRunning = false
        status = "PairDrop is off"
    }

    func regenerateCode() { pairingCode = Self.newCode() }

    /// Saves a new display name and tells nearby devices (the Bonjour name carries it, so it restarts).
    func setUsername(_ name: String) {
        let cleaned = PairDropLogic.displayName(name, fallback: "")
        guard cleaned != username else { return }
        username = cleaned
        if isRunning { stop(); start() }
    }

    // MARK: Sending files

    private enum SendOutcome: Equatable { case delivered, wrongCode, locked, unreachable(String), failed(String) }

    /// Sends files (or folders, zipped) to whichever nearby device is showing `code`.
    /// Pass `peer` to target one device directly instead of trying them all.
    func send(_ urls: [URL], code: String, to peer: PairDropPeer? = nil) {
        guard !urls.isEmpty, !isSending else { return }
        guard PairDropLogic.isValidCode(code) else { status = "Type the 6-digit code shown on the other device."; return }
        let targets = peer.map { [$0] } ?? peers
        guard !targets.isEmpty else {
            status = "No devices found. Make sure the other device has PairDrop open and is on the same Wi-Fi."
            return
        }
        isSending = true
        Task {
            defer { isSending = false; progress = nil }
            var known: PairDropPeer?     // once one device accepts, the rest of the files go straight to it
            for (n, url) in urls.enumerated() {
                let label = urls.count > 1 ? "\(url.lastPathComponent) (\(n + 1) of \(urls.count))" : url.lastPathComponent
                status = "Preparing \(label)…"
                guard let (fileURL, name, temporary) = await prepare(url) else { status = "Couldn't read \(url.lastPathComponent)."; return }
                defer { if temporary { try? FileManager.default.removeItem(at: fileURL) } }
                let size = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int) ?? 0

                var delivered = false, sawWrongCode = false, lastProblem: String?
                for target in known.map({ [$0] }) ?? targets {
                    status = "Sending \(label)…"
                    let header = PairDropHeader(kind: .file, code: code, fileName: name, size: size, sender: deviceName, senderService: ownService)
                    switch await transfer(header, fileURL: fileURL, to: target) {
                    case .delivered: delivered = true; known = target; status = "Sent \(label) to \(target.displayName)."
                    case .wrongCode: sawWrongCode = true
                    case .locked: status = "\(target.displayName) is locked after too many wrong codes. Wait a minute and try again."; return
                    case .unreachable(let why), .failed(let why): lastProblem = why
                    }
                    if delivered { break }
                }
                if !delivered {
                    status = sawWrongCode ? "No device accepted code \(code). Check the code on the receiving device."
                                          : (lastProblem ?? "Couldn't reach the other device. Check you're on the same Wi-Fi.")
                    return
                }
            }
        }
    }

    /// A file as it is; a folder as a temporary zip.
    private func prepare(_ url: URL) async -> (URL, String, Bool)? {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) else { return nil }
        guard isDir.boolValue else { return FileManager.default.isReadableFile(atPath: url.path) ? (url, url.lastPathComponent, false) : nil }
        let zip = FileManager.default.temporaryDirectory.appendingPathComponent("\(url.lastPathComponent)-\(UUID().uuidString.prefix(6)).zip")
        let ok: Bool = await withCheckedContinuation { cont in
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
            p.arguments = ["-c", "-k", "--sequesterRsrc", "--keepParent", url.path, zip.path]
            p.terminationHandler = { cont.resume(returning: $0.terminationStatus == 0) }
            do { try p.run() } catch { cont.resume(returning: false) }
        }
        return ok ? (zip, url.lastPathComponent + ".zip", true) : nil
    }

    private func transfer(_ header: PairDropHeader, fileURL: URL?, to peer: PairDropPeer) async -> SendOutcome {
        guard let intro = PairDropLogic.encode(header) else { return .failed("That's too long to send.") }
        let job = OutgoingTransfer(conn: NWConnection(to: peer.endpoint, using: .tcp), queue: queue, intro: intro,
                                   fileURL: fileURL, size: header.size, report: { [weak self] value in
            Task { @MainActor in self?.progress = value }
        })
        switch await job.run() {
        case .delivered: return .delivered
        case .wrongCode: return .wrongCode
        case .locked: return .locked
        case .unreachable(let why): return .unreachable(why)
        case .failed(let why): return .failed(why)
        }
    }

    // MARK: Chat

    /// Opens a private chat with whoever is showing `code`. The chat appears on both devices.
    func startChat(code: String, with peer: PairDropPeer? = nil) {
        guard PairDropLogic.isValidCode(code) else { status = "Type the 6-digit code shown on the other device."; return }
        let targets = peer.map { [$0] } ?? peers
        guard !targets.isEmpty else { status = "No devices found on this Wi-Fi."; return }
        Task {
            let mine = Self.newCode()    // what they must put on messages to me
            var sawWrong = false
            for target in targets {
                let header = PairDropHeader(kind: .hello, code: code, sender: deviceName, senderService: ownService, replyCode: mine)
                switch await transfer(header, fileURL: nil, to: target) {
                case .delivered:
                    sessions[target.id] = PairDropLogic.Session(peerService: target.id, peerName: target.displayName, sendCode: code, expectCode: mine)
                    if !threads.contains(where: { $0.id == target.id }) { threads.append(PairDropChatThread(peerService: target.id, peerName: target.displayName)) }
                    status = "Chat with \(target.displayName) is open."
                    return
                case .wrongCode: sawWrong = true
                case .locked: status = "\(target.displayName) is locked after too many wrong codes. Wait a minute."; return
                case .unreachable, .failed: continue
                }
            }
            status = sawWrong ? "No device accepted code \(code). Check the code on the other device." : "Couldn't reach the other device."
        }
    }

    func sendMessage(_ raw: String, in threadID: String) {
        let text = PairDropLogic.clampMessage(raw)
        guard !text.isEmpty, let session = sessions[threadID] else { return }
        guard let peer = peers.first(where: { $0.id == threadID }) else { status = "\(session.peerName) isn't nearby right now."; return }
        Task {
            let header = PairDropHeader(kind: .message, code: session.sendCode, sender: deviceName, senderService: ownService, text: text)
            if case .delivered = await transfer(header, fileURL: nil, to: peer) {
                append(PairDropChatMessage(fromMe: true, text: text, date: .now), to: threadID, peerName: session.peerName, unread: false)
            } else {
                status = "Couldn't deliver that message to \(session.peerName)."
            }
        }
    }

    func markRead(_ threadID: String) {
        guard let i = threads.firstIndex(where: { $0.id == threadID }), threads[i].unread > 0 else { return }
        threads[i].unread = 0
    }

    func closeChat(_ threadID: String) {
        sessions[threadID] = nil
        threads.removeAll { $0.id == threadID }
    }

    private func append(_ m: PairDropChatMessage, to id: String, peerName: String, unread: Bool) {
        if let i = threads.firstIndex(where: { $0.id == id }) {
            threads[i].messages.append(m)
            if unread { threads[i].unread += 1 }
        } else {
            var t = PairDropChatThread(peerService: id, peerName: peerName)
            t.messages = [m]; t.unread = unread ? 1 : 0
            threads.append(t)
        }
    }

    // MARK: Receiving

    private func accept(_ conn: NWConnection) {
        let transfer = IncomingTransfer(conn: conn, queue: queue, receiver: ServiceReceiver(service: self))
        let key = ObjectIdentifier(transfer)
        incoming[key] = transfer
        transfer.onFinish = { [weak self] in Task { @MainActor in self?.incoming[key] = nil } }
        transfer.start()
    }

    /// Decides what to do with an offer, on the main actor where the code, the limiter and the chats live.
    fileprivate func evaluate(_ h: PairDropHeader) -> PairDropDecision {
        if limiter.isLocked() { return .locked }
        func wrong() -> PairDropDecision { limiter.recordFailure(); return .reject }
        switch h.kind {
        case .file:
            guard h.code == pairingCode, h.size >= 0 else { return wrong() }
            limiter.recordSuccess()
            status = "Receiving \(PairDropLogic.safeFileName(h.fileName)) from \(h.sender)…"
            return .acceptFile
        case .hello:
            guard h.code == pairingCode, !h.senderService.isEmpty, PairDropLogic.isValidCode(h.replyCode) else { return wrong() }
            limiter.recordSuccess()
            sessions[h.senderService] = PairDropLogic.Session(peerService: h.senderService, peerName: h.sender, sendCode: h.replyCode, expectCode: pairingCode)
            if !threads.contains(where: { $0.id == h.senderService }) { threads.append(PairDropChatThread(peerService: h.senderService, peerName: h.sender)) }
            status = "\(h.sender) started a chat with you."
            LiveActivityCenter.shared.flash(LiveActivity(symbol: "bubble.left.fill", label: h.sender, tint: .systemTeal), seconds: 4)
            return .acceptMessage
        case .message:
            guard PairDropLogic.authorised(h, sessions: sessions) else { return wrong() }
            let text = PairDropLogic.clampMessage(h.text)
            guard !text.isEmpty else { return .acceptMessage }
            append(PairDropChatMessage(fromMe: false, text: text, date: .now), to: h.senderService, peerName: h.sender, unread: true)
            LiveActivityCenter.shared.flash(LiveActivity(symbol: "bubble.left.fill", label: h.sender, tint: .systemTeal), seconds: 4)
            return .acceptMessage
        }
    }

    /// A file has arrived in full: move it into Downloads under a safe, unused name.
    fileprivate func saved(_ temp: URL, header: PairDropHeader) -> Bool {
        let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        let base = PairDropLogic.safeFileName(header.fileName)
        let name = PairDropLogic.uniqueName(base) { FileManager.default.fileExists(atPath: downloads.appendingPathComponent($0).path) }
        let dest = downloads.appendingPathComponent(name)
        do {
            try FileManager.default.moveItem(at: temp, to: dest)
            status = "Received \(name) from \(header.sender). Saved to Downloads."
            LiveActivityCenter.shared.flash(LiveActivity(symbol: "arrow.down.circle.fill", label: "Received", tint: .systemGreen), seconds: 4)
            NSWorkspace.shared.activateFileViewerSelecting([dest])
            return true
        } catch {
            try? FileManager.default.removeItem(at: temp)
            status = "Couldn't save \(base): \(error.localizedDescription)"
            return false
        }
    }

    fileprivate func receiveFailed(_ header: PairDropHeader, _ why: String) {
        status = "Receiving \(PairDropLogic.safeFileName(header.fileName)) failed: \(why)"
    }
}

/// Lets the transport ask the service what to do without the transport knowing about the app.
private final class ServiceReceiver: PairDropReceiving, @unchecked Sendable {
    private weak var service: PairDropService?
    init(service: PairDropService) { self.service = service }

    func decide(_ header: PairDropHeader) async -> PairDropDecision {
        await MainActor.run { service?.evaluate(header) ?? .reject }
    }
    func saved(_ temp: URL, header: PairDropHeader) async -> Bool {
        await MainActor.run { service?.saved(temp, header: header) ?? false }
    }
    func receiveFailed(_ header: PairDropHeader, _ why: String) async {
        await MainActor.run { service?.receiveFailed(header, why) }
    }
}
