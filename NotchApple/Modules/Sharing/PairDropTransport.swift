//
//  PairDropTransport.swift
//  Notch apple
//
//  The two ends of one PairDrop connection, free of any app code so they can be tested over a loopback socket
//  (scripts/run-pairdrop-loopback.sh): OutgoingTransfer sends a header, waits for the answer, streams the file and
//  waits for "saved"; IncomingTransfer reads a header, asks its receiver what to do, and streams the body to disk.
//  The wire format is described in PairDropLogic.swift.
//

import Foundation
import Network

enum PairDropDecision { case acceptFile, acceptMessage, reject, locked }

/// What the receiving side of a transfer needs from whoever owns it.
protocol PairDropReceiving: AnyObject, Sendable {
    func decide(_ header: PairDropHeader) async -> PairDropDecision
    /// A file arrived in full at `temp`; keep it (move it somewhere) and say whether that worked.
    func saved(_ temp: URL, header: PairDropHeader) async -> Bool
    func receiveFailed(_ header: PairDropHeader, _ why: String) async
}


/// Sends the header, waits for the answer, streams the file, then waits for "saved". The timeout is for silence,
/// not for the whole transfer, so a big file on a slow network still gets through.
final class OutgoingTransfer: @unchecked Sendable {
    enum Result: Equatable { case delivered, wrongCode, locked, unreachable(String), failed(String) }

    private let conn: NWConnection
    private let queue: DispatchQueue
    private let intro: Data
    private let fileURL: URL?
    private let size: Int
    private let report: @Sendable (Double) -> Void
    private var continuation: CheckedContinuation<Result, Never>?
    private var finished = false
    private var sent = 0
    private var handle: FileHandle?
    private var watchdog: DispatchWorkItem?
    private static let chunk = 256 * 1024
    private let handshakeTimeout: TimeInterval
    private let stallTimeout: TimeInterval

    init(conn: NWConnection, queue: DispatchQueue, intro: Data, fileURL: URL?, size: Int,
         handshakeTimeout: TimeInterval = 15, stallTimeout: TimeInterval = 30, report: @escaping @Sendable (Double) -> Void) {
        self.conn = conn; self.queue = queue; self.intro = intro; self.fileURL = fileURL; self.size = size; self.report = report
        self.handshakeTimeout = handshakeTimeout; self.stallTimeout = stallTimeout
    }

    func run() async -> Result {
        await withCheckedContinuation { cont in
            queue.async {
                self.continuation = cont
                self.begin()
            }
        }
    }

    private func begin() {
        arm(handshakeTimeout, "The other device didn't answer.")
        conn.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready: self.sendIntro()
            case .failed(let e): self.finish(.unreachable("Couldn't connect: \(e.localizedDescription)"))
            case .cancelled: self.finish(.unreachable("The connection closed."))
            default: break
            }
        }
        conn.start(queue: queue)
    }

    private func arm(_ seconds: TimeInterval, _ message: String) {
        watchdog?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.finish(.unreachable(message)) }
        watchdog = w
        queue.asyncAfter(deadline: .now() + seconds, execute: w)
    }

    private func finish(_ r: Result) {
        guard !finished else { return }
        finished = true
        watchdog?.cancel()
        try? handle?.close()
        conn.cancel()
        continuation?.resume(returning: r)
        continuation = nil
    }

    private func sendIntro() {
        conn.send(content: intro, contentContext: .defaultStream, isComplete: false, completion: .contentProcessed { [weak self] error in
            guard let self else { return }
            if let error { self.finish(.unreachable("Send failed: \(error.localizedDescription)")); return }
            self.awaitAnswer()
        })
    }

    private func awaitAnswer() {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 1) { [weak self] data, _, _, _ in
            guard let self else { return }
            switch data?.first {
            case 1:
                guard self.fileURL != nil else { self.finish(.delivered); return }   // a chat frame: accepted means delivered
                self.startStreaming()
            case 2: self.finish(.locked)
            case 0: self.finish(.wrongCode)
            default: self.finish(.unreachable("No answer from the other device."))
            }
        }
    }

    private func startStreaming() {
        guard let url = fileURL, let h = try? FileHandle(forReadingFrom: url) else { finish(.failed("Couldn't read the file.")); return }
        handle = h
        arm(stallTimeout, "The transfer stalled.")
        pump()
    }

    private func pump() {
        guard !finished, let handle else { return }
        let piece = (try? handle.read(upToCount: Self.chunk)) ?? Data()
        if piece.isEmpty {
            guard sent == size else { finish(.failed("The file changed while it was being sent.")); return }
            arm(max(stallTimeout, 60), "The other device didn't confirm it saved the file.")
            awaitSaved()
            return
        }
        conn.send(content: piece, contentContext: .defaultStream, isComplete: false, completion: .contentProcessed { [weak self] error in
            guard let self else { return }
            if let error { self.finish(.failed("Send failed: \(error.localizedDescription)")); return }
            self.sent += piece.count
            self.report(self.size > 0 ? min(1, Double(self.sent) / Double(self.size)) : 1)
            self.arm(stallTimeout, "The transfer stalled.")
            self.pump()
        })
    }

    private func awaitSaved() {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 1) { [weak self] data, _, _, _ in
            guard let self else { return }
            // An explicit 0 means the receiver failed. Older versions just close the connection once they have saved
            // the file, so a closed connection after every byte was sent counts as delivered.
            self.finish(data?.first == 0 ? .failed("The other device couldn't save the file.") : .delivered)
        }
    }
}

