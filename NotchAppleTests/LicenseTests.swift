//
//  LicenseTests.swift
//  Notch apple tests
//
//  Signed product keys and tiers. The keys come from the license server's own
//  sandbox test (server/license-worker/test/fixture.json, written by
//  `node server/license-worker/test/test.mjs`), so these prove the app and the
//  server agree on the format and the signature.
//

import XCTest

final class LicenseTests: XCTestCase {
    private struct Fixture: Decodable { let publicKey: String; let pro: String; let ultimate: String }

    private lazy var fixture: Fixture = {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../server/license-worker/test/fixture.json")
        return try! JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }()
    private var pub: Data { Data(base64Encoded: fixture.publicKey)! }

    func testValidKeysParseWithTheirTier() throws {
        let pro = try LicenseKey.parse(fixture.pro, publicKey: pub).get()
        XCTAssertEqual(pro.tier, .pro)
        XCTAssertEqual(pro.keyID.count, 16)
        let ult = try LicenseKey.parse(fixture.ultimate, publicKey: pub).get()
        XCTAssertEqual(ult.tier, .ultimate)
        // Pasting with spaces, line breaks or lower case still works.
        let messy = fixture.pro.lowercased().replacingOccurrences(of: "-", with: "- \n")
        XCTAssertEqual(try LicenseKey.parse(messy, publicKey: pub).get().keyID, pro.keyID)
    }

    func testTamperedKeyFails() {
        var chars = Array(fixture.pro)
        let i = chars.count - 10
        chars[i] = chars[i] == "A" ? "B" : "A"
        XCTAssertEqual(LicenseKey.parse(String(chars), publicKey: pub), .failure(.tampered))
        XCTAssertEqual(LicenseKey.parse(String(fixture.pro.dropLast(6)), publicKey: pub), .failure(.tampered))
    }

    func testWrongTierLabelFails() {
        let relabelled = fixture.pro.replacingOccurrences(of: "NTCH-PRO-", with: "NTCH-ULTM-")
        XCTAssertEqual(LicenseKey.parse(relabelled, publicKey: pub), .failure(.wrongTier))
    }

    func testKeySignedByAnotherServerFails() {
        // The production public key didn't sign the sandbox keys.
        XCTAssertEqual(LicenseKey.parse(fixture.pro), .failure(.tampered))
    }

    func testNotAKey() {
        XCTAssertEqual(LicenseKey.parse("NOTCH-ABCD-EFGH", publicKey: pub), .failure(.notAKey))
        XCTAssertEqual(LicenseKey.parse("", publicKey: pub), .failure(.notAKey))
        XCTAssertFalse(LicenseKey.looksLikeKey("NOTCH-ABCD-EFGH"))
        XCTAssertTrue(LicenseKey.looksLikeKey(" ntch-pro-1234"))
    }

    func testTierResolution() throws {
        let pro = try LicenseKey.parse(fixture.pro, publicKey: pub).get()
        let ult = try LicenseKey.parse(fixture.ultimate, publicKey: pub).get()
        XCTAssertEqual(LicenseKey.tier(key: nil, revoked: [], legacyActivated: false), .free)
        // Grandfathering: an activation from before tiers is Pro.
        XCTAssertEqual(LicenseKey.tier(key: nil, revoked: [], legacyActivated: true), .pro)
        XCTAssertEqual(LicenseKey.tier(key: ult, revoked: [], legacyActivated: true), .ultimate)
        XCTAssertEqual(LicenseKey.tier(key: pro, revoked: [], legacyActivated: false), .pro)
        // Revoked keys stop counting, without touching anything else.
        XCTAssertEqual(LicenseKey.tier(key: ult, revoked: [ult.keyID], legacyActivated: false), .free)
        XCTAssertEqual(LicenseKey.tier(key: ult, revoked: [pro.keyID], legacyActivated: false), .ultimate)
    }

    func testFeatureGates() {
        for f in Feature.allCases {
            XCTAssertFalse(f.isAllowed(at: .free), "\(f) must not be free")
            XCTAssertEqual(f.isAllowed(at: .pro), f.tier == .pro, "\(f)")
            XCTAssertTrue(f.isAllowed(at: .ultimate), "Ultimate includes \(f)")
        }
        XCTAssertTrue(Tier.ultimate > Tier.pro && Tier.pro > Tier.free)
        // Nothing unfinished is sold: every Ultimate feature is hidden until it's ready.
        XCTAssertFalse(Feature.allCases.contains { $0.tier == .ultimate && $0.isReady })
    }

    func testRevocationListMustBeSigned() {
        XCTAssertNil(LicenseKey.revokedIDs(list: #"{"ids":["abc"]}"#, signature: Data(repeating: 0, count: 64).base64EncodedString(), publicKey: pub))
    }

    func testMasked() throws {
        let pro = try LicenseKey.parse(fixture.pro, publicKey: pub).get()
        XCTAssertTrue(pro.masked.hasPrefix("NTCH-PRO-"))
        XCTAssertTrue(pro.masked.contains("…"))
        XCTAssertLessThan(pro.masked.count, 40)
    }
}
