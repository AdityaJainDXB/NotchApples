//
//  main.swift  (PairDrop loopback test)
//
//  Runs the real transfer code (PairDropTransport.swift) over real TCP sockets on 127.0.0.1: a big file, an empty
//  file, wrong codes and the lockout, chat messages and who may send them, a peer that never answers, a receiver
//  that can't save, and an older-style receiver that closes without confirming. Run: scripts/run-pairdrop-loopback.sh
//

import Foundation
import Network

// MARK: A receiver like the app's, without the app

final class TestReceiver: PairDropReceiving, @unchecked Sendable {
    private let lock = NSLock()
    var code = "123456"
    var limiter = PairDropAttemptLimiter()
    var sessions: [String: PairDropLogic.Session] = [:]
    var files: [(name: String, data: Data)] = []
    var messages: [String] = []
    var failSave = false
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("pd-test-\(UUID().uuidString)")

    init() { try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }

    func decide(_ h: PairDropHeader) async -> PairDropDecision {
        lock.lock(); defer { lock.unlock() }
        if limiter.isLocked() { return .locked }
        func wrong() -> PairDropDecision { limiter.recordFailure(); return .reject }
        switch h.kind {
        case .file:
            guard h.code == code else { return wrong() }
            limiter.recordSuccess(); return .acceptFile
        case .hello:
            guard h.code == code, !h.senderService.isEmpty, PairDropLogic.isValidCode(h.replyCode) else { return wrong() }
            limiter.recordSuccess()
            sessions[h.senderService] = .init(peerService: h.senderService, peerName: h.sender, sendCode: h.replyCode, expectCode: code)
            return .acceptMessage
        case .message:
            guard PairDropLogic.authorised(h, sessions: sessions) else { return wrong() }
            messages.append(h.text); return .acceptMessage
        }
    }

    func saved(_ temp: URL, header: PairDropHeader) async -> Bool {
        lock.lock(); defer { lock.unlock() }
        if failSave { try? FileManager.default.removeItem(at: temp); return false }
        guard let data = try? Data(contentsOf: temp) else { return false }
        try? FileManager.default.removeItem(at: temp)
        files.append((PairDropLogic.safeFileName(header.fileName), data))
        return true
    }

    func receiveFailed(_ header: PairDropHeader, _ why: String) async {}
}

// MARK: Plumbing

let queue = DispatchQueue(label: "loopback")

final class Server: @unchecked Sendable {
    let listener: NWListener
    var port: NWEndpoint.Port = 0
    var live: [IncomingTransfer] = []
    private let lock = NSLock()

    init(receiver: PairDropReceiving) throws {
        listener = try NWListener(using: .tcp)
        listener.newConnectionHandler = { [weak self] conn in
            let t = IncomingTransfer(conn: conn, queue: queue, receiver: receiver)
            self?.lock.lock(); self?.live.append(t); self?.lock.unlock()
            t.start()
        }
    }

    func start() async {
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            var resumed = false
            listener.stateUpdateHandler = { [self] state in
                if case .ready = state, !resumed { resumed = true; port = listener.port ?? 0; cont.resume() }
            }
            listener.start(queue: queue)
        }
    }
}

func send(_ header: PairDropHeader, file: URL?, to port: NWEndpoint.Port, handshake: TimeInterval = 5, stall: TimeInterval = 10,
          progress: @escaping @Sendable (Double) -> Void = { _ in }) async -> OutgoingTransfer.Result {
    let conn = NWConnection(host: .ipv4(.loopback), port: port, using: .tcp)
    let job = OutgoingTransfer(conn: conn, queue: queue, intro: PairDropLogic.encode(header)!, fileURL: file,
                               size: header.size, handshakeTimeout: handshake, stallTimeout: stall, report: progress)
    return await job.run()
}

func tempFile(_ data: Data) -> URL {
    let u = FileManager.default.temporaryDirectory.appendingPathComponent("pd-src-\(UUID().uuidString).bin")
    try? data.write(to: u)
    return u
}

var failures = 0, checks = 0
func check(_ name: String, _ ok: Bool, _ detail: String = "") {
    checks += 1
    if ok { print("PASS  \(name)") } else { failures += 1; print("FAIL  \(name) \(detail)") }
}

func fileHeader(_ name: String, _ size: Int, code: String = "123456") -> PairDropHeader {
    PairDropHeader(kind: .file, code: code, fileName: name, size: size, sender: "Tester", senderService: "Tester-0001")
}

// MARK: Tests

