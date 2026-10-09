//
//  PluginPinning.swift
//  Notch apple
//
//  The plugin gallery downloads scripts that then run on someone's Mac, from a branch anyone with write access can change.
//  So nothing is trusted because of where it came from:
//    • plugins/index.json carries the SHA-256 of every plugin file, and plugins/index.json.sig is an Ed25519 signature over
//      that index, made with the release key (the same key the updater pins; see UpdateSigning).
//    • The app checks the signature on the index, then checks each plugin file against its hash before it is written.
//  Changing a plugin, or the index, without the private key makes the gallery refuse it.
//
//  Pure logic (Foundation and CryptoKit only) so the tests compile it directly. Needs UpdateSigning.swift for the keys.
//

import Foundation
import CryptoKit

enum PluginPinning {
    /// Different from the updater's prefix, so a signature made for one can never be passed off as the other.
    static let messagePrefix = "notchapple-plugins-v1"

    static func sha256Hex(of data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// What is signed: the digest of the exact bytes of index.json.
    static func message(indexSHA256Hex: String) -> Data {
        Data("\(messagePrefix)\n\(indexSHA256Hex)\n".utf8)
    }

    enum IndexOutcome: Equatable {
        case verified
        case unsigned
        case invalid(String)
    }

    /// Checks the downloaded index against the signature text published with it (nil when there is none).
    static func verifyIndex(_ index: Data, signatureText: String?, keys: [String] = UpdateSigning.publicKeys) -> IndexOutcome {
        guard let signatureText else { return .unsigned }
        guard let signature = Data(base64Encoded: signatureText.trimmingCharacters(in: .whitespacesAndNewlines)), signature.count == 64 else {
            return .invalid("The gallery's signature file isn't valid.")
        }
        let message = message(indexSHA256Hex: sha256Hex(of: index))
        for encoded in keys {
            guard let raw = Data(base64Encoded: encoded), let key = try? Curve25519.Signing.PublicKey(rawRepresentation: raw) else { continue }
            if key.isValidSignature(signature, for: message) { return .verified }
        }
        return .invalid("The gallery's signature doesn't match, so it wasn't trusted.")
    }

    /// Does a downloaded plugin match the hash the signed index lists for it? No hash listed means no.
    static func fileMatches(_ data: Data, sha256: String?) -> Bool {
        guard let sha256 = sha256?.lowercased(), sha256.count == 64 else { return false }
        return sha256Hex(of: data) == sha256
    }

    /// A plugin file name that can't climb out of the Plugins folder or hide itself.
    static func isSafeFileName(_ name: String) -> Bool {
        name.range(of: #"^[A-Za-z0-9][A-Za-z0-9._-]*$"#, options: .regularExpression) != nil && !name.contains("..")
    }

    /// Where the signature for an index sits: the same address with ".sig" on the end.
    static func signatureURL(for index: URL) -> URL? { URL(string: index.absoluteString + ".sig") }
}
