//
//  BambuCamera.swift
//  Notch Apple
//
//  The live picture from a P1 or A1 printer's camera: a TLS connection to port 6000 on the printer, a login with the LAN
//  access code, then a stream of JPEG pictures (see BambuCameraLogic). The printer signs its own certificate, so the first one
//  it shows is remembered and a different one is refused, like the status connection. Nothing leaves the local network, and
//  nothing is kept: the pictures are only shown. Only one stream per window is open, and it closes when the view goes away.
//

import AppKit
import Foundation
import Network
import Security

@MainActor
final class BambuCameraModel: ObservableObject {
    enum State: Equatable { case idle, connecting, live, failed(String) }

    @Published private(set) var state = State.idle
    @Published private(set) var image: NSImage?

    private let queue = DispatchQueue(label: "notchapple.bambu.camera")
    private var connection: NWConnection?
    private var generation = 0
    private var lastShown = Date.distantPast

    /// Opens the stream. `pin` is the certificate remembered for this camera (nil the first time); `onPin` remembers a new one.
    func start(host: String, code: String, pin: String?, onPin: @escaping (String) -> Void) {
        stop()
        guard let host = BambuStatusLogic.normalizeHost(host), let auth = BambuCameraLogic.authPacket(user: BambuStatusLogic.mqttUser, code: code) else {
            state = .failed("The camera needs the printer's address and access code. Check them in Settings → Printer Status."); return
        }
        generation += 1
        let g = generation
        state = .connecting; image = nil

        let tls = NWProtocolTLS.Options()
        let mismatch = MismatchFlag()
        sec_protocol_options_set_verify_block(tls.securityProtocolOptions, { _, trust, complete in
            let ref = sec_trust_copy_ref(trust).takeRetainedValue()
            guard let leaf = (SecTrustCopyCertificateChain(ref) as? [SecCertificate])?.first else { complete(false); return }
            let seen = BambuStatusLogic.fingerprint(of: SecCertificateCopyData(leaf) as Data)
            switch BambuStatusLogic.decidePin(stored: pin, seen: seen) {
            case .match: complete(true)
            case .pinFirst: Task { @MainActor in onPin(seen) }; complete(true)
            case .mismatch: mismatch.value = true; complete(false)
            }
        }, queue)
        let tcp = NWProtocolTCP.Options()
        tcp.connectionTimeout = Int(BambuStatusLogic.connectTimeout)
        let conn = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: BambuCameraLogic.port)!, using: NWParameters(tls: tls, tcp: tcp))
        connection = conn
        var buffer = Data()
        conn.stateUpdateHandler = { [weak self] s in
            switch s {
            case .ready:
                conn.send(content: auth, completion: .contentProcessed { _ in })
                Self.receive(conn, &buffer, queue: self?.queue ?? .main) { frames in
                    Task { @MainActor in self?.show(frames, generation: g) }
                } onEnd: { problem in
                    Task { @MainActor in self?.end(generation: g, mismatch: mismatch.value, problem: problem) }
                }
            case .failed(let e), .waiting(let e):
                Task { @MainActor in self?.end(generation: g, mismatch: mismatch.value, problem: e.localizedDescription) }
            default: break
            }
        }
        conn.start(queue: queue)
        // No picture within a few seconds: the camera is off (or this printer sends video, not pictures).
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 10_000_000_000)
            if let self, self.generation == g, self.state == .connecting { self.end(generation: g, mismatch: false, problem: nil, silent: false) }
        }
    }

    func stop() {
        generation += 1
        connection?.stateUpdateHandler = nil
        connection?.cancel()
        connection = nil
        state = .idle
    }

    private final class MismatchFlag: @unchecked Sendable { var value = false }

    /// Reads pictures from the connection until it ends.
    private nonisolated static func receive(_ conn: NWConnection, _ buffer: inout Data, queue: DispatchQueue, onFrames: @escaping @Sendable ([Data]) -> Void, onEnd: @escaping @Sendable (String?) -> Void) {
        let box = BufferBox(buffer)
        func next() {
            conn.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { data, _, complete, error in
                if let error { onEnd(error.localizedDescription); return }
                if let data, !data.isEmpty {
                    box.data.append(data)
                    guard let frames = BambuCameraLogic.takeFrames(&box.data) else { onEnd("The printer sent something that is not a camera picture."); return }
                    if !frames.isEmpty { onFrames(frames) }
                }
                if complete { onEnd(nil); return }
                next()
            }
        }
        next()
    }
    private final class BufferBox: @unchecked Sendable { var data: Data; init(_ d: Data) { data = d } }

    /// Shows the newest picture, at most about six times a second.
    private func show(_ frames: [Data], generation g: Int) {
        guard g == generation, let last = frames.last else { return }
        if state != .live { state = .live }
        let now = Date()
        guard now.timeIntervalSince(lastShown) > 0.16, let img = NSImage(data: last) else { return }
        lastShown = now; image = img
    }

    private func end(generation g: Int, mismatch: Bool, problem: String?, silent: Bool = true) {
        guard g == generation else { return }
        connection?.stateUpdateHandler = nil; connection?.cancel(); connection = nil
        if mismatch { state = .failed("The printer's certificate changed, so the camera refused to connect. Use Trust new certificate in Settings → Printer Status.") }
        else if state == .live { state = .failed("The camera stopped. Press Camera to open it again.") }
        else { state = .failed("No picture came. Turn on the camera (and on some firmware “LAN Only Liveview”) in the printer's settings. The X1, P2 and H2 printers send video this app cannot play yet: use Copy video address.") }
        _ = problem; _ = silent
    }
}
