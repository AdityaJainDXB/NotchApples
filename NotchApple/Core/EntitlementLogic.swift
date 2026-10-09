//
//  EntitlementLogic.swift
//  Notch apple
//
//  Paid value that lives on the server. After a real key is registered on this Mac, the licence server hands out two
//  short-lived signed tokens: a full token (to download paid content) and an anonymous pass (to join Clipboard Link
//  rooms on the relay). This file only checks that a token is genuine and still valid, with the same public key that
//  checks licence keys, so it is tested without the app. A token is "<kind>.<payload>.<signature>", the payload and
//  signature base64url, signed over "NOTCHAPPLE-<kind>\n<payload>". NotchWindows/src/js/services/entitle.js mirrors it.
//

import CryptoKit
import Foundation

enum EntitlementLogic {
    struct Payload: Equatable {
        let tier: Int          // 1 = Pro, 2 = Ultimate
        let expires: Date
    }

    static func base64URLDecode(_ s: String) -> Data? {
        var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while t.count % 4 != 0 { t += "=" }
        return Data(base64Encoded: t)
    }

    /// The payload of a genuine, unexpired token of this kind, or nil.
    static func verify(_ token: String, kind: String, publicKey: Data, now: Date = .now) -> Payload? {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 3, parts[0] == kind,
              let sig = base64URLDecode(parts[2]), let body = base64URLDecode(parts[1]),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey),
              key.isValidSignature(sig, for: Data("NOTCHAPPLE-\(kind)\n\(parts[1])".utf8)),
              let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let tier = (json["t"] as? NSNumber)?.intValue, [1, 2].contains(tier),
              let exp = (json["exp"] as? NSNumber)?.doubleValue else { return nil }
        let expires = Date(timeIntervalSince1970: exp)
        return expires > now ? Payload(tier: tier, expires: expires) : nil
    }

    /// Renew when less than this is left, so a token is never used in its last hours.
    static let renewBefore: TimeInterval = 12 * 3600

    static func needsRenewal(expires: Date?, now: Date = .now) -> Bool {
        guard let expires else { return true }
        return expires.timeIntervalSince(now) < renewBefore
    }
}

/// A pack of small files in one download (NKP1): the 4 bytes "NKP1", the file count (2 bytes), then for each file its
/// name length (1 byte), name, data length (4 bytes) and data. Big-endian. Names are plain file names, never paths.
enum PackFile {
    static func parse(_ data: Data) -> [(name: String, data: Data)]? {
        let b = [UInt8](data)
        guard b.count >= 6, b[0] == 0x4E, b[1] == 0x4B, b[2] == 0x50, b[3] == 0x31 else { return nil }
        let count = Int(b[4]) << 8 | Int(b[5])
        var i = 6
        var out: [(String, Data)] = []
        for _ in 0..<count {
            guard i < b.count else { return nil }
            let n = Int(b[i]); i += 1
            guard i + n + 4 <= b.count, let name = String(bytes: b[i..<i + n], encoding: .utf8) else { return nil }
            i += n
            let len = Int(b[i]) << 24 | Int(b[i + 1]) << 16 | Int(b[i + 2]) << 8 | Int(b[i + 3]); i += 4
            guard len >= 0, i + len <= b.count else { return nil }
            // A name is a plain file name: no slashes, no dots at the start, nothing that could leave the folder.
            guard !name.isEmpty, !name.contains("/"), !name.contains("\\"), !name.hasPrefix("."), name.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil else { return nil }
            out.append((name, Data(b[i..<i + len])))
            i += len
        }
        return i == b.count ? out : nil
    }
}
