//
//  PairDropService.swift
//  Notch apple
//
//  Serverless, local-network file sharing ("PairDrop"-style) built on the
//  Network framework:
//
//   • Discovery — every running copy with PairDrop on advertises
//                 `_notchapple._tcp` over Bonjour and browses for peers.
//   • Pairing   — the RECEIVER shows a random 6-digit code. The SENDER only
//                 types that code; no device picking is needed. The sender
//                 offers the transfer to every nearby device and only the one
//                 showing that code accepts it.
//   • Transfer  — one TCP connection per attempt:
//                   sender → [4-byte big-endian length][JSON header]
//                   receiver → 1 byte: 0x01 accept / 0x00 reject
//                   sender → file bytes (only after accept)
//
//  Nothing ever leaves the LAN, so there is no server and no cost.
//

import Foundation
import Network
import AppKit

struct PairDropPeer: Identifiable, Hashable {
    let id: String          // Bonjour service name
    let endpoint: NWEndpoint

    /// Human-friendly name (service names carry a short random suffix).
    var displayName: String {
        guard let dash = id.lastIndex(of: "-") else { return id }
        return String(id[..<dash])
    }
}

private struct TransferHeader: Codable {
    let code: String
    let fileName: String
    let size: Int
    let sender: String
}

@MainActor
final class PairDropService: ObservableObject {
    static let shared = PairDropService()
    static let serviceType = "_notchapple._tcp"

    @Published private(set) var peers: [PairDropPeer] = []
    @Published private(set) var isRunning = false
    @Published private(set) var pairingCode = PairDropService.newCode()
    @Published var status: String = "PairDrop is off"
    @Published private(set) var isSending = false

    private var listener: NWListener?
    private var browser: NWBrowser?
    private let queue = DispatchQueue(label: "pairdrop")
    private let deviceName = Host.current().localizedName ?? "Mac"

    static func newCode() -> String { String(format: "%06d", Int.random(in: 0...999_999)) }

    // MARK: Lifecycle

