//
//  UpdateSigning.swift
//  Notch apple
//
//  Checks that an update was signed by the release key before it is opened. The app is only ad-hoc signed, so the
//  system's own signature checks prove nothing about who built a download. This does: each release carries
//  <dmg name>.sig, an Ed25519 signature made with a key that stays off GitHub, and the matching public key is
//  pinned below. See docs/UPDATE_SIGNING.md and scripts/sign-update.swift.
//
//  Pure logic (Foundation and CryptoKit only) so the tests compile it directly.
//

import Foundation
import CryptoKit

enum UpdateSigning {
    /// Public keys that may sign releases (base64 of the raw 32-byte Ed25519 key). A second key here allows the
    /// release key to be rotated without stranding older installs.
    static let publicKeys: [String] = [
        "tyBZSMNcMPr3Lsmil18RISs2ga5MGkng8RpjFTAAfiI=",
    ]

    /// While false, a release with no signature file still installs: the signing step in CI starts with this
    /// version, and older releases (and any run without the key) are unsigned. A signature that is present but wrong
    /// is always refused. Set to true once releases are being signed, so an unsigned download is refused too.
    static let requireSignature = false

    enum Outcome: Equatable {
        case verified
        /// The release has no signature file.
        case unsigned
        /// A signature exists but doesn't check out, or couldn't be fetched.
        case invalid(String)
    }

    static let messagePrefix = "notchapple-update-v1"

    /// What is signed: the version and the file's digest, so a signature can't move to another version or file.
    static func message(version: String, sha256Hex: String) -> Data {
        Data("\(messagePrefix)\n\(version)\n\(sha256Hex)\n".utf8)
    }

    /// Lowercase hex SHA-256 of a file, read in chunks so a large DMG isn't held in memory.
    static func sha256Hex(of file: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 4 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    static func verify(digestHex: String, version: String, signatureBase64: String, keys: [String] = publicKeys) -> Outcome {
        guard let signature = Data(base64Encoded: signatureBase64.trimmingCharacters(in: .whitespacesAndNewlines)),
              signature.count == 64 else { return .invalid("The update's signature file isn't valid.") }
        let message = message(version: version, sha256Hex: digestHex)
        for encoded in keys {
            guard let raw = Data(base64Encoded: encoded), let key = try? Curve25519.Signing.PublicKey(rawRepresentation: raw) else { continue }
            if key.isValidSignature(signature, for: message) { return .verified }
        }
        return .invalid("The update's signature doesn't match, so it wasn't installed.")
    }

    /// Checks a downloaded file against the signature text published with it (nil when the release has none).
    static func outcome(file: URL, version: String, signatureText: String?, keys: [String] = publicKeys) -> Outcome {
        guard let signatureText else { return .unsigned }
        do { return verify(digestHex: try sha256Hex(of: file), version: version, signatureBase64: signatureText, keys: keys) }
        catch { return .invalid("Couldn't read the download to check its signature.") }
    }

    /// Whether to go ahead and install.
    static func allows(_ outcome: Outcome, require: Bool = requireSignature) -> Bool {
        switch outcome {
        case .verified: true
        case .unsigned: !require
        case .invalid: false
        }
    }

    /// What to tell the person when an update is refused.
    static func refusal(_ outcome: Outcome) -> String {
        switch outcome {
        case .verified: ""
        case .unsigned: "This update isn't signed, so it wasn't installed. You can download it from GitHub instead."
        case .invalid(let reason): reason
        }
    }

    /// Where a DMG's signature is published: the same address with ".sig" on the end.
    static func signatureURL(for dmg: URL) -> URL? { URL(string: dmg.absoluteString + ".sig") }
}
