//
//  CompanionStream.swift
//  Notch Apple (shared by the Mac app and the iPhone companion)
//
//  Remote view (and, later, control) over the companion connection. A stream is one long-lived TCP connection that starts
//  like any request (a sealed `stream` message, with the rising counter), and after the Mac's sealed reply carries framed,
//  sealed packets in both directions:
//
//      [4-byte length N][1-byte type][8-byte counter][ChaChaPoly(ciphertext ‖ tag), N − 9 bytes]
//
//  • Each direction has its own key: HKDF(token, salt = macNonce ‖ phoneNonce, info = "notchapple-stream-v1|m2p" or "|p2m").
//    The nonces are fresh per stream, so a recording of an earlier stream can't be replayed into a new one.
//  • The counter is the packet number (starts at 1, must go up by exactly 1). It is also the ChaChaPoly nonce, and the type
//    byte is authenticated, so packets can't be replayed, dropped, reordered or have their type changed unnoticed.
//  • Nothing here needs the network, so the tests use it directly.
//

import CryptoKit
import Foundation

extension Companion {
    /// The port the Mac listens on by default (settable in Settings → iPhone), so the phone can reach it by address, e.g. over Tailscale.
    static let defaultPort: UInt16 = 47813

    // MARK: Who may connect

    /// True for addresses that can only be on a private network or a Tailscale tailnet (not the public internet):
    /// 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10 (Tailscale), 127/8, and the IPv6 equivalents (fc00::/7, fe80::/10, ::1,
    /// and IPv4-mapped forms of the above). The Mac drops a connection from anywhere else before it says a word.
    static func isPrivatePeer(_ host: String) -> Bool {
        var h = host.lowercased()
        if let zone = h.firstIndex(of: "%") { h = String(h[..<zone]) }
        if h.hasPrefix("::ffff:") { h = String(h.dropFirst(7)) }
        let parts = h.split(separator: ".").compactMap { Int($0) }
        if parts.count == 4, parts.allSatisfy({ (0...255).contains($0) }) {
            switch (parts[0], parts[1]) {
            case (10, _), (127, _), (192, 168), (169, 254): return true
            case (172, 16...31): return true
            case (100, 64...127): return true
            default: return false
            }
        }
        if h == "::1" { return true }
        if h.contains(":") {
            let first = h.split(separator: ":", omittingEmptySubsequences: false).first.map(String.init) ?? ""
            guard let value = UInt16(first.isEmpty ? "0" : first, radix: 16) else { return false }
            return (value & 0xFE00) == 0xFC00 || (value & 0xFFC0) == 0xFE80     // fc00::/7 and fe80::/10
        }
        return false
    }

