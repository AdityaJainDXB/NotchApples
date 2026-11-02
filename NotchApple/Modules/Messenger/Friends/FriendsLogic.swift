//
//  FriendsLogic.swift
//  Notch Apple
//
//  Messenger → Friends, the part with no screen and no network: friend codes, keys, sealing, the friendship rules and the
//  data model. The wire format is docs/FRIENDS_PROTOCOL.md; NotchWindows/src/js/services/friendscrypto.js does the same in
//  JavaScript, and both check server/room-relay/test/friends-vectors.json. Only Foundation and CryptoKit are used, so the
//  unit tests can compile this file on its own.
//

import CryptoKit
import Foundation

enum Friends {
    static let codeAlphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    static let codeLength = 10

    // MARK: Codes

    static func newCode() -> String {
        var rng = SystemRandomNumberGenerator()
        // 32 divides 2^64, so every character is equally likely.
        return String((0..<codeLength).map { _ in codeAlphabet[Int(rng.next() % 32)] })
    }

    /// What someone typed, as the canonical code, or nil. Case, spaces and dashes don't matter; O reads as 0, I and L as 1.
    static func normalizedCode(_ typed: String) -> String? {
        let mapped = typed.uppercased().compactMap { c -> Character? in
            switch c {
            case "-", " ", "\t", "\n", "\u{2013}", "\u{2014}": return nil
            case "O": return "0"
            case "I", "L": return "1"
            default: return c
            }
        }
        guard mapped.count == codeLength, mapped.allSatisfy({ codeAlphabet.contains($0) }) else { return nil }
        return String(mapped)
    }

    /// "ABCDE-FGHJK", for showing and for reading aloud.
    static func displayCode(_ code: String) -> String { "\(code.prefix(5))-\(code.dropFirst(5))" }

    /// The server's address for a code (32 hex characters); the server never sees the code itself.
    static func box(for code: String) -> String {
        hex(Data(SHA256.hash(data: Data("notchapple-friends-v1|box|\(code)".utf8)).prefix(16)))
    }

    // MARK: Small helpers

    static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
    static func b64u(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    static func unb64u(_ string: String) -> Data? {
        var s = string.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while s.count % 4 != 0 { s += "=" }
        return Data(base64Encoded: s)
    }
    static func sha256Hex(_ data: Data) -> String { hex(Data(SHA256.hash(data: data))) }

    /// A fresh send token (32 random bytes, base64url) and the hash the server stores for it.
    static func newToken() -> (token: String, hash: String) {
        let token = b64u(Data(SymmetricKey(size: .bits256).withUnsafeBytes { Array($0) }))
        return (token, tokenHash(token))
    }
    static func tokenHash(_ token: String) -> String { sha256Hex(unb64u(token) ?? Data()) }

    // MARK: QR / link form

    /// notchapple://friend?c=CODE&k=<fingerprint>: the fingerprint lets the app check the keys the server returns.
    static func link(code: String, fingerprint: Data) -> String { "notchapple://friend?c=\(code)&k=\(b64u(fingerprint))" }

    /// A typed code, or a link made by `link`, as (code, fingerprint?).
    static func parse(_ text: String) -> (code: String, fingerprint: Data?)? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let comps = URLComponents(string: t), comps.scheme == "notchapple", comps.host == "friend",
           let c = comps.queryItems?.first(where: { $0.name == "c" })?.value, let code = normalizedCode(c) {
            let fp = comps.queryItems?.first(where: { $0.name == "k" })?.value.flatMap(unb64u)
            return (code, fp)
        }
        return normalizedCode(t).map { ($0, nil) }
    }
}

// MARK: - Identity

/// This install's keys and code. The private parts are 32-byte seeds.
struct FriendIdentity: Codable, Equatable {
    var code: String
    var signSeed: Data
    var dhSeed: Data

