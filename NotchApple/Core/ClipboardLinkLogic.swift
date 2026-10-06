//
//  ClipboardLinkLogic.swift
//  Notch apple
//
//  Clipboard Link (Ultimate): copy on one device, paste on another. Your devices share a secret link code; text
//  is sealed with a key made from that code (AES-GCM) and passed through Notch apple's room relay, which only
//  sees scrambled bytes and an unreadable topic. The Windows app uses exactly the same format, so Macs and PCs
//  can share one clipboard. No screens and no network here, so it can be tested.
//

import CryptoKit
import Foundation

enum ClipboardLinkLogic {
    struct Envelope: Codable, Equatable {
        var v = 1
        let id: String
        let from: String     // the sending device
        let name: String     // shown as "Copied from <name>"
        let text: String
        let ts: Int64        // milliseconds since 1970
    }

    static let maxText = 100_000
    /// Clocks on two devices can differ; anything within an hour counts as current.
    static let tolerance: TimeInterval = 3600
    private static let alphabet = Array("abcdefghjkmnpqrstuvwxyz23456789")

    /// A fresh link code: 20 characters (about 99 bits), shown as 5 groups of 4.
    static func newCode() -> String {
        var rng = SystemRandomNumberGenerator()
        let chars = (0..<20).map { _ in alphabet.randomElement(using: &rng)! }
        return stride(from: 0, to: 20, by: 4).map { String(chars[$0..<$0 + 4]) }.joined(separator: "-")
    }

    /// What was typed → lowercase letters and digits only.
    static func normalize(_ raw: String) -> String {
        raw.lowercased().filter { $0.isLetter || $0.isNumber }
    }

    static func isValid(_ raw: String) -> Bool {
        let n = normalize(raw)
        return n.count == 20 && n.allSatisfy { alphabet.contains($0) }
    }

    static func key(code: String) -> SymmetricKey {
        SymmetricKey(data: SHA256.hash(data: Data("notchapple-clip-key|\(normalize(code))".utf8)))
    }

    /// The relay topic (valid for the relay's pattern: notchapple-v1- plus 40 hex characters).
    static func topic(code: String) -> String {
        let hex = SHA256.hash(data: Data("notchapple-clip-topic|\(normalize(code))".utf8)).map { String(format: "%02x", $0) }.joined()
        return "notchapple-v1-\(hex.prefix(40))"
    }

    // MARK: Sealing

    static func seal(_ e: Envelope, key: SymmetricKey) -> String? {
        guard let json = try? JSONEncoder().encode(e), let box = try? AES.GCM.seal(json, using: key).combined else { return nil }
        return box.base64EncodedString()
    }

    static func open(_ base64: String, key: SymmetricKey) -> Envelope? {
        guard let data = Data(base64Encoded: base64), let box = try? AES.GCM.SealedBox(combined: data),
              let json = try? AES.GCM.open(box, using: key) else { return nil }
        return try? JSONDecoder().decode(Envelope.self, from: json)
    }

    /// The text frame the relay forwards to everyone else on the topic.
    static func frame(sealed: String) -> String { #"{"event":"message","message":"\#(sealed)"}"# }

    /// The sealed text out of a frame the relay sent, or nil for anything else ("open", pongs...).
    static func sealed(fromFrame text: String) -> String? {
        guard let obj = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any],
              obj["event"] as? String == "message", let m = obj["message"] as? String else { return nil }
        return m
    }

    // MARK: Accepting

    enum Verdict: Equatable { case accept, ownMessage, duplicate, stale, empty, tooLong }

    /// Whether a message from another device should be applied to this clipboard.
    static func judge(_ e: Envelope, selfID: String, seen: inout Set<String>, now: Date = Date()) -> Verdict {
        if e.from == selfID { return .ownMessage }
        if seen.contains(e.id) { return .duplicate }
        if abs(now.timeIntervalSince1970 - Double(e.ts) / 1000) > tolerance { return .stale }
        if e.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .empty }
        if e.text.count > maxText { return .tooLong }
        seen.insert(e.id)
        if seen.count > 200 { seen = Set(seen.suffix(100)) }
        return .accept
    }
}
