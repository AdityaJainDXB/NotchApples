//
//  EntitlementLogicTests.swift
//  Notch apple tests
//
//  Tokens from the licence server's own sandbox test (server/license-worker/test/fixture.json), so these prove the app
//  and the server agree on the format and the signature, plus the content pack format.
//

import XCTest

final class EntitlementLogicTests: XCTestCase {
    private struct Fixture: Decodable { let publicKey: String; let ent: String; let pass: String; let passPro: String; let expired: String }
    private lazy var fixture: Fixture = {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../server/license-worker/test/fixture.json")
        return try! JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }()
    private var pub: Data { Data(base64Encoded: fixture.publicKey)! }

    func testGenuineTokensVerify() {
        XCTAssertEqual(EntitlementLogic.verify(fixture.ent, kind: "ent1", publicKey: pub)?.tier, 2)
        XCTAssertEqual(EntitlementLogic.verify(fixture.pass, kind: "pass1", publicKey: pub)?.tier, 2)
        XCTAssertEqual(EntitlementLogic.verify(fixture.passPro, kind: "pass1", publicKey: pub)?.tier, 1)
    }

    func testTheWrongKindExpiredAndTamperedTokensFail() {
        XCTAssertNil(EntitlementLogic.verify(fixture.pass, kind: "ent1", publicKey: pub), "a pass is not a token")
        XCTAssertNil(EntitlementLogic.verify(fixture.ent, kind: "pass1", publicKey: pub), "a token is not a pass")
        XCTAssertNil(EntitlementLogic.verify(fixture.expired, kind: "pass1", publicKey: pub), "expired")
        var parts = fixture.pass.split(separator: ".").map(String.init)
        parts[1] = String(parts[1].dropLast(2)) + "AA"
        XCTAssertNil(EntitlementLogic.verify(parts.joined(separator: "."), kind: "pass1", publicKey: pub), "changed payload")
        XCTAssertNil(EntitlementLogic.verify("", kind: "pass1", publicKey: pub))
        XCTAssertNil(EntitlementLogic.verify("pass1.a.b", kind: "pass1", publicKey: pub))
        // Another key's signature is refused.
        let other = Data(repeating: 7, count: 32)
        XCTAssertNil(EntitlementLogic.verify(fixture.pass, kind: "pass1", publicKey: other))
    }

    func testRenewalHappensWellBeforeExpiry() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertTrue(EntitlementLogic.needsRenewal(expires: nil, now: now))
        XCTAssertTrue(EntitlementLogic.needsRenewal(expires: now.addingTimeInterval(3600), now: now))
        XCTAssertFalse(EntitlementLogic.needsRenewal(expires: now.addingTimeInterval(48 * 3600), now: now))
    }

    private func pack(_ files: [(String, [UInt8])]) -> Data {
        var d: [UInt8] = [0x4E, 0x4B, 0x50, 0x31, UInt8(files.count >> 8), UInt8(files.count & 255)]
        for (name, bytes) in files {
            let n = Array(name.utf8); d.append(UInt8(n.count)); d += n
            d += [UInt8(bytes.count >> 24 & 255), UInt8(bytes.count >> 16 & 255), UInt8(bytes.count >> 8 & 255), UInt8(bytes.count & 255)]; d += bytes
        }
        return Data(d)
    }

    func testPackFilesRoundTrip() throws {
        let files = try XCTUnwrap(PackFile.parse(pack([("down1.wav", [1, 2, 3]), ("up.wav", []), ("space.wav", Array(repeating: 9, count: 300))])))
        XCTAssertEqual(files.map(\.name), ["down1.wav", "up.wav", "space.wav"])
        XCTAssertEqual(files[0].data, Data([1, 2, 3])); XCTAssertEqual(files[1].data.count, 0); XCTAssertEqual(files[2].data.count, 300)
    }

    func testBadPacksAreRefused() {
        XCTAssertNil(PackFile.parse(Data()))
        XCTAssertNil(PackFile.parse(Data("NOPE1234".utf8)))
        XCTAssertNil(PackFile.parse(pack([("../escape.wav", [1])])), "a path is not a file name")
        XCTAssertNil(PackFile.parse(pack([("a/b.wav", [1])])))
        XCTAssertNil(PackFile.parse(pack([(".hidden", [1])])))
        XCTAssertNil(PackFile.parse(pack([("ok.wav", [1, 2, 3])]).dropLast()), "cut short")
        XCTAssertNil(PackFile.parse(pack([("ok.wav", [1])]) + Data([0])), "trailing bytes")
    }
}
