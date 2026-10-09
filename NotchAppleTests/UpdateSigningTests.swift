//
//  UpdateSigningTests.swift
//  Notch apple tests
//
//  The release-signature check the updater runs before it opens a download.
//

import XCTest
import CryptoKit

final class UpdateSigningTests: XCTestCase {
    // A fixed vector made with a throwaway key (raw bytes of 7): the signature over version 1.2.3 and the digest of "abc".
    // Pinning a stored signature keeps the signed message format from changing by accident, and
    // scripts/sign-update.swift has to produce the same format.
    private let testKey = "6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw="
    private let abcDigest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    private let goldenSignature = "xaF0Pnh9KUHX+M4gtPukrN0m6gYYZz1HRNtZJPTtj85WUdGtsiUimI9Ri5u3B46PV7haJCJXZ/qy2GFAqTg3Ag=="

    func testMessageFormatIsPinned() {
        let text = String(decoding: UpdateSigning.message(version: "1.2.3", sha256Hex: "ab"), as: UTF8.self)
        XCTAssertEqual(text, "notchapple-update-v1\n1.2.3\nab\n")
    }

    func testGoldenSignatureVerifies() {
        XCTAssertEqual(UpdateSigning.verify(digestHex: abcDigest, version: "1.2.3", signatureBase64: goldenSignature, keys: [testKey]), .verified)
    }

    func testSurroundingWhitespaceInTheSignatureFileIsIgnored() {
        XCTAssertEqual(UpdateSigning.verify(digestHex: abcDigest, version: "1.2.3", signatureBase64: "  \(goldenSignature)\n", keys: [testKey]), .verified)
    }

    func testAnotherVersionIsRefused() {
        guard case .invalid = UpdateSigning.verify(digestHex: abcDigest, version: "1.2.4", signatureBase64: goldenSignature, keys: [testKey]) else { return XCTFail("a signature must not move to another version") }
    }

    func testAnotherFileIsRefused() {
        let other = String(abcDigest.dropLast()) + "0"
        guard case .invalid = UpdateSigning.verify(digestHex: other, version: "1.2.3", signatureBase64: goldenSignature, keys: [testKey]) else { return XCTFail("a signature must not move to another file") }
    }

    func testAnotherKeyIsRefused() {
        let stranger = Curve25519.Signing.PrivateKey().publicKey.rawRepresentation.base64EncodedString()
        guard case .invalid = UpdateSigning.verify(digestHex: abcDigest, version: "1.2.3", signatureBase64: goldenSignature, keys: [stranger]) else { return XCTFail("only pinned keys may sign") }
    }

    func testEitherOfSeveralPinnedKeysWorks() {
        let stranger = Curve25519.Signing.PrivateKey().publicKey.rawRepresentation.base64EncodedString()
        XCTAssertEqual(UpdateSigning.verify(digestHex: abcDigest, version: "1.2.3", signatureBase64: goldenSignature, keys: [stranger, testKey]), .verified)
    }

    func testMalformedSignaturesAreRefused() {
        let short = Data(repeating: 1, count: 63).base64EncodedString()
        for bad in ["", "not base64!!", short, goldenSignature + "AAAA"] {
            guard case .invalid = UpdateSigning.verify(digestHex: abcDigest, version: "1.2.3", signatureBase64: bad, keys: [testKey]) else { return XCTFail("accepted a malformed signature: \(bad)") }
        }
    }

    func testNoPinnedKeysMeansNothingVerifies() {
        guard case .invalid = UpdateSigning.verify(digestHex: abcDigest, version: "1.2.3", signatureBase64: goldenSignature, keys: []) else { return XCTFail("verified with no keys") }
        guard case .invalid = UpdateSigning.verify(digestHex: abcDigest, version: "1.2.3", signatureBase64: goldenSignature, keys: ["!!!", "AAAA"]) else { return XCTFail("verified with unusable keys") }
    }

    func testShippedKeysAreValidEd25519Keys() {
        XCTAssertFalse(UpdateSigning.publicKeys.isEmpty)
        for encoded in UpdateSigning.publicKeys {
            let raw = Data(base64Encoded: encoded)
            XCTAssertEqual(raw?.count, 32, "a pinned key that doesn't decode would silently refuse every signed update")
            XCTAssertNotNil(raw.flatMap { try? Curve25519.Signing.PublicKey(rawRepresentation: $0) })
        }
    }

    func testDigestOfAFile() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("sign-test-\(UUID().uuidString).bin")
        try Data("abc".utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        XCTAssertEqual(try UpdateSigning.sha256Hex(of: file), abcDigest)
    }

    func testSigningAndCheckingARealFile() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("sign-test-\(UUID().uuidString).dmg")
        try Data((0..<5000).map { UInt8($0 % 251) }).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let key = Curve25519.Signing.PrivateKey()
        let pinned = key.publicKey.rawRepresentation.base64EncodedString()
        let digest = try UpdateSigning.sha256Hex(of: file)
        let signature = try key.signature(for: UpdateSigning.message(version: "3.0.0", sha256Hex: digest)).base64EncodedString()

        XCTAssertEqual(UpdateSigning.outcome(file: file, version: "3.0.0", signatureText: signature, keys: [pinned]), .verified)
        guard case .invalid = UpdateSigning.outcome(file: file, version: "3.0.1", signatureText: signature, keys: [pinned]) else { return XCTFail("another version verified") }

        var tampered = try Data(contentsOf: file)
        tampered[100] ^= 0xFF
        try tampered.write(to: file)
        guard case .invalid = UpdateSigning.outcome(file: file, version: "3.0.0", signatureText: signature, keys: [pinned]) else { return XCTFail("a changed file verified") }
    }

    func testAMissingFileIsRefusedNotWaved() {
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent("does-not-exist-\(UUID().uuidString).dmg")
        guard case .invalid = UpdateSigning.outcome(file: missing, version: "1.2.3", signatureText: goldenSignature, keys: [testKey]) else { return XCTFail("an unreadable file must not pass") }
    }

    func testNoSignatureFileIsUnsigned() {
        let any = FileManager.default.temporaryDirectory.appendingPathComponent("x.dmg")
        XCTAssertEqual(UpdateSigning.outcome(file: any, version: "1.2.3", signatureText: nil, keys: [testKey]), .unsigned)
    }

    func testWhatInstalls() {
        XCTAssertTrue(UpdateSigning.allows(.verified, require: false))
        XCTAssertTrue(UpdateSigning.allows(.verified, require: true))
        XCTAssertTrue(UpdateSigning.allows(.unsigned, require: false), "the transition: unsigned releases still install until signing is required")
        XCTAssertFalse(UpdateSigning.allows(.unsigned, require: true))
        XCTAssertFalse(UpdateSigning.allows(.invalid("x"), require: false), "a wrong signature is never accepted")
        XCTAssertFalse(UpdateSigning.allows(.invalid("x"), require: true))
    }

    func testRefusalsSayWhy() {
        XCTAssertEqual(UpdateSigning.refusal(.invalid("because")), "because")
        XCTAssertFalse(UpdateSigning.refusal(.unsigned).isEmpty)
    }

    func testSignatureLivesNextToTheDMG() {
        let dmg = URL(string: "https://github.com/AdityaJainDXB/NotchApples/releases/download/v2.0.47/NotchApple-2.0.47.dmg")!
        XCTAssertEqual(UpdateSigning.signatureURL(for: dmg)?.absoluteString, dmg.absoluteString + ".sig")
    }
}
