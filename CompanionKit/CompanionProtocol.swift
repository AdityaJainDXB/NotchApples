//
//  CompanionProtocol.swift
//  Notch apple (shared by the Mac app and the iPhone companion)
//
//  How the iPhone talks to the Mac, with no server in between:
//   • The Mac advertises `_notchapple._tcp` on the local network (Bonjour).
//   • Pairing: the Mac shows a 6-digit code for 2 minutes; the phone sends
//     {type: pair} sealed with a key derived from that code, and gets back a
//     random 32-byte token sealed the same way.
//   • After that every request is sealed with the token (ChaChaPoly), so
//     nobody else on the Wi-Fi can read or forge it.
//   • One request per connection: [4-byte length][JSON envelope], answered the same way.
//

import CryptoKit
import Foundation

enum Companion {
    static let serviceType = "_notchapple._tcp"
    static let protocolVersion = 1

    /// What's on the wire: who's talking (a device ID, or "pair") and the sealed body.
    struct Envelope: Codable {
        var d: String
        var b: String
    }

    /// Everything the phone can ask. Unused fields are nil.
    struct Message: Codable, Equatable {
        enum Kind: String, Codable { case pair, paired, push, status, control, ok, error }
        var type: Kind
        var name: String? = nil          // pair: the phone's name; paired: the Mac's name
        var device: String? = nil        // paired: the phone's new ID
        var token: String? = nil         // paired: base64 32-byte token
        var text: String? = nil          // push: text; error: message
        var url: String? = nil           // push: a link
        var action: String? = nil        // control: playPause, next, previous, toggleNotch, timer5, timer25, keepAwake, stopTimer
        var status: Status? = nil        // status reply
        var version: Int? = Companion.protocolVersion
    }

    struct Status: Codable, Equatable {
        var macName: String
        var battery: Int?
        var charging: Bool
        var playing: Bool
        var title: String?
        var artist: String?
        var timer: String?
        var notchOpen: Bool
        var tier: String
    }

    static let controlActions: [(id: String, title: String, symbol: String)] = [
        ("playPause", "Play / Pause", "playpause.fill"), ("previous", "Previous", "backward.fill"), ("next", "Next", "forward.fill"),
        ("toggleNotch", "Open the notch", "rectangle.topthird.inset.filled"), ("timer5", "5-minute timer", "timer"),
        ("timer25", "25-minute focus", "brain.head.profile"), ("stopTimer", "Stop timer", "stop.circle"), ("keepAwake", "Keep awake 1 h", "cup.and.saucer.fill"),
    ]

    // MARK: Keys

    static func pairingKey(code: String) -> SymmetricKey {
        SymmetricKey(data: SHA256.hash(data: Data("notchapple-pair-v1|\(code)".utf8)))
    }

    static func key(token: Data) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: token), info: Data("notchapple-companion-v1".utf8), outputByteCount: 32)
    }

    static func newCode() -> String { String(format: "%06d", Int.random(in: 0...999_999)) }
    static func newToken() -> Data { Data(SymmetricKey(size: .bits256).withUnsafeBytes { Array($0) }) }

    // MARK: Sealing

    static func seal(_ message: Message, from device: String, key: SymmetricKey) throws -> Data {
        let body = try ChaChaPoly.seal(JSONEncoder().encode(message), using: key).combined
        let env = try JSONEncoder().encode(Envelope(d: device, b: body.base64EncodedString()))
        var length = UInt32(env.count).bigEndian
        return Data(bytes: &length, count: 4) + env
    }

    static func envelope(from frame: Data) -> Envelope? {
        guard frame.count > 4 else { return nil }
        let length = frame.prefix(4).reduce(UInt32(0)) { $0 << 8 | UInt32($1) }
        guard length < 1_000_000, frame.count >= 4 + Int(length) else { return nil }
        return try? JSONDecoder().decode(Envelope.self, from: frame.dropFirst(4).prefix(Int(length)))
    }

    static func open(_ env: Envelope, key: SymmetricKey) -> Message? {
        guard let data = Data(base64Encoded: env.b), let box = try? ChaChaPoly.SealedBox(combined: data),
              let plain = try? ChaChaPoly.open(box, using: key) else { return nil }
        return try? JSONDecoder().decode(Message.self, from: plain)
    }

    /// The length a complete frame needs, once the 4-byte header has arrived.
    static func frameLength(_ data: Data) -> Int? {
        guard data.count >= 4 else { return nil }
        return 4 + Int(data.prefix(4).reduce(UInt32(0)) { $0 << 8 | UInt32($1) })
    }
}