    func start() {
        guard !isRunning else { return }
        do {
            let listener = try NWListener(using: .tcp)
            listener.service = NWListener.Service(name: "\(deviceName)-\(UUID().uuidString.prefix(4))", type: Self.serviceType)
            listener.newConnectionHandler = { [weak self] conn in
                Task { @MainActor in self?.receive(on: conn) }
            }
            listener.stateUpdateHandler = { [weak self] state in
                Task { @MainActor in
                    if case .failed(let err) = state { self?.status = "Couldn't start PairDrop: \(err)" }
                }
            }
            listener.start(queue: queue)
            self.listener = listener

            let browser = NWBrowser(for: .bonjour(type: Self.serviceType, domain: nil), using: .tcp)
            browser.browseResultsChangedHandler = { [weak self] results, _ in
                let ownName = listener.service?.name
                let found = results.compactMap { result -> PairDropPeer? in
                    guard case let .service(name, _, _, _) = result.endpoint, name != ownName else { return nil }
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

    // MARK: Sending

    /// Sends files to whichever nearby device is showing `code`.
    /// Pass `peer` to target one device directly instead of trying them all.
    func send(_ urls: [URL], code: String, to peer: PairDropPeer? = nil) {
        guard !urls.isEmpty else { return }
        let targets = peer.map { [$0] } ?? peers
        guard !targets.isEmpty else {
            status = "No devices found. Make sure the other device has PairDrop on and is on the same Wi-Fi."
            return
        }
        isSending = true
        Task {
            for url in urls {
                var delivered = false
                for target in targets {
                    status = "Sending \(url.lastPathComponent)…"
                    let result = await sendOne(url, code: code, to: target)
                    if result == .accepted { delivered = true; status = "Sent \(url.lastPathComponent) to \(target.displayName)"; break }
                    if case .failed(let msg) = result { status = msg }
                }
                if !delivered {
                    status = "No device accepted code \(code). Check the code on the receiving device."
                    break
                }
            }
            isSending = false
        }
    }

    private enum SendResult: Equatable { case accepted, rejected, failed(String) }

    private func sendOne(_ url: URL, code: String, to peer: PairDropPeer) async -> SendResult {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return .failed("Couldn't read \(url.lastPathComponent)") }

        let header = TransferHeader(code: code, fileName: url.lastPathComponent, size: data.count, sender: deviceName)
        guard let headerData = try? JSONEncoder().encode(header) else { return .failed("Couldn't encode header") }
        var length = UInt32(headerData.count).bigEndian
        var intro = Data(bytes: &length, count: 4)
        intro.append(headerData)
        let introData = intro
        let queue = self.queue

        return await withCheckedContinuation { (cont: CheckedContinuation<SendResult, Never>) in
            let conn = NWConnection(to: peer.endpoint, using: .tcp)
            let lock = NSLock()
            var finished = false
            func finish(_ r: SendResult) {
                lock.lock(); defer { lock.unlock() }
                guard !finished else { return }
                finished = true
                conn.cancel()
                cont.resume(returning: r)
            }
            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    conn.send(content: introData, completion: .contentProcessed { error in
                        if let error { finish(.failed("Send failed: \(error)")); return }
                        // Wait for the receiver's accept / reject byte.
                        conn.receive(minimumIncompleteLength: 1, maximumLength: 1) { reply, _, _, _ in
                            guard reply?.first == 1 else { finish(.rejected); return }
                            conn.send(content: data, isComplete: true, completion: .contentProcessed { error in
                                finish(error == nil ? .accepted : .failed("Send failed: \(error!)"))
                            })
                        }
                    })
                case .failed, .cancelled:
                    finish(.rejected)
                default: break
                }
            }
            conn.start(queue: queue)
            // Don't hang forever on a device that never answers.
            queue.asyncAfter(deadline: .now() + 20) { finish(.rejected) }
        }
    }

    // MARK: Receiving

    private func receive(on conn: NWConnection) {
        conn.start(queue: queue)
        let service = self
        conn.receive(minimumIncompleteLength: 4, maximumLength: 4) { lenData, _, _, _ in
            guard let lenData, lenData.count == 4 else { conn.cancel(); return }
            let len = Int(lenData.withUnsafeBytes { $0.load(as: UInt32.self).bigEndian })
            guard len > 0, len < 64_000 else { conn.cancel(); return }
            conn.receive(minimumIncompleteLength: len, maximumLength: len) { headerData, _, _, _ in
                guard let headerData, let header = try? JSONDecoder().decode(TransferHeader.self, from: headerData) else {
                    conn.cancel(); return
                }
                Task { @MainActor in
                    guard header.code == service.pairingCode else {
                        // Quietly reject: the sender will try the next device.
                        conn.send(content: Data([0]), isComplete: true, completion: .contentProcessed { _ in conn.cancel() })
                        return
                    }
                    service.status = "Receiving \(header.fileName) from \(header.sender)…"
                    conn.send(content: Data([1]), completion: .contentProcessed { _ in })
                    service.receiveBody(conn, header: header, buffer: Data())
                }
            }
        }
    }

    private func receiveBody(_ conn: NWConnection, header: TransferHeader, buffer: Data) {
        let service = self
        conn.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { chunk, _, isComplete, error in
            var received = buffer
            if let chunk { received.append(chunk) }
            let buffer = received
            let failed = error != nil
            Task { @MainActor in
                if buffer.count >= header.size || isComplete || failed {
                    conn.cancel()
                    service.save(buffer.prefix(header.size), header: header)
                } else {
                    service.receiveBody(conn, header: header, buffer: buffer)
                }
            }
        }
    }

    private func save(_ data: Data, header: TransferHeader) {
        guard data.count == header.size else { status = "Transfer of \(header.fileName) was incomplete"; return }
        let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        // Strip any path components a malicious sender might include.
        let safeName = (header.fileName as NSString).lastPathComponent
        var dest = downloads.appendingPathComponent(safeName)
        var n = 1
        while FileManager.default.fileExists(atPath: dest.path) {
            dest = downloads.appendingPathComponent("\(n)-\(safeName)"); n += 1
        }
        do {
            try data.write(to: dest)
            status = "Received \(safeName) from \(header.sender). Saved to Downloads."
            NSWorkspace.shared.activateFileViewerSelecting([dest])
        } catch {
            status = "Couldn't save \(safeName): \(error.localizedDescription)"
        }
    }
}