func run() async {
    // 1. A small file, saved byte for byte.
    do {
        let r = TestReceiver(); let s = try! Server(receiver: r); await s.start()
        let body = Data("hello PairDrop\n".utf8)
        let res = await send(fileHeader("note.txt", body.count), file: tempFile(body), to: s.port)
        check("small file is delivered", res == .delivered, "\(res)")
        check("small file arrives intact", r.files.first?.data == body && r.files.first?.name == "note.txt")
    }

    // 2. An empty file.
    do {
        let r = TestReceiver(); let s = try! Server(receiver: r); await s.start()
        let res = await send(fileHeader("empty.txt", 0), file: tempFile(Data()), to: s.port)
        check("empty file is delivered", res == .delivered, "\(res)")
        check("empty file arrives as empty", r.files.first?.data.isEmpty == true)
    }

    // 3. A 40 MB file with progress.
    do {
        let r = TestReceiver(); let s = try! Server(receiver: r); await s.start()
        var big = Data(count: 40 * 1024 * 1024)
        big.withUnsafeMutableBytes { buf in for i in stride(from: 0, to: buf.count, by: 4096) { buf[i] = UInt8(truncatingIfNeeded: i / 4096) } }
        let ticks = Ticks()
        let started = Date()
        let res = await send(fileHeader("big.bin", big.count), file: tempFile(big), to: s.port) { ticks.add($0) }
        check("40 MB file is delivered", res == .delivered, "\(res)")
        check("40 MB file arrives intact", r.files.first?.data == big)
        check("progress climbs to 100%", ticks.values.count > 10 && ticks.values.last == 1 && ticks.values == ticks.values.sorted(), "ticks=\(ticks.values.count)")
        print("      (40 MB in \(String(format: "%.2f", Date().timeIntervalSince(started))) s)")
    }

    // 4. Wrong code, then the lockout.
    do {
        let r = TestReceiver(); let s = try! Server(receiver: r); await s.start()
        let one = await send(fileHeader("x.txt", 1, code: "000000"), file: tempFile(Data([1])), to: s.port)
        check("a wrong code is refused", one == .wrongCode, "\(one)")
        check("nothing was saved", r.files.isEmpty)
        for _ in 0..<4 { _ = await send(fileHeader("x.txt", 1, code: "000000"), file: tempFile(Data([1])), to: s.port) }
        let locked = await send(fileHeader("x.txt", 1, code: "123456"), file: tempFile(Data([1])), to: s.port)
        check("five wrong codes lock even the right code", locked == .locked, "\(locked)")
    }

    // 5. Chat: hello, then messages, and who may send them.
    do {
        let r = TestReceiver(); let s = try! Server(receiver: r); await s.start()
        let rogue = await send(PairDropHeader(kind: .message, code: "123456", sender: "Eve", senderService: "Eve-0002", text: "hi"), file: nil, to: s.port)
        check("a message without a chat is refused", rogue == .wrongCode, "\(rogue)")
        let r2 = TestReceiver(); let s2 = try! Server(receiver: r2); await s2.start()
        let hello = await send(PairDropHeader(kind: .hello, code: "123456", sender: "Sam", senderService: "Sam-0003", replyCode: "654321"), file: nil, to: s2.port)
        check("hello with the right code opens a chat", hello == .delivered, "\(hello)")
        check("the receiver remembered the chat", r2.sessions["Sam-0003"]?.expectCode == "123456" && r2.sessions["Sam-0003"]?.sendCode == "654321")
        let msg = await send(PairDropHeader(kind: .message, code: "123456", sender: "Sam", senderService: "Sam-0003", text: "hello there"), file: nil, to: s2.port)
        check("a message in the chat is delivered", msg == .delivered && r2.messages == ["hello there"], "\(msg)")
        let bad = await send(PairDropHeader(kind: .message, code: "999999", sender: "Sam", senderService: "Sam-0003", text: "x"), file: nil, to: s2.port)
        check("a message with the wrong chat code is refused", bad == .wrongCode, "\(bad)")
    }

    // 6. A peer that accepts the connection and never answers.
    do {
        let silent = try! NWListener(using: .tcp)
        var held: [NWConnection] = []
        silent.newConnectionHandler = { c in c.start(queue: queue); held.append(c) }
        let port: NWEndpoint.Port = await withCheckedContinuation { cont in
            var done = false
            silent.stateUpdateHandler = { if case .ready = $0, !done { done = true; cont.resume(returning: silent.port!) } }
            silent.start(queue: queue)
        }
        let t = Date()
        let res = await send(fileHeader("x.txt", 1), file: tempFile(Data([1])), to: port, handshake: 2)
        if case .unreachable = res { check("a silent peer times out instead of hanging", Date().timeIntervalSince(t) < 4) } else { check("a silent peer times out instead of hanging", false, "\(res)") }
    }

    // 7. Nothing listening at all.
    do {
        let res = await send(fileHeader("x.txt", 1), file: tempFile(Data([1])), to: 9, handshake: 3)
        if case .unreachable = res { check("a closed port is reported as unreachable", true) } else { check("a closed port is reported as unreachable", false, "\(res)") }
    }

    // 8. A receiver that cannot save.
    do {
        let r = TestReceiver(); r.failSave = true; let s = try! Server(receiver: r); await s.start()
        let res = await send(fileHeader("x.txt", 3), file: tempFile(Data([1, 2, 3])), to: s.port)
        if case .failed = res { check("a receiver that can't save is reported as failed", true) } else { check("a receiver that can't save is reported as failed", false, "\(res)") }
    }

    // 9. An older receiver: accepts, reads the body, closes without confirming.
    do {
        let old = try! NWListener(using: .tcp)
        let got = Box()
        old.newConnectionHandler = { c in
            c.start(queue: queue)
            c.receive(minimumIncompleteLength: 4, maximumLength: 4) { len, _, _, _ in
                guard let len, let n = PairDropLogic.frameLength(len) else { return }
                c.receive(minimumIncompleteLength: n, maximumLength: n) { hdr, _, _, _ in
                    guard let hdr, let h = PairDropLogic.decode(hdr) else { return }
                    c.send(content: Data([1]), completion: .contentProcessed { _ in
                        func more(_ left: Int) {
                            if left <= 0 { got.value = h.size; c.cancel(); return }
                            c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { d, _, _, e in
                                more(left - (d?.count ?? 0)); _ = e
                            }
                        }
                        more(h.size)
                    })
                }
            }
        }
        let port: NWEndpoint.Port = await withCheckedContinuation { cont in
            var done = false
            old.stateUpdateHandler = { if case .ready = $0, !done { done = true; cont.resume(returning: old.port!) } }
            old.start(queue: queue)
        }
        let body = Data(repeating: 7, count: 300_000)
        let res = await send(fileHeader("old.bin", body.count), file: tempFile(body), to: port)
        check("an older receiver that just closes still counts as delivered", res == .delivered && got.value == body.count, "\(res) got=\(got.value)")
    }

    print("\n\(checks) checks, \(failures) failures")
    exit(failures == 0 ? 0 : 1)
}