    static func generate() -> FriendIdentity {
        FriendIdentity(code: Friends.newCode(),
                       signSeed: Curve25519.Signing.PrivateKey().rawRepresentation,
                       dhSeed: Curve25519.KeyAgreement.PrivateKey().rawRepresentation)
    }

    var signKey: Curve25519.Signing.PrivateKey { try! Curve25519.Signing.PrivateKey(rawRepresentation: signSeed) }
    var dhKey: Curve25519.KeyAgreement.PrivateKey { try! Curve25519.KeyAgreement.PrivateKey(rawRepresentation: dhSeed) }
    var signPublic: Data { signKey.publicKey.rawRepresentation }
    var dhPublic: Data { dhKey.publicKey.rawRepresentation }
    var box: String { Friends.box(for: code) }
    var fingerprint: Data { FriendCrypto.fingerprint(sign: signPublic, dh: dhPublic) }
    var link: String { Friends.link(code: code, fingerprint: fingerprint) }
}

// MARK: - Crypto

enum FriendCrypto {
    static func fingerprint(sign: Data, dh: Data) -> Data { Data(SHA256.hash(data: sign + dh).prefix(16)) }

    /// The 60 digits two friends compare out loud (the same on both sides).
    static func safetyNumber(signA: Data, dhA: Data, signB: Data, dhB: Data) -> String {
        let a = signA + dhA, b = signB + dhB
        let (first, second) = Friends.hex(a) < Friends.hex(b) ? (a, b) : (b, a)
        let h1 = Data(SHA256.hash(data: first + second))
        let bytes = h1 + Data(SHA256.hash(data: h1))
        return (0..<12).map { i in
            let n = bytes[(i * 4)..<(i * 4 + 4)].reduce(UInt32(0)) { $0 << 8 | UInt32($1) }
            return String(format: "%05d", n % 100000)
        }.joined(separator: " ")
    }

    // MARK: Signing and the server's check

    static func sign(_ text: String, with id: FriendIdentity) -> String {
        Friends.b64u((try? id.signKey.signature(for: Data(text.utf8))) ?? Data())
    }
    static func verify(sign: Data, text: String, signature: String) -> Bool {
        guard let key = try? Curve25519.Signing.PublicKey(rawRepresentation: sign), let sig = Friends.unb64u(signature) else { return false }
        return key.isValidSignature(sig, for: Data(text.utf8))
    }
    static func authMessage(method: String, path: String, ts: String, body: String) -> String {
        "nf1\n\(method)\n\(path)\n\(ts)\n\(Friends.sha256Hex(Data(body.utf8)))"
    }
    /// The `x-nf-auth` header: "<ts>.<signature>".
    static func authHeader(_ id: FriendIdentity, method: String, path: String, ts: Int64, body: String = "") -> String {
        "\(ts).\(sign(authMessage(method: method, path: path, ts: String(ts), body: body), with: id))"
    }

    // MARK: Sealing

    private struct Inner: Codable { var b: String; var s: String }
    enum SealError: Error { case badKey }

