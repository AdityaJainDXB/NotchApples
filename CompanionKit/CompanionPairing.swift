//
//  CompanionPairing.swift
//  Notch apple (shared by the Mac app and the iPhone companion)
//
//  The pairing and replay rules, kept apart from the sockets so both ends and the tests use the same code.
//
//   • Pairing code: 12 characters (60 bits). The old 6-digit code could be recovered in milliseconds from one
//     captured pairing, because a guess could be checked offline. 60 bits can't be searched.
//   • Ephemeral keys: both sides add a fresh X25519 exchange, mixed with the code. Learning the code later (a photo of
//     the screen, say) doesn't open a recorded pairing, because the ephemeral private keys are gone.
//   • Attempt limit: the Mac stops accepting a code after five wrong tries.
//   • Request counter: every request carries a number that must go up, near the Mac's clock, so a captured request can't
//     be played back later.
//

import CryptoKit
import Foundation

extension Companion {
    /// Pairing version 2 (ephemeral keys, long code). The numeric version 1 was removed: it was the weakness.
    static let pairVersion = 2
    /// The envelope's device field that marks a version 2 pairing request.
    static let pairDevice = "pair2"

    // MARK: The code

    /// Crockford base32: digits and letters without I, L, O or U, so a code read off a screen can't be mistyped as another.
    static let codeAlphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    static let codeLength = 12

    static func newCode() -> String {
        var rng = SystemRandomNumberGenerator()
        // 32 divides 2^64, so every character is equally likely.
        return String((0..<codeLength).map { _ in codeAlphabet[Int(rng.next() % 32)] })
    }

    /// What someone typed, as the canonical code, or nil when it can't be one. Case, spaces and dashes don't matter, and
    /// O reads as 0 and I or L as 1 (as Crockford base32 does).
    static func normalizedCode(_ typed: String) -> String? {
        let mapped = typed.uppercased().compactMap { c -> Character? in
            switch c {
            case "-", " ", "\u{2013}", "\u{2014}": return nil
            case "O": return "0"
            case "I", "L": return "1"
            default: return c
            }
        }
        guard mapped.count == codeLength, mapped.allSatisfy({ codeAlphabet.contains($0) }) else { return nil }
        return String(mapped)
    }

    /// "ABCD-EFGH-JKMN", for showing and for typing into.
    static func displayCode(_ code: String) -> String {
        stride(from: 0, to: code.count, by: 4).map { String(code.dropFirst($0).prefix(4)) }.joined(separator: "-")
    }

    /// The key a pairing request is sealed with. The code is already random and long, so no slow hash is needed.
    static func pairingKey(code: String) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: Data((normalizedCode(code) ?? code).utf8)),
                               salt: Data("notchapple-pair-v2".utf8), info: Data("code".utf8), outputByteCount: 32)
    }

    // MARK: Ephemeral keys

    enum PairingError: Error { case badKey, weakSharedSecret }

    /// The key the Mac's reply (which carries the token) is sealed with. Each side calls this with its own ephemeral private
    /// key and the other's public key. The code goes in as the salt, so only someone who knew the code can derive it, and the
    /// ephemeral exchange means knowing the code afterwards isn't enough.
    static func pairingSessionKey(code: SymmetricKey, mine: Curve25519.KeyAgreement.PrivateKey, theirs: Data,
                                  phonePublic: Data, macPublic: Data) throws -> SymmetricKey {
        guard let peer = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: theirs) else { throw PairingError.badKey }
        let shared = try mine.sharedSecretFromKeyAgreement(with: peer)
        // A low-order public key makes the shared secret all zeros; nobody legitimate sends one.
        guard shared.withUnsafeBytes({ $0.contains { $0 != 0 } }) else { throw PairingError.weakSharedSecret }
        let salt = code.withUnsafeBytes { Data($0) }
        return shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt,
                                              sharedInfo: Data("notchapple-pair-v2|session".utf8) + phonePublic + macPublic, outputByteCount: 32)
    }

    // MARK: Wrong tries

    /// Counts wrong pairing attempts against one code. After `limit` the code is dead, so guessing it over the network isn't
    /// possible: a 60-bit code with five tries is a one in 2^55 chance.
    struct PairingAttempts: Equatable {
        static let limit = 5
        private(set) var failures = 0
        var burned: Bool { failures >= Self.limit }
        mutating func recordFailure() { failures += 1 }
    }

    // MARK: Replay

    struct SequenceDecision: Equatable {
        var accepted: Bool
        /// What to remember as this phone's latest counter.
        var newLast: Int64?
        var reason: String?
    }

    /// The counter is the phone's clock in milliseconds, kept strictly rising. A phone that has sent one must keep sending
    /// them: that is what stops a captured request being played back, and stops one being "downgraded" by dropping the number.
    /// A phone that never has (an older iPhone app) is still accepted, until its first request with one.
    static func checkSequence(last: Int64?, seq: Int64?, now: Date, window: TimeInterval = 600) -> SequenceDecision {
        guard let seq else {
            return last == nil ? SequenceDecision(accepted: true, newLast: nil, reason: nil)
                               : SequenceDecision(accepted: false, newLast: last, reason: "Update the Notch apple app on your iPhone.")
        }
        guard abs(Double(seq) / 1000 - now.timeIntervalSince1970) <= window else {
            return SequenceDecision(accepted: false, newLast: last, reason: "Check the date and time on your iPhone and Mac.")
        }
        if let last, seq <= last { return SequenceDecision(accepted: false, newLast: last, reason: "That request was already used.") }
        return SequenceDecision(accepted: true, newLast: seq, reason: nil)
    }

    /// The next counter: the clock in milliseconds, but always above the last one sent.
    static func nextSequence(after last: Int64, now: Date = .now) -> Int64 {
        max(last + 1, Int64(now.timeIntervalSince1970 * 1000))
    }
}