final class Ticks: @unchecked Sendable {
    private let lock = NSLock(); private var v: [Double] = []
    func add(_ x: Double) { lock.lock(); v.append(x); lock.unlock() }
    var values: [Double] { lock.lock(); defer { lock.unlock() }; return v }
}
final class Box: @unchecked Sendable { var value = 0 }

// Interop mode: the Mac's real transfer code against another implementation (the Windows engine in Rust).
//   serve <downloadsDir>                      listens, prints "PORT <n>" and "CODE 123456", saves files into the folder
//   send <port> <code> <file>                 sends a file to 127.0.0.1:<port>
//   hello <port> <code>                       opens a chat (reply code 654321)
//   message <port> <chatCode> <text>          sends a chat message as service "Mac-0001"
if CommandLine.arguments.count > 1 {
    let a = CommandLine.arguments
    switch a[1] {
    case "serve":
        let r = TestReceiver()
        let server = try! Server(receiver: r)
        Task {
            await server.start()
            print("PORT \(server.port.rawValue)"); print("CODE \(r.code)"); fflush(stdout)
            // Copy anything received into the folder so the caller can look at it (each file once).
            var written = 0
            while true {
                try? await Task.sleep(nanoseconds: 200_000_000)
                while written < r.files.count { let f = r.files[written]; try? f.data.write(to: URL(fileURLWithPath: a[2]).appendingPathComponent(f.name)); written += 1 }
                if !r.messages.isEmpty { try? r.messages.joined(separator: "\n").write(toFile: a[2] + "/messages.txt", atomically: true, encoding: .utf8) }
                if !r.sessions.isEmpty { try? r.sessions.keys.sorted().joined(separator: "\n").write(toFile: a[2] + "/sessions.txt", atomically: true, encoding: .utf8) }
            }
        }
    case "send":
        let url = URL(fileURLWithPath: a[4])
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        Task {
            let res = await send(fileHeader(url.lastPathComponent, size, code: a[3]), file: url, to: NWEndpoint.Port(rawValue: UInt16(a[2])!)!, handshake: 10, stall: 20)
            print("RESULT \(res)"); exit(res == .delivered ? 0 : 1)
        }
    case "hello":
        Task {
            let res = await send(PairDropHeader(kind: .hello, code: a[3], sender: "Mac", senderService: "Mac-0001", replyCode: "654321"), file: nil, to: NWEndpoint.Port(rawValue: UInt16(a[2])!)!)
            print("RESULT \(res)"); exit(res == .delivered ? 0 : 1)
        }
    case "message":
        Task {
            let res = await send(PairDropHeader(kind: .message, code: a[3], sender: "Mac", senderService: "Mac-0001", text: a[4]), file: nil, to: NWEndpoint.Port(rawValue: UInt16(a[2])!)!)
            print("RESULT \(res)"); exit(res == .delivered ? 0 : 1)
        }
    default: print("unknown mode"); exit(2)
    }
    dispatchMain()
}

Task { await run() }
dispatchMain()