    private static func sealKey(shared: SharedSecret, recipientBox: String, ephPublic: Data) -> SymmetricKey {
        shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data("notchapple-friends-v1".utf8),
                                       sharedInfo: Data("seal|\(recipientBox)|\(Friends.b64u(ephPublic))".utf8), outputByteCount: 32)
    }

    /// Seals `bodyText` (the body already serialised as JSON) to a recipient, signed by `id`.
    /// `ephSeed` and `nonce` are only for the test vectors.
    static func seal(bodyText: String, kind: String, from id: FriendIdentity, toBox: String, toDH: Data,
                     ephSeed: Data? = nil, nonce: Data? = nil) throws -> String {
        let eph = try ephSeed.map { try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: $0) } ?? Curve25519.KeyAgreement.PrivateKey()
        guard let peer = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: toDH) else { throw SealError.badKey }
        let key = sealKey(shared: try eph.sharedSecretFromKeyAgreement(with: peer), recipientBox: toBox, ephPublic: eph.publicKey.rawRepresentation)
        let signature = sign("nf1-inner\n\(toBox)\n\(kind)\n\(bodyText)", with: id)
        let inner = try JSONEncoder().encode(Inner(b: bodyText, s: signature))
        let n = try nonce.map { try AES.GCM.Nonce(data: $0) } ?? AES.GCM.Nonce()
        let box = try AES.GCM.seal(inner, using: key, nonce: n, authenticating: Data("\(toBox)|\(kind)".utf8))
        return Friends.b64u(eph.publicKey.rawRepresentation + Data(n) + box.ciphertext + box.tag)
    }

    struct Opened: Equatable { var text: String; var signature: String }

    /// Opens a blob addressed to me, or nil. The caller then checks `isFrom` against the sender's key.
    static func open(blob: String, kind: String, myBox: String, dhSeed: Data) -> Opened? {
        guard let raw = Friends.unb64u(blob), raw.count >= 32 + 12 + 16,
              let mine = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: dhSeed) else { return nil }
        let ephPublic = raw.prefix(32), nonce = raw.dropFirst(32).prefix(12), rest = raw.dropFirst(44)
        guard let peer = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: ephPublic),
              let shared = try? mine.sharedSecretFromKeyAgreement(with: peer),
              let n = try? AES.GCM.Nonce(data: nonce),
              let sealed = try? AES.GCM.SealedBox(nonce: n, ciphertext: rest.dropLast(16), tag: rest.suffix(16)),
              let plain = try? AES.GCM.open(sealed, using: sealKey(shared: shared, recipientBox: myBox, ephPublic: Data(ephPublic)), authenticating: Data("\(myBox)|\(kind)".utf8)),
              let inner = try? JSONDecoder().decode(Inner.self, from: plain) else { return nil }
        return Opened(text: inner.b, signature: inner.s)
    }

    static func isFrom(signPublic: Data, myBox: String, kind: String, opened: Opened) -> Bool {
        verify(sign: signPublic, text: "nf1-inner\n\(myBox)\n\(kind)\n\(opened.text)", signature: opened.signature)
    }
}

// MARK: - What goes inside a sealed blob

/// One shape for every body; `t` says which fields matter (see the protocol document).
struct FriendBody: Codable, Equatable {
    var t: String                  // req, acc, msg, rcpt, typing, gone
    var box: String? = nil         // req, acc: the sender's mailbox
    var from: String? = nil        // msg, rcpt, typing, gone: the sender's mailbox
    var sign: String? = nil        // req, acc: the sender's signing key (base64url)
    var dh: String? = nil          // req, acc: the sender's key-agreement key (base64url)
    var nick: String? = nil
    var token: String? = nil       // req, acc: a send token for the sender's mailbox
    var id: String? = nil
    var text: String? = nil
    var state: String? = nil       // rcpt: delivered or read
    var ts: Int64? = nil

    func encoded() -> String {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return String(data: (try? enc.encode(self)) ?? Data(), encoding: .utf8) ?? "{}"
    }
    static func decode(_ text: String) -> FriendBody? { try? JSONDecoder().decode(FriendBody.self, from: Data(text.utf8)) }
}

// MARK: - The data model

struct FriendRecord: Codable, Identifiable, Equatable {
    enum Status: String, Codable { case outgoing, incoming, active }
    var id: String { box }
    var box: String
    var sign: Data
    var dh: Data
    var nick: String?              // the name they gave themselves (shown as untrusted text)
    var alias: String?             // my own nickname for them
    var status: Status
    var sendToken: String?         // what I show to send to THEIR mailbox
    var myTokenHash: String?       // the hash of the token I gave them for MY mailbox, so I can revoke it
    var pendingToken: String?      // incoming request: the token they gave me, kept until I accept
    var added: Date
    var unread = 0
    var lastActivity: Date

