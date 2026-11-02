// A stand-in iPhone for testing remote view on one Mac (see docs/PLAN_REMOTE_AND_FRIENDS.md). It connects to this Mac's
// companion listener with a token the test script seeded, opens a stream, checks the frames, and prints a summary.
//   scripts/remote-view-loopback.sh builds and runs it. Needs a Mac running Notch Apple with the phone seeded.
import CryptoKit
import Foundation
import Network

setvbuf(stdout, nil, _IONBF, 0)
let args = CommandLine.arguments
guard args.count >= 3, let token = Data(base64Encoded: args[1]) else { print("usage: loopback <token b64> <device id> [port] [seconds]"); exit(2) }
let device = args[2], port = UInt16(args.count > 3 ? args[3] : "") ?? Companion.defaultPort, seconds = Double(args.count > 4 ? args[4] : "") ?? 4

let phoneNonce = Companion.newNonce()
var request = Companion.Message(type: .stream, nonce: phoneNonce.base64EncodedString(), edge: 960)
request.seq = Int64(Date().timeIntervalSince1970 * 1000)
let frame = try Companion.seal(request, from: device, key: Companion.key(token: token))
let conn = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
var buffer = Data(), opened = false, recv: Companion.StreamCipher?, send: Companion.StreamCipher?
var frames = 0, bytes = 0, firstJPEG = false, notes: [String] = [], finished = false
let started = Date()

func finish(_ code: Int32, _ why: String) {
    guard !finished else { return }; finished = true
    print("RESULT \(code == 0 ? "OK" : "FAIL"): \(why) | frames=\(frames) bytes=\(bytes) jpegHeader=\(firstJPEG) notes=\(notes) in \(String(format: "%.1f", Date().timeIntervalSince(started)))s")
    exit(code)
}

func read() {
    conn.receive(minimumIncompleteLength: 1, maximumLength: 262_144) { data, _, done, error in
        if let data { buffer.append(data) }
        if !opened, let need = Companion.frameLength(buffer), buffer.count >= need {
            guard let env = Companion.envelope(from: buffer), let reply = Companion.open(env, key: Companion.key(token: token)) else { finish(1, "the Mac's first reply couldn't be opened"); return }
            buffer = Data(buffer.dropFirst(need))
            guard reply.type == .stream, let nonce = reply.nonce.flatMap({ Data(base64Encoded: $0) }) else { finish(1, "refused: \(reply.text ?? reply.type.rawValue)"); return }
            send = .init(key: Companion.streamKey(token: token, macNonce: nonce, phoneNonce: phoneNonce, .phoneToMac))
            recv = .init(key: Companion.streamKey(token: token, macNonce: nonce, phoneNonce: phoneNonce, .macToPhone))
            opened = true; notes.append("displays=\(reply.displays?.count ?? 0)")
        }
        if opened {
            do {
                while let (type, payload) = try recv!.open(from: &buffer) {
                    if type == .video, let (n, jpeg) = Companion.splitVideo(payload) {
                        frames += 1; bytes += jpeg.count
                        if frames == 1 { firstJPEG = jpeg.prefix(3) == Data([0xFF, 0xD8, 0xFF]); try? jpeg.write(to: URL(fileURLWithPath: "/tmp/rv/first.jpg")) }
                        if let p = try? send!.seal(.info, Companion.encodeNote(.init(kind: "ack", ack: n))) { conn.send(content: p, completion: .contentProcessed { _ in }) }
                    } else if type == .info, let note = Companion.decodeNote(payload) {
                        if ["layout", "error", "permission", "bye"].contains(note.kind) { notes.append("\(note.kind):\(note.width ?? 0)x\(note.height ?? 0)\(note.text.map { " \($0)" } ?? "")") }
                    }
                }
            } catch { finish(1, "a packet was refused: \(error)"); return }
        }
        if error != nil || done { finish(opened && frames > 0 ? 0 : 1, "connection closed"); return }
        read()
    }
}

conn.stateUpdateHandler = { state in
    switch state {
    case .ready: conn.send(content: frame, completion: .contentProcessed { _ in }); read()
    case .failed(let e), .waiting(let e): finish(1, "can't connect: \(e)")
    default: break
    }
}
conn.start(queue: .main)
DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
    if let p = try? send?.seal(.info, Companion.encodeNote(.init(kind: "bye"))) { conn.send(content: p, completion: .contentProcessed { _ in finish(frames > 0 && firstJPEG ? 0 : 1, frames > 0 ? "streamed" : "no frames arrived") }) }
    else { finish(1, "never opened") }
}
RunLoop.main.run()
