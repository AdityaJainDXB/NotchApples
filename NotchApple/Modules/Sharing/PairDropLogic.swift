//
//  PairDropLogic.swift
//  Notch apple
//
//  The rules of PairDrop with no networking in them, so they can be tested: the message header both sides
//  speak, how a frame is length-prefixed, safe file names, the cap on wrong-code guesses, the display name, and
//  who may send a chat message.
//
//  Wire format (one TCP connection per file or message):
//    sender   → [4-byte big-endian length][JSON header]
//    receiver → 1 byte: 1 accept, 0 wrong code, 2 too many wrong codes (locked for a minute)
//    sender   → the file's bytes (files only; chat text travels inside the header)
//    receiver → 1 byte: 1 saved, 0 failed (files only)
//

import Foundation

struct PairDropHeader: Codable, Equatable {
    enum Kind: String, Codable { case file, hello, message }

    var kind: Kind = .file
    var code: String
    var fileName = ""
    var size = 0
    var sender: String
    /// The sender's own Bonjour service name, so a reply can find its way back.
    var senderService = ""
    /// For `hello`: the code the other side must put on its replies.
    var replyCode = ""
    var text = ""

    init(kind: Kind = .file, code: String, fileName: String = "", size: Int = 0, sender: String,
         senderService: String = "", replyCode: String = "", text: String = "") {
        self.kind = kind; self.code = code; self.fileName = fileName; self.size = size
        self.sender = sender; self.senderService = senderService; self.replyCode = replyCode; self.text = text
    }

    // Older versions only send code, fileName, size and sender; everything else is optional on the way in.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decodeIfPresent(Kind.self, forKey: .kind) ?? .file
        code = try c.decode(String.self, forKey: .code)
        fileName = try c.decodeIfPresent(String.self, forKey: .fileName) ?? ""
        size = try c.decodeIfPresent(Int.self, forKey: .size) ?? 0
        sender = try c.decodeIfPresent(String.self, forKey: .sender) ?? "Unknown"
        senderService = try c.decodeIfPresent(String.self, forKey: .senderService) ?? ""
        replyCode = try c.decodeIfPresent(String.self, forKey: .replyCode) ?? ""
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
    }
}

enum PairDropLogic {
    static let maxHeader = 64_000
    static let maxMessageLength = 4_000

    // MARK: Frames

    static func encode(_ header: PairDropHeader) -> Data? {
        guard let json = try? JSONEncoder().encode(header), json.count <= maxHeader else { return nil }
        var length = UInt32(json.count).bigEndian
        var out = Data(bytes: &length, count: 4)
        out.append(json)
        return out
    }

    /// The length in the first four bytes of a frame, or nil if it is empty or too large to be believed.
    static func frameLength(_ four: Data) -> Int? {
        guard four.count == 4 else { return nil }
        let n = Int(four.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self).bigEndian })
        return n > 0 && n <= maxHeader ? n : nil
    }

    static func decode(_ json: Data) -> PairDropHeader? { try? JSONDecoder().decode(PairDropHeader.self, from: json) }

    // MARK: Codes and names

    static func isValidCode(_ s: String) -> Bool { s.count == 6 && s.allSatisfy(\.isNumber) }

    /// A name that can't point outside Downloads or hide as a dot file.
    static func safeFileName(_ raw: String) -> String {
        var name = (raw as NSString).lastPathComponent
            .replacingOccurrences(of: ":", with: "-")
            .unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }.map(String.init).joined()
            .trimmingCharacters(in: .whitespaces)
        if name.hasPrefix(".") { name = "_" + name.dropFirst() }
        if name.isEmpty || name == "_" { name = "file" }
        return String(name.prefix(200))
    }

    /// "photo.jpg", then "1-photo.jpg", "2-photo.jpg"… for the first one that is free.
    static func uniqueName(_ base: String, exists: (String) -> Bool) -> String {
        var candidate = base, n = 1
        while exists(candidate) { candidate = "\(n)-\(base)"; n += 1 }
        return candidate
    }

    /// The name shown to the other person: trimmed, no control characters, at most 32 characters.
    static func displayName(_ raw: String, fallback: String) -> String {
        let cleaned = raw.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }.map(String.init).joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? fallback : String(cleaned.prefix(32))
    }

    static func clampMessage(_ s: String) -> String { String(s.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxMessageLength)) }

    // MARK: Chat

    /// Who is allowed to send a message: a device that already started a chat and quotes the code agreed for it.
    struct Session: Equatable {
        let peerService: String
        let peerName: String
        /// What this side puts on messages it sends.
        let sendCode: String
        /// What this side expects on messages it receives.
        let expectCode: String
    }

    static func authorised(_ header: PairDropHeader, sessions: [String: Session]) -> Bool {
        guard header.kind == .message, !header.senderService.isEmpty, let s = sessions[header.senderService] else { return false }
        return header.code == s.expectCode
    }
}

/// Stops anyone on the Wi-Fi guessing the six digits: five wrong codes in a minute locks it for a minute.
struct PairDropAttemptLimiter {
    var maxFailures = 5
    var window: TimeInterval = 60
    var lockFor: TimeInterval = 60
    private var failures: [Date] = []
    private var lockedUntil: Date?

    func isLocked(now: Date = Date()) -> Bool { (lockedUntil ?? .distantPast) > now }

    mutating func recordFailure(now: Date = Date()) {
        failures = failures.filter { now.timeIntervalSince($0) < window } + [now]
        if failures.count >= maxFailures { lockedUntil = now.addingTimeInterval(lockFor); failures = [] }
    }

    mutating func recordSuccess() { failures = []; lockedUntil = nil }
}