    /// This device's Tailscale IPv4 addresses (100.64.0.0/10 on a utun interface), if Tailscale is running.
    static func tailscaleAddresses() -> [String] {
        var out: [String] = []
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return [] }
        defer { freeifaddrs(list) }
        var p: UnsafeMutablePointer<ifaddrs>? = first
        while let i = p {
            defer { p = i.pointee.ifa_next }
            guard let addr = i.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET), String(cString: i.pointee.ifa_name).hasPrefix("utun") else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                let s = String(cString: host)
                if isPrivatePeer(s), s.hasPrefix("100.") { out.append(s) }
            }
        }
        return out
    }

    // MARK: Stream keys and packets

    enum StreamDirection: String { case macToPhone = "m2p", phoneToMac = "p2m" }

    enum PacketType: UInt8 {
        case video = 0x01        // Mac → phone: one JPEG frame (header: 8-byte frame number, then the JPEG)
        case info = 0x02         // either way: JSON control (displays, quality, ack, errors, bye)
        case input = 0x10        // phone → Mac: JSON input events (remote control; only if the Mac allows it)
    }

    static func newNonce() -> Data { Data(SymmetricKey(size: .bits128).withUnsafeBytes { Array($0) }) }

    static func streamKey(token: Data, macNonce: Data, phoneNonce: Data, _ direction: StreamDirection) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: token), salt: macNonce + phoneNonce,
                               info: Data("notchapple-stream-v1|\(direction.rawValue)".utf8), outputByteCount: 32)
    }

    /// Seals and opens one direction of a stream.
    struct StreamCipher {
        let key: SymmetricKey
        private(set) var counter: UInt64 = 0
        static let maxPacket = 8 * 1024 * 1024

        init(key: SymmetricKey) { self.key = key }

        private static func nonce(_ counter: UInt64) throws -> ChaChaPoly.Nonce {
            var bytes = Data(count: 4)
            for shift in stride(from: 56, through: 0, by: -8) { bytes.append(UInt8((counter >> UInt64(shift)) & 0xFF)) }
            return try ChaChaPoly.Nonce(data: bytes)
        }

        /// A complete packet, ready to write to the connection.
        mutating func seal(_ type: PacketType, _ payload: Data) throws -> Data {
            counter += 1
            let box = try ChaChaPoly.seal(payload, using: key, nonce: Self.nonce(counter), authenticating: Data([type.rawValue]))
            let body = box.ciphertext + box.tag
            var out = Data()
            var length = UInt32(1 + 8 + body.count).bigEndian
            out.append(Data(bytes: &length, count: 4)); out.append(type.rawValue)
            var c = counter.bigEndian; out.append(Data(bytes: &c, count: 8)); out.append(body)
            return out
        }

        /// Opens the packet at the front of `buffer` and removes it. Returns nil if more bytes are needed, and throws if the
        /// packet is bad (wrong counter, tampered, too big): the stream must then be closed.
        mutating func open(from buffer: inout Data) throws -> (PacketType, Data)? {
            guard buffer.count >= 4 else { return nil }
            let start = buffer.startIndex
            let length = Int(buffer[start..<start + 4].reduce(UInt32(0)) { $0 << 8 | UInt32($1) })
            guard length >= 1 + 8 + 16, length <= Self.maxPacket else { throw StreamError.badPacket }
            guard buffer.count >= 4 + length else { return nil }
            let packet = buffer[(start + 4)..<(start + 4 + length)]
            guard let type = PacketType(rawValue: packet[packet.startIndex]) else { throw StreamError.badPacket }
            let c = packet[(packet.startIndex + 1)..<(packet.startIndex + 9)].reduce(UInt64(0)) { $0 << 8 | UInt64($1) }
            guard c == counter + 1 else { throw StreamError.badCounter }
            let body = packet.dropFirst(9)
            let box = try ChaChaPoly.SealedBox(nonce: Self.nonce(c), ciphertext: body.dropLast(16), tag: body.suffix(16))
            let plain = try ChaChaPoly.open(box, using: key, authenticating: Data([type.rawValue]))
            counter = c
            buffer = Data(buffer.dropFirst(4 + length))
            return (type, plain)
        }
    }

    enum StreamError: Error { case badPacket, badCounter }

    // MARK: Messages inside the stream

    /// What the Mac can show the phone, listed in the stream's first reply.
    struct DisplayInfo: Codable, Equatable { var id: Int; var name: String; var width: Int; var height: Int }

    /// JSON carried by `info` (and `input`) packets. Unused fields are nil.
    struct StreamNote: Codable, Equatable {
        var kind: String                 // display, quality, ack, bye, permission, error, layout, control (later: tap, drag, scroll, key)
        var display: Int? = nil
        var edge: Int? = nil             // the longest side the phone wants, in pixels
        var ack: Int64? = nil            // the newest frame number the phone has drawn
        var text: String? = nil
        var width: Int? = nil            // layout: the size of the frames now being sent
        var height: Int? = nil
        var controlAllowed: Bool? = nil  // layout: whether the Mac lets this phone control it (stage d)
    }

    // MARK: Control

    /// One thing the person does on the phone, replayed on the Mac. Positions are fractions (0...1) of the picture, so they
    /// don't depend on either screen's size.
    struct InputEvent: Codable, Equatable {
        var kind: String                 // move, down, up, drag, rdown, rup, scroll, text, key, shortcut
        var x: Double? = nil
        var y: Double? = nil
        var dx: Double? = nil            // scroll, in points
        var dy: Double? = nil
        var text: String? = nil          // text: what to type; key and shortcut: a key name or one letter
        var mods: [String]? = nil        // shortcut/key/click: cmd, shift, alt, ctrl
        var count: Int? = nil            // down: 1, 2 (double click) or 3
    }

    static func encodeInput(_ e: InputEvent) -> Data { (try? JSONEncoder().encode(e)) ?? Data() }
    static func decodeInput(_ d: Data) -> InputEvent? { try? JSONDecoder().decode(InputEvent.self, from: d) }

    /// At most `perSecond` events a second (with a short burst), so a stuck or hostile client can't flood the Mac.
    struct InputLimiter {
        let perSecond: Double, burst: Double
        private var tokens: Double
        private var last: TimeInterval
        init(perSecond: Double = 200, burst: Double = 60, now: TimeInterval = 0) { self.perSecond = perSecond; self.burst = burst; tokens = burst; last = now }
        mutating func allow(now: TimeInterval) -> Bool {
            tokens = min(burst, tokens + max(0, now - last) * perSecond); last = now
            guard tokens >= 1 else { return false }
            tokens -= 1; return true
        }
    }

    /// macOS virtual key codes (stable since the first Macs), for the keys the phone can press.
    static func keyCode(_ name: String) -> UInt16? {
        let n = name.lowercased()
        let named: [String: UInt16] = ["return": 36, "tab": 48, "space": 49, "delete": 51, "escape": 53, "forwarddelete": 117,
                                       "left": 123, "right": 124, "down": 125, "up": 126, "home": 115, "end": 119, "pageup": 116, "pagedown": 121]
        if let c = named[n] { return c }
        let letters: [Character: UInt16] = ["a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
                                            "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25,
                                            "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38,
                                            "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50]
        return n.count == 1 ? letters[n.first!] : nil
    }

    static let maxTypedText = 500
    static let controlKeys = ["return", "delete", "forwarddelete", "tab", "escape", "space", "left", "right", "up", "down", "home", "end", "pageup", "pagedown"]

    static func encodeNote(_ note: StreamNote) -> Data { (try? JSONEncoder().encode(note)) ?? Data() }
    static func decodeNote(_ data: Data) -> StreamNote? { try? JSONDecoder().decode(StreamNote.self, from: data) }

    /// A video packet's payload: the frame number, then the JPEG.
    static func videoPayload(frame: Int64, jpeg: Data) -> Data {
        var n = frame.bigEndian
        return Data(bytes: &n, count: 8) + jpeg
    }
    static func splitVideo(_ payload: Data) -> (frame: Int64, jpeg: Data)? {
        guard payload.count > 8 else { return nil }
        let start = payload.startIndex
        let n = payload[start..<start + 8].reduce(UInt64(0)) { $0 << 8 | UInt64($1) }
        return (Int64(bitPattern: n), Data(payload.dropFirst(8)))
    }
}

