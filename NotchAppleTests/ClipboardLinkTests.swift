//
//  ClipboardLinkTests.swift
//  Notch apple tests
//
//  Clipboard Link: codes, keys, sealing, and (importantly) that a message sealed by an independent implementation
//  (Node's crypto, standing in for the Windows app) opens here, so Macs and PCs understand each other.
//

import CryptoKit
import XCTest

final class ClipboardLinkTests: XCTestCase {
    private let code = "abcd-efgh-jkmn-pqrs-tuvw"
    private func env(_ id: String = "id1", from: String = "other", text: String = "hi", ts: Date = Date()) -> ClipboardLinkLogic.Envelope {
        .init(id: id, from: from, name: "Work PC", text: text, ts: Int64(ts.timeIntervalSince1970 * 1000))
    }

    func testNewCodesAreValidAndDifferent() {
        let a = ClipboardLinkLogic.newCode(), b = ClipboardLinkLogic.newCode()
        XCTAssertTrue(ClipboardLinkLogic.isValid(a))
        XCTAssertNotEqual(a, b)
        XCTAssertEqual(a.split(separator: "-").count, 5)
    }

    func testTypingStylesAllMeanTheSameCode() {
        XCTAssertEqual(ClipboardLinkLogic.normalize(" ABCD efgh-JKMN pqrs tuvw "), "abcdefghjkmnpqrstuvw")
        XCTAssertTrue(ClipboardLinkLogic.isValid("ABCD-EFGH-JKMN-PQRS-TUVW"))
        XCTAssertFalse(ClipboardLinkLogic.isValid("short"))
        XCTAssertFalse(ClipboardLinkLogic.isValid("abcd-efgh-jkmn-pqrs-tuv1o"), "letters outside the alphabet are refused")
    }

    func testTopicMatchesTheRelayPatternAndDoesNotRevealTheCode() {
        let t = ClipboardLinkLogic.topic(code: code)
        XCTAssertNotNil(t.range(of: "^notchapple-v1-[0-9a-f]{40}$", options: .regularExpression))
        XCTAssertFalse(t.contains("abcd"))
        XCTAssertEqual(t, ClipboardLinkLogic.topic(code: "ABCD EFGH JKMN PQRS TUVW"))
    }

    func testSealAndOpenRoundTrip() throws {
        let key = ClipboardLinkLogic.key(code: code)
        let sealed = try XCTUnwrap(ClipboardLinkLogic.seal(env(text: "secret 🔑"), key: key))
        XCTAssertFalse(sealed.contains("secret"))
        XCTAssertEqual(ClipboardLinkLogic.open(sealed, key: key)?.text, "secret 🔑")
    }

    func testWrongKeyOrTamperedMessageDoesNotOpen() throws {
        let key = ClipboardLinkLogic.key(code: code)
        let sealed = try XCTUnwrap(ClipboardLinkLogic.seal(env(), key: key))
        XCTAssertNil(ClipboardLinkLogic.open(sealed, key: ClipboardLinkLogic.key(code: "zzzz-zzzz-zzzz-zzzz-zzzz")))
        var bytes = try XCTUnwrap(Data(base64Encoded: sealed)); bytes[bytes.count - 1] ^= 1
        XCTAssertNil(ClipboardLinkLogic.open(bytes.base64EncodedString(), key: key))
        XCTAssertNil(ClipboardLinkLogic.open("not base64!", key: key))
    }

    /// Made by Node's crypto with the same code, so the Windows app (which uses the same recipe) is compatible.
    func testOpensAMessageSealedByAnotherImplementation() throws {
        XCTAssertEqual(ClipboardLinkLogic.topic(code: code), "notchapple-v1-4d0adaa0dbd1cc72e3da348a670c6387f2fdffdc")
        let sealed = "AAECAwQFBgcICQoLucztprhrMBqIKVGakhPT1fu3zgUHjAbHvtlkSPdgF0haeeu/SpFlVUgDWji+o22GjMMXk5Zb3SO8jDINeNa5EGGICUM+a9JMckkkSN3sPz10EWfFelERwDX7EhO9upRMzBK3nuLCryVPgo7+z9nVlYWmGI07YMOjVzPzWj9iKzgN/lXmtEdQQNjBh0drsWMyy6YnZLUksg=="
        let e = try XCTUnwrap(ClipboardLinkLogic.open(sealed, key: ClipboardLinkLogic.key(code: code)))
        XCTAssertEqual(e.text, "hello from windows")
        XCTAssertEqual(e.name, "Work PC")
        XCTAssertEqual(e.from, "win-device")
        XCTAssertEqual(e.ts, 1_791_300_000_000)
    }

    func testFramesCarryTheSealedTextBothWays() {
        let f = ClipboardLinkLogic.frame(sealed: "QUJD")
        XCTAssertEqual(ClipboardLinkLogic.sealed(fromFrame: f), "QUJD")
        XCTAssertNil(ClipboardLinkLogic.sealed(fromFrame: #"{"event":"open"}"#))
        XCTAssertNil(ClipboardLinkLogic.sealed(fromFrame: "pong"))
    }

    func testWhichMessagesAreApplied() {
        var seen = Set<String>()
        XCTAssertEqual(ClipboardLinkLogic.judge(env("a"), selfID: "me", seen: &seen), .accept)
        XCTAssertEqual(ClipboardLinkLogic.judge(env("a"), selfID: "me", seen: &seen), .duplicate, "the same message through two paths")
        XCTAssertEqual(ClipboardLinkLogic.judge(env("b", from: "me"), selfID: "me", seen: &seen), .ownMessage)
        XCTAssertEqual(ClipboardLinkLogic.judge(env("c", ts: Date().addingTimeInterval(-7200)), selfID: "me", seen: &seen), .stale)
        XCTAssertEqual(ClipboardLinkLogic.judge(env("d", ts: Date().addingTimeInterval(-600)), selfID: "me", seen: &seen), .accept, "a few minutes of clock difference is fine")
        XCTAssertEqual(ClipboardLinkLogic.judge(env("e", text: "   "), selfID: "me", seen: &seen), .empty)
        XCTAssertEqual(ClipboardLinkLogic.judge(env("f", text: String(repeating: "x", count: 100_001)), selfID: "me", seen: &seen), .tooLong)
    }
}
