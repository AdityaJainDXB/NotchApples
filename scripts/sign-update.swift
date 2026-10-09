#!/usr/bin/env swift
//
//  sign-update.swift
//  Signs a release DMG for the in-app updater, and checks signatures.
//
//    swift scripts/sign-update.swift keygen
//        Prints a new release key pair (base64). Keep the private key secret (GitHub secret UPDATE_SIGNING_KEY);
//        the public key goes into UpdateSigning.publicKeys in the app.
//
//    UPDATE_SIGNING_KEY=<private key> swift scripts/sign-update.swift sign <file.dmg> <version>
//        Writes <file.dmg>.sig. Refuses to sign if the key isn't one the app pins, since the app would reject it.
//
//    swift scripts/sign-update.swift verify <file.dmg> <version> [<file.dmg.sig>]
//        Checks a signature against the keys pinned in the app.
//
//  The signed message is "notchapple-update-v1\n<version>\n<sha256 of the file, lowercase hex>\n", so a signature
//  can't be moved to another file or another version. It must match UpdateSigning.message in the app.
//

import Foundation
import CryptoKit

let appSource = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("NotchApple/Core/UpdateSigning.swift")

func fail(_ text: String) -> Never {
    FileHandle.standardError.write(Data((text + "\n").utf8))
    exit(1)
}

func sha256Hex(_ file: URL) -> String {
    guard let handle = try? FileHandle(forReadingFrom: file) else { fail("Can't read \(file.path)") }
    defer { try? handle.close() }
    var hasher = SHA256()
    while let chunk = try? handle.read(upToCount: 4 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
}

func message(version: String, digest: String) -> Data {
    Data("notchapple-update-v1\n\(version)\n\(digest)\n".utf8)
}

/// The keys the app pins: every 44-character base64 string in UpdateSigning.swift's publicKeys list.
func pinnedKeys() -> [String] {
    guard let text = try? String(contentsOf: appSource, encoding: .utf8),
          let declaration = text.range(of: "static let publicKeys"),
          // The list starts after "= [": the first "]" in the file is the one in the "[String]" type.
          let start = text.range(of: "= [", range: declaration.upperBound..<text.endIndex),
          let end = text.range(of: "]", range: start.upperBound..<text.endIndex) else { fail("Can't read the pinned keys from \(appSource.path)") }
    let list = String(text[start.upperBound..<end.lowerBound])
    let regex = try! NSRegularExpression(pattern: "\"([A-Za-z0-9+/]{43}=)\"")
    return regex.matches(in: list, range: NSRange(list.startIndex..., in: list)).compactMap {
        Range($0.range(at: 1), in: list).map { String(list[$0]) }
    }
}

/// The private key from UPDATE_SIGNING_KEY. Refuses one whose public half the app doesn't pin, since the app would reject what it signs.
func signingKey() -> Curve25519.Signing.PrivateKey {
    guard let b64 = ProcessInfo.processInfo.environment["UPDATE_SIGNING_KEY"], !b64.isEmpty,
          let raw = Data(base64Encoded: b64.trimmingCharacters(in: .whitespacesAndNewlines)),
          let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: raw) else { fail("UPDATE_SIGNING_KEY is missing or isn't a base64 private key.") }
    let pub = key.publicKey.rawRepresentation.base64EncodedString()
    guard pinnedKeys().contains(pub) else { fail("This key's public half (\(pub)) isn't in UpdateSigning.publicKeys, so the app would reject the signature.") }
    return key
}