    var fingerprint: Data { FriendCrypto.fingerprint(sign: sign, dh: dh) }
    var displayName: String {
        if let a = alias, !a.isEmpty { return a }
        if let n = nick, !n.isEmpty { return n }
        return "Friend \(Friends.hex(fingerprint).prefix(4).uppercased())"
    }
}

struct FriendMessage: Codable, Identifiable, Equatable {
    enum State: String, Codable { case sending, sent, delivered, read, failed }
    var id: String
    var mine: Bool
    var text: String
    var date: Date
    var state: State
}

/// Everything kept on the device (sealed on disk by FriendsStore).
struct FriendsVault: Codable, Equatable {
    var friends: [FriendRecord] = []
    var messages: [String: [FriendMessage]] = [:]    // by friend box
    var blocked: [String] = []                       // fingerprints (hex) of people I blocked
    var seen: [String] = []                          // recent message ids, so a repeated one is dropped
}

// MARK: - The rules

/// The friendship rules, with no network: the client feeds it what arrived and does what it answers.
struct FriendsBook {
    var vault = FriendsVault()
    private static let seenLimit = 500

    enum RequestOutcome: Equatable {
        case ignored                    // blocked, already known, or malformed
        case added(FriendRecord)        // a new incoming request to show
        case mutual(FriendRecord)       // they asked me while I had asked them: both sides agree, friends now
    }

    func index(_ box: String) -> Int? { vault.friends.firstIndex { $0.box == box } }
    func record(_ box: String) -> FriendRecord? { index(box).map { vault.friends[$0] } }
    func isBlocked(sign: Data, dh: Data) -> Bool { vault.blocked.contains(Friends.hex(FriendCrypto.fingerprint(sign: sign, dh: dh))) }

    /// A request I sent: pending until they accept.
    mutating func addOutgoing(box: String, sign: Data, dh: Data, alias: String?, myTokenHash: String, now: Date = .now) {
        if let i = index(box) { vault.friends[i].myTokenHash = myTokenHash; return }
        vault.friends.append(FriendRecord(box: box, sign: sign, dh: dh, nick: nil, alias: alias, status: .outgoing, sendToken: nil,
                                          myTokenHash: myTokenHash, pendingToken: nil, added: now, lastActivity: now))
    }

    /// A request from someone else (already checked: signature good).
    mutating func receiveRequest(_ body: FriendBody, now: Date = .now) -> RequestOutcome {
        guard let box = body.box, let signText = body.sign, let dhText = body.dh, let token = body.token,
              let sign = Friends.unb64u(signText), let dh = Friends.unb64u(dhText), sign.count == 32, dh.count == 32 else { return .ignored }
        if isBlocked(sign: sign, dh: dh) { return .ignored }
        if let i = index(box) {
            if vault.friends[i].sign != sign || vault.friends[i].dh != dh { return .ignored }   // same address, different keys: never accepted silently
            switch vault.friends[i].status {
            case .outgoing:                              // we asked each other: that is agreement from both sides
                vault.friends[i].status = .active; vault.friends[i].sendToken = token; vault.friends[i].nick = Self.clean(body.nick); vault.friends[i].lastActivity = now
                return .mutual(vault.friends[i])
            case .incoming, .active: return .ignored
            }
        }
        let r = FriendRecord(box: box, sign: sign, dh: dh, nick: Self.clean(body.nick), alias: nil, status: .incoming, sendToken: nil,
                             myTokenHash: nil, pendingToken: token, added: now, lastActivity: now)
        vault.friends.append(r)
        return .added(r)
    }

    /// I press Accept: they get a token for my mailbox; I get to use the one they sent.
    mutating func accept(box: String, myTokenHash: String, now: Date = .now) -> FriendRecord? {
        guard let i = index(box), vault.friends[i].status == .incoming, let token = vault.friends[i].pendingToken else { return nil }
        vault.friends[i].status = .active; vault.friends[i].sendToken = token; vault.friends[i].pendingToken = nil
        vault.friends[i].myTokenHash = myTokenHash; vault.friends[i].lastActivity = now
        return vault.friends[i]
    }

