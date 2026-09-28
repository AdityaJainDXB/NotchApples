//
//  PairDropService.swift
//  Notch apple
//
//  Serverless, local-network file sharing ("PairDrop"-style) built on the
//  Network framework:
//
//   • Discovery  — every running copy advertises `_notchapple._tcp` over
//                  Bonjour and browses for peers on the same Wi-Fi.
//   • Pairing    — the receiver shows a random 6-digit code. The sender must
//                  type that code; it is sent in the transfer header and the
//                  receiver rejects any transfer whose code doesn't match.
//   • Transfer   — a single TCP connection carries
//                  [4-byte big-endian header length][JSON header][file bytes].
//
//  Nothing ever leaves the LAN, so there is no server and no cost. Other
//  platforms can interoperate by implementing the same tiny wire format.
//

import Foundation
import Network
import AppKit

struct PairDropPeer: Identifiable, Hashable {
    let id: String          // Bonjour service name
    let endpoint: NWEndpoint
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
    @Published var status: String = "Off"

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
                    if case .failed(let err) = state { self?.status = "Listener failed: \(err)" }
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
                Task { @MainActor in self?.peers = found }
            }
            browser.start(queue: queue)
            self.browser = browser

            isRunning = true
            status = "Visible as \(deviceName)"
        } catch {
            status = "Couldn't start: \(error.localizedDescription)"
        }
    }

    func stop() {
        listener?.cancel(); browser?.cancel()
        listener = nil; browser = nil
        peers = []
        isRunning = false
        status = "Off"
    }

    func regenerateCode() { pairingCode = Self.newCode() }

    // MARK: Sending

    /// Sends a file to `peer`, authenticated with the receiver's 6-digit `code`.
    func send(_ fileURL: URL, to peer: PairDropPeer, code: String) {
        let access = fileURL.startAccessingSecurityScopedResource()
        guard let data = try? Data(contentsOf: fileURL) else {
            status = "Couldn't read \(fileURL.lastPathComponent)"
            return
        }
        if access { fileURL.stopAccessingSecurityScopedResource() }

        let header = TransferHeader(code: code, fileName: fileURL.lastPathComponent, size: data.count, sender: deviceName)
        guard let headerData = try? JSONEncoder().encode(header) else { return }
        var length = UInt32(headerData.count).bigEndian
        var packet = Data(bytes: &length, count: 4)
        packet.append(headerData)
        packet.append(data)

        let payload = packet
        let conn = NWConnection(to: peer.endpoint, using: .tcp)
        status = "Sending \(header.fileName)…"
        conn.stateUpdateHandler = { [weak self] state in
            let service = self
            switch state {
            case .ready:
                conn.send(content: payload, isComplete: true, completion: .contentProcessed { error in
                    Task { @MainActor in service?.status = error == nil ? "Sent \(header.fileName) ✓" : "Send failed: \(error!)" }
                    conn.cancel()
                })
            case .failed(let err):
                Task { @MainActor in service?.status = "Connection failed: \(err)" }
            default: break
            }
        }
        conn.start(queue: queue)
    }

    // MARK: Receiving

    private func receive(on conn: NWConnection) {
        conn.start(queue: queue)
        conn.receive(minimumIncompleteLength: 4, maximumLength: 4) { [weak self] lenData, _, _, _ in
            guard let lenData, lenData.count == 4 else { conn.cancel(); return }
            let len = Int(lenData.withUnsafeBytes { $0.load(as: UInt32.self).bigEndian })
            guard len > 0, len < 64_000 else { conn.cancel(); return }
            let service = self
            conn.receive(minimumIncompleteLength: len, maximumLength: len) { headerData, _, _, _ in
                guard let headerData, let header = try? JSONDecoder().decode(TransferHeader.self, from: headerData) else {
                    conn.cancel(); return
                }
                Task { @MainActor in
                    guard let self = service else { return }
                    guard header.code == self.pairingCode else {
                        self.status = "Rejected transfer from \(header.sender): wrong code"
                        conn.cancel(); return
                    }
                    self.status = "Receiving \(header.fileName) from \(header.sender)…"
                    self.receiveBody(conn, header: header, buffer: Data())
                }
            }
        }
    }

    private func receiveBody(_ conn: NWConnection, header: TransferHeader, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] chunk, _, isComplete, error in
            var received = buffer
            if let chunk { received.append(chunk) }
            let buffer = received
            let failed = error != nil
            Task { @MainActor in
                guard let self else { return }
                if buffer.count >= header.size || isComplete || failed {
                    conn.cancel()
                    self.save(buffer.prefix(header.size), header: header)
                } else {
                    self.receiveBody(conn, header: header, buffer: buffer)
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
            status = "Received \(safeName) → Downloads"
            regenerateCode()   // one code per transfer
            NSWorkspace.shared.activateFileViewerSelecting([dest])
        } catch {
            status = "Save failed: \(error.localizedDescription)"
        }
    }
}