// MARK: - Adapting to the connection

/// Decides how much picture to send. The phone acknowledges frames; the more that are waiting, or the slower the
/// acknowledgements, the smaller and smoother the stream gets. It recovers when the link does.
struct StreamAdapter {
    var quality = 0.6                      // JPEG quality, 0.25 ... 0.8
    var scale = 1.0                        // 0.4 ... 1.0 of the size the phone asked for
    var interval = 1.0 / 12.0              // seconds between frames, 1/20 ... 1/4
    private var good = 0
    private(set) var inFlight = 0

    var shouldSend: Bool { inFlight < 3 }
    mutating func sent() { inFlight += 1 }
    /// The phone drew a frame that took `rtt` seconds from sending to its acknowledgement; `outstanding` frames are still unanswered.
    mutating func acknowledged(rtt: Double, outstanding: Int) {
        inFlight = max(0, outstanding)
        if rtt > 0.5 || outstanding >= 2 {
            good = 0
            quality = max(0.25, quality - 0.1); scale = max(0.4, scale - 0.1); interval = min(0.25, interval * 1.3)
        } else if rtt < 0.15 {
            good += 1
            if good >= 8 { good = 0; quality = min(0.8, quality + 0.05); scale = min(1, scale + 0.05); interval = max(1.0 / 20, interval * 0.9) }
        }
    }
}