    /// They accepted my request (the body is already checked against the keys I pinned when I added them).
    mutating func receiveAcceptance(_ body: FriendBody, now: Date = .now) -> FriendRecord? {
        guard let box = body.box, let i = index(box), vault.friends[i].status == .outgoing, let token = body.token,
              let sign = body.sign.flatMap(Friends.unb64u), let dh = body.dh.flatMap(Friends.unb64u),
              sign == vault.friends[i].sign, dh == vault.friends[i].dh else { return nil }
        vault.friends[i].status = .active; vault.friends[i].sendToken = token
        vault.friends[i].nick = Self.clean(body.nick) ?? vault.friends[i].nick; vault.friends[i].lastActivity = now
        return vault.friends[i]
    }

    /// A message from an active friend. Returns it if new.
    mutating func receiveMessage(from box: String, id: String, text: String, ts: Int64?, now: Date = .now) -> FriendMessage? {
        guard let i = index(box), vault.friends[i].status == .active, !id.isEmpty, id.count <= 64, !text.isEmpty, text.count <= 2000 else { return nil }
        if vault.seen.contains(id) { return nil }
        vault.seen.append(id); if vault.seen.count > Self.seenLimit { vault.seen.removeFirst(vault.seen.count - Self.seenLimit) }
        let date = ts.map { min(Date(timeIntervalSince1970: Double($0) / 1000), now) } ?? now
        let m = FriendMessage(id: id, mine: false, text: text, date: date, state: .delivered)
        vault.messages[box, default: []].append(m)
        vault.friends[i].unread += 1; vault.friends[i].lastActivity = now
        return m
    }

    mutating func addMine(to box: String, id: String, text: String, now: Date = .now) {
        vault.messages[box, default: []].append(FriendMessage(id: id, mine: true, text: text, date: now, state: .sending))
        if let i = index(box) { vault.friends[i].lastActivity = now }
    }

    /// Moves one of my messages forward (sending → sent → delivered → read); it never goes backwards, except to failed.
    mutating func setState(box: String, id: String, _ state: FriendMessage.State) {
        guard var list = vault.messages[box], let i = list.firstIndex(where: { $0.id == id && $0.mine }) else { return }
        func rank(_ s: FriendMessage.State) -> Int { switch s { case .failed, .sending: 0; case .sent: 1; case .delivered: 2; case .read: 3 } }
        if state == .failed ? list[i].state == .sending : rank(state) > rank(list[i].state) { list[i].state = state; vault.messages[box] = list }
    }

    mutating func markRead(box: String) { if let i = index(box) { vault.friends[i].unread = 0 } }
    mutating func setAlias(box: String, _ alias: String?) { if let i = index(box) { vault.friends[i].alias = Self.clean(alias) } }

    /// Blocks someone: they leave the list, their fingerprint is remembered, and their conversation is deleted.
    mutating func block(box: String) {
        guard let i = index(box) else { return }
        let fp = Friends.hex(vault.friends[i].fingerprint)
        if !vault.blocked.contains(fp) { vault.blocked.append(fp) }
        vault.friends.remove(at: i); vault.messages[box] = nil
    }
    mutating func remove(box: String) { vault.friends.removeAll { $0.box == box }; vault.messages[box] = nil }
    mutating func unblockAll() { vault.blocked = [] }

    /// Names are shown to the person who received them, so keep them short, single-line and free of control characters.
    static func clean(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let s = String(raw.unicodeScalars.filter { !$0.properties.isDefaultIgnorableCodePoint && !CharacterSet.controlCharacters.contains($0) }.map(Character.init))
            .trimmingCharacters(in: .whitespaces)
        return s.isEmpty ? nil : String(s.prefix(32))
    }
}