func hex(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

/// What the gallery signs: the digest of index.json's exact bytes (must match PluginPinning.message in the app).
func pluginMessage(_ index: Data) -> Data { Data("notchapple-plugins-v1\n\(hex(index))\n".utf8) }

func jsonString(_ s: String) -> String {
    String(data: try! JSONSerialization.data(withJSONObject: s, options: [.fragmentsAllowed, .withoutEscapingSlashes]), encoding: .utf8)!
}

func readPluginIndex(_ dir: URL) -> [[String: String]] {
    guard let data = try? Data(contentsOf: dir.appendingPathComponent("index.json")),
          let list = try? JSONSerialization.jsonObject(with: data) as? [[String: String]] else { fail("Can't read \(dir.path)/index.json") }
    return list
}

func verify(signature: Data, version: String, digest: String) -> Bool {
    let msg = message(version: version, digest: digest)
    return pinnedKeys().contains { b64 in
        guard let raw = Data(base64Encoded: b64), let key = try? Curve25519.Signing.PublicKey(rawRepresentation: raw) else { return false }
        return key.isValidSignature(signature, for: msg)
    }
}

let args = Array(CommandLine.arguments.dropFirst())
switch args.first {
case "keygen":
    let key = Curve25519.Signing.PrivateKey()
    print("private (secret, UPDATE_SIGNING_KEY): \(key.rawRepresentation.base64EncodedString())")
    print("public  (goes in UpdateSigning.publicKeys): \(key.publicKey.rawRepresentation.base64EncodedString())")

case "sign":
    guard args.count == 3 else { fail("Usage: sign <file.dmg> <version>") }
    let key = signingKey()
    let file = URL(fileURLWithPath: args[1]), version = args[2]
    let digest = sha256Hex(file)
    guard let signature = try? key.signature(for: message(version: version, digest: digest)) else { fail("Signing failed.") }
    let out = URL(fileURLWithPath: args[1] + ".sig")
    try? (signature.base64EncodedString() + "\n").write(to: out, atomically: true, encoding: .utf8)
    guard verify(signature: signature, version: version, digest: digest) else { fail("The new signature doesn't verify.") }
    print("Signed \(file.lastPathComponent) \(version) -> \(out.lastPathComponent)")

case "verify":
    guard args.count >= 3 else { fail("Usage: verify <file.dmg> <version> [<file.dmg.sig>]") }
    let sigPath = args.count > 3 ? args[3] : args[1] + ".sig"
    guard let text = try? String(contentsOfFile: sigPath, encoding: .utf8),
          let signature = Data(base64Encoded: text.trimmingCharacters(in: .whitespacesAndNewlines)) else { fail("Can't read a base64 signature from \(sigPath)") }
    if verify(signature: signature, version: args[2], digest: sha256Hex(URL(fileURLWithPath: args[1]))) { print("Signature OK") } else { fail("Signature does NOT match") }

case "pin-plugins":
    // Writes every plugin's SHA-256 into plugins/index.json, then signs the finished index (index.json.sig).
    guard args.count == 2 else { fail("Usage: pin-plugins <plugins folder>") }
    let key = signingKey()
    let dir = URL(fileURLWithPath: args[1])
    var lines: [String] = []
    for entry in readPluginIndex(dir) {
        guard let name = entry["name"], let description = entry["description"], let author = entry["author"], let file = entry["file"],
              file.range(of: #"^[A-Za-z0-9][A-Za-z0-9._-]*$"#, options: .regularExpression) != nil, !file.contains("..") else { fail("A gallery entry is missing a field or has an unsafe file name: \(entry)") }
        guard let content = try? Data(contentsOf: dir.appendingPathComponent(file)) else { fail("Can't read \(file)") }
        lines.append("  {\"name\": \(jsonString(name)), \"description\": \(jsonString(description)), \"author\": \(jsonString(author)), \"file\": \(jsonString(file)), \"sha256\": \"\(hex(content))\"}")
    }
    let index = Data(("[\n" + lines.joined(separator: ",\n") + "\n]\n").utf8)
    try! index.write(to: dir.appendingPathComponent("index.json"))
    guard let signature = try? key.signature(for: pluginMessage(index)) else { fail("Signing failed.") }
    try! Data((signature.base64EncodedString() + "\n").utf8).write(to: dir.appendingPathComponent("index.json.sig"))
    print("Pinned \(lines.count) plugin(s) and signed index.json")

case "verify-plugins":
    // Checks the signature on plugins/index.json and that every plugin file still matches its listed hash.
    guard args.count == 2 else { fail("Usage: verify-plugins <plugins folder>") }
    let dir = URL(fileURLWithPath: args[1])
    guard let index = try? Data(contentsOf: dir.appendingPathComponent("index.json")),
          let text = try? String(contentsOf: dir.appendingPathComponent("index.json.sig"), encoding: .utf8),
          let signature = Data(base64Encoded: text.trimmingCharacters(in: .whitespacesAndNewlines)) else { fail("index.json or index.json.sig is missing or unreadable") }
    let message = pluginMessage(index)
    let good = pinnedKeys().contains { b64 in
        guard let raw = Data(base64Encoded: b64), let pub = try? Curve25519.Signing.PublicKey(rawRepresentation: raw) else { return false }
        return pub.isValidSignature(signature, for: message)
    }
    if !good { fail("index.json's signature does NOT match. Run pin-plugins after changing a plugin or the index.") }
    var bad = 0
    for entry in readPluginIndex(dir) {
        guard let file = entry["file"], let want = entry["sha256"], let content = try? Data(contentsOf: dir.appendingPathComponent(file)) else { print("MISSING hash or file: \(entry["file"] ?? "?")"); bad += 1; continue }
        if hex(content) == want.lowercased() { print("ok   \(file)") } else { print("DIFF \(file) no longer matches the signed hash"); bad += 1 }
    }
    if bad > 0 { fail("\(bad) plugin(s) don't match. Run pin-plugins to re-pin and re-sign.") }
    print("Gallery signature OK")

default:
    fail("Usage: sign-update.swift keygen | sign <file> <version> | verify <file> <version> [<sig>] | pin-plugins <folder> | verify-plugins <folder>")
}