// MARK: - One incoming connection

final class IncomingTransfer: @unchecked Sendable {
    private let conn: NWConnection
    private let queue: DispatchQueue
    private let receiver: PairDropReceiving
    var onFinish: () -> Void = {}

    private var finished = false
    private var watchdog: DispatchWorkItem?
    private var header: PairDropHeader?
    private var handle: FileHandle?
    private var tempURL: URL?
    private var written = 0
    private static let chunk = 256 * 1024

    init(conn: NWConnection, queue: DispatchQueue, receiver: PairDropReceiving) {
        self.conn = conn; self.queue = queue; self.receiver = receiver
    }

    func start() {
        arm(15)
        conn.stateUpdateHandler = { [weak self] state in
            if case .failed = state { self?.finish() }
            if case .cancelled = state { self?.finish() }
        }
        conn.start(queue: queue)
        readLength()
    }

    private func arm(_ seconds: TimeInterval) {
        watchdog?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.abort("The sender went quiet.") }
        watchdog = w
        queue.asyncAfter(deadline: .now() + seconds, execute: w)
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        watchdog?.cancel()
        try? handle?.close()
        conn.cancel()
        onFinish()
    }

    private func abort(_ why: String) {
        if let header, header.kind == .file { let r = receiver; Task { await r.receiveFailed(header, why) } }
        if let tempURL { try? FileManager.default.removeItem(at: tempURL) }
        finish()
    }

    private func readLength() {
        conn.receive(minimumIncompleteLength: 4, maximumLength: 4) { [weak self] data, _, _, _ in
            guard let self else { return }
            guard let data, let n = PairDropLogic.frameLength(data) else { self.finish(); return }
            self.readHeader(n)
        }
    }

    private func readHeader(_ n: Int) {
        conn.receive(minimumIncompleteLength: n, maximumLength: n) { [weak self] data, _, _, _ in
            guard let self, let data, let h = PairDropLogic.decode(data) else { self?.finish(); return }
            self.header = h
            let r = self.receiver
            Task {
                let decision = await r.decide(h)
                self.queue.async { self.respond(decision, h) }
            }
        }
    }

    private func respond(_ decision: PairDropDecision, _ h: PairDropHeader) {
        switch decision {
        case .reject: reply(0) { self.finish() }
        case .locked: reply(2) { self.finish() }
        case .acceptMessage: reply(1) { self.finish() }
        case .acceptFile: reply(1) { self.beginBody(h) }
        }
    }

    private func reply(_ byte: UInt8, then next: @escaping () -> Void) {
        conn.send(content: Data([byte]), contentContext: .defaultStream, isComplete: false, completion: .contentProcessed { _ in next() })
    }

    private func beginBody(_ h: PairDropHeader) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("notchapple-\(UUID().uuidString).part")
        guard FileManager.default.createFile(atPath: url.path, contents: nil), let fh = try? FileHandle(forWritingTo: url) else {
            reply(0) { self.abort("Couldn't make room for the file.") }
            return
        }
        tempURL = url; handle = fh
        arm(30)
        if h.size == 0 { complete(h); return }
        readBody(h)
    }

    private func readBody(_ h: PairDropHeader) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: min(Self.chunk, max(1, h.size - written))) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let data, !data.isEmpty {
                do { try self.handle?.write(contentsOf: data) } catch { self.reply(0) { self.abort("The disk is full or not writable.") }; return }
                self.written += data.count
            }
            if self.written >= h.size { self.complete(h); return }
            if error != nil || isComplete { self.abort("The connection dropped before the file finished."); return }
            self.arm(30)
            self.readBody(h)
        }
    }

    private func complete(_ h: PairDropHeader) {
        try? handle?.close(); handle = nil
        guard let temp = tempURL else { abort("Couldn't save it."); return }
        let r = receiver
        Task {
            let ok = await r.saved(temp, header: h)
            self.queue.async {
                self.tempURL = nil
                self.reply(ok ? 1 : 0) { self.finish() }
            }
        }
    }
}
