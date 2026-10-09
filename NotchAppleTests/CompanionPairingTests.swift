//
//  CompanionPairingTests.swift
//  Notch apple tests
//
//  The iPhone companion's pairing code, the key exchange and the replay counter.
//

import XCTest
import CryptoKit

final class CompanionPairingTests: XCTestCase {
    // MARK: The code

    func testNewCodesAreLongRandomAndValid() {
        var seen = Set<String>()
        for _ in 0..<300 {
            let code = Companion.newCode()
            XCTAssertEqual(code.count, 12)
            XCTAssertTrue(code.allSatisfy { Companion.codeAlphabet.contains($0) })
            XCTAssertEqual(Companion.normalizedCode(code), code, "a generated code must read back as itself")
            seen.insert(code)
        }
        XCTAssertEqual(seen.count, 300)
    }

    func testTheCodeIsSixtyBits() {
        XCTAssertEqual(Companion.codeAlphabet.count, 32)
        XCTAssertEqual(Double(Companion.codeLength) * log2(Double(Companion.codeAlphabet.count)), 60)
    }

    func testTheAlphabetHasNoLookalikes() {
        for c in "ILOU" { XCTAssertFalse(Companion.codeAlphabet.contains(c), "\(c) looks like another character") }
        XCTAssertEqual(Set(Companion.codeAlphabet).count, 32)
    }

    func testTypedCodesAreNormalised() {
        XCTAssertEqual(Companion.normalizedCode("abcd-efgh-jkmn"), "ABCDEFGHJKMN")
        XCTAssertEqual(Companion.normalizedCode("ABCD EFGH JKMN"), "ABCDEFGHJKMN")
        XCTAssertEqual(Companion.normalizedCode("  ab cd–ef gh-jk mn "), "ABCDEFGHJKMN")
        XCTAssertEqual(Companion.normalizedCode("OILL-4567-89AB"), "0111456789AB", "O reads as 0, I and L as 1")
    }

    func testBadCodesAreRejected() {
        for bad in ["", "ABCD", "ABCD-EFGH-JKM", "ABCD-EFGH-JKMNP", "ABCD-EFGH-JKM!", "ABCD-EFGH-JKMU", "123456"] {
            XCTAssertNil(Companion.normalizedCode(bad), "accepted \(bad)")
        }
    }

    func testDisplayGroupsOfFour() {
        XCTAssertEqual(Companion.displayCode("ABCDEFGHJKMN"), "ABCD-EFGH-JKMN")
        XCTAssertEqual(Companion.displayCode("ABCDE"), "ABCD-E")
        XCTAssertEqual(Companion.displayCode(""), "")
    }

    func testFormattingDoesNotChangeTheKey() throws {
        let frame = try Companion.seal(.init(type: .pair, name: "iPhone"), from: Companion.pairDevice, key: Companion.pairingKey(code: "ABCDEFGHJKMN"))
        let env = try XCTUnwrap(Companion.envelope(from: frame))
        XCTAssertNotNil(Companion.open(env, key: Companion.pairingKey(code: "abcd-efgh-jkmn")))
    }

    // MARK: The key exchange

    private struct Side {
        let key = Curve25519.KeyAgreement.PrivateKey()
        var pub: Data { key.publicKey.rawRepresentation }
    }

    func testBothSidesDeriveTheSameSessionKey() throws {
        let code = Companion.pairingKey(code: "ABCDEFGHJKMN")
        let phone = Side(), mac = Side()
        let a = try Companion.pairingSessionKey(code: code, mine: phone.key, theirs: mac.pub, phonePublic: phone.pub, macPublic: mac.pub)
        let b = try Companion.pairingSessionKey(code: code, mine: mac.key, theirs: phone.pub, phonePublic: phone.pub, macPublic: mac.pub)
        let sealed = try ChaChaPoly.seal(Data("token".utf8), using: a)
        XCTAssertEqual(try ChaChaPoly.open(sealed, using: b), Data("token".utf8))
    }

    /// Everything on the wire, as a passive listener on the Wi-Fi sees it: both public keys and the sealed frames.
    func testAPassiveListenerWithoutTheCodeCannotOpenTheReply() throws {
        let code = Companion.pairingKey(code: "ABCDEFGHJKMN")
        let phone = Side(), mac = Side()
        let session = try Companion.pairingSessionKey(code: code, mine: mac.key, theirs: phone.pub, phonePublic: phone.pub, macPublic: mac.pub)
        let reply = try ChaChaPoly.seal(Data("the permanent token".utf8), using: session)

        // They know both public keys. Their best guess at the code is wrong, and they have their own ephemeral key at most.
        let attacker = Side()
        let wrongCode = Companion.pairingKey(code: "ZZZZZZZZZZZZ")
        let guess = try Companion.pairingSessionKey(code: wrongCode, mine: attacker.key, theirs: mac.pub, phonePublic: phone.pub, macPublic: mac.pub)
        XCTAssertThrowsError(try ChaChaPoly.open(reply, using: guess))
    }

    /// The case the old design lost: the code leaks afterwards (a photo of the screen) and a recording was kept.
    func testKnowingTheCodeLaterDoesNotOpenARecordedPairing() throws {
        let code = Companion.pairingKey(code: "ABCDEFGHJKMN")
        let phone = Side(), mac = Side()
        let session = try Companion.pairingSessionKey(code: code, mine: mac.key, theirs: phone.pub, phonePublic: phone.pub, macPublic: mac.pub)
        let reply = try ChaChaPoly.seal(Data("the permanent token".utf8), using: session)

        // They now have the code, both public keys and the recording, but the ephemeral private keys were thrown away.
        let attacker = Side()
        let withCode = try Companion.pairingSessionKey(code: code, mine: attacker.key, theirs: mac.pub, phonePublic: phone.pub, macPublic: mac.pub)
        XCTAssertThrowsError(try ChaChaPoly.open(reply, using: withCode))
    }

    func testASwappedMacKeyBreaksThePairingInsteadOfBeingTrusted() throws {
        let code = Companion.pairingKey(code: "ABCDEFGHJKMN")
        let phone = Side(), mac = Side(), mitm = Side()
        let real = try Companion.pairingSessionKey(code: code, mine: mac.key, theirs: phone.pub, phonePublic: phone.pub, macPublic: mac.pub)
        let reply = try ChaChaPoly.seal(Data("token".utf8), using: real)
        // The phone is told the Mac's key is the attacker's.
        let phoneView = try Companion.pairingSessionKey(code: code, mine: phone.key, theirs: mitm.pub, phonePublic: phone.pub, macPublic: mitm.pub)
        XCTAssertThrowsError(try ChaChaPoly.open(reply, using: phoneView))
    }

    func testBadPublicKeysAreRejected() {
        let code = Companion.pairingKey(code: "ABCDEFGHJKMN")
        let mine = Side()
        XCTAssertThrowsError(try Companion.pairingSessionKey(code: code, mine: mine.key, theirs: Data(count: 31), phonePublic: mine.pub, macPublic: mine.pub))
        XCTAssertThrowsError(try Companion.pairingSessionKey(code: code, mine: mine.key, theirs: Data(), phonePublic: mine.pub, macPublic: mine.pub))
        // The all-zero point is a low-order point: the shared secret would be all zeros whatever our key is.
        XCTAssertThrowsError(try Companion.pairingSessionKey(code: code, mine: mine.key, theirs: Data(count: 32), phonePublic: mine.pub, macPublic: mine.pub))
    }

    /// The whole thing over real sealed frames, as the two apps do it.
    func testPairingOverFrames() throws {
        let code = "ABCDEFGHJKMN"
        // Phone: asks to pair, with a fresh public key, sealed with the code.
        let phone = Side()
        let request = try Companion.seal(.init(type: .pair, name: "iPhone", epk: phone.pub.base64EncodedString()), from: Companion.pairDevice, key: Companion.pairingKey(code: code))
        // Mac: opens it with the code, answers with its own fresh key and the token.
        let env = try XCTUnwrap(Companion.envelope(from: request))
        XCTAssertEqual(env.d, Companion.pairDevice)
        let msg = try XCTUnwrap(Companion.open(env, key: Companion.pairingKey(code: code)))
        let phonePublic = try XCTUnwrap(msg.epk.flatMap { Data(base64Encoded: $0) })
        let mac = Side()
        let macSession = try Companion.pairingSessionKey(code: Companion.pairingKey(code: code), mine: mac.key, theirs: phonePublic, phonePublic: phonePublic, macPublic: mac.pub)
        let token = Companion.newToken()
        let reply = try Companion.seal(.init(type: .paired, name: "Mac", device: "d1", token: token.base64EncodedString()), from: "mac", key: macSession, ephemeral: mac.pub)
        // Phone: works the key out from the Mac's public key in the envelope, and gets the token.
        let replyEnv = try XCTUnwrap(Companion.envelope(from: reply))
        let macPublic = try XCTUnwrap(replyEnv.e.flatMap { Data(base64Encoded: $0) })
        let phoneSession = try Companion.pairingSessionKey(code: Companion.pairingKey(code: code), mine: phone.key, theirs: macPublic, phonePublic: phone.pub, macPublic: macPublic)
        let paired = try XCTUnwrap(Companion.open(replyEnv, key: phoneSession))
        XCTAssertEqual(paired.type, .paired)
        XCTAssertEqual(paired.token, token.base64EncodedString())

        // Someone who guessed the wrong code can't even make the Mac open the request.
        XCTAssertNil(Companion.open(env, key: Companion.pairingKey(code: "ZZZZZZZZZZZZ")))
    }

    func testOldEnvelopesStillDecode() throws {
        // A frame from before the ephemeral field existed has no "e".
        let json = Data(#"{"d":"abc","b":"AAAA"}"#.utf8)
        let env = try JSONDecoder().decode(Companion.Envelope.self, from: json)
        XCTAssertNil(env.e)
        XCTAssertEqual(env.d, "abc")
    }

    // MARK: Wrong tries

    func testACodeDiesAfterFiveWrongTries() {
        var attempts = Companion.PairingAttempts()
        for _ in 0..<4 { attempts.recordFailure(); XCTAssertFalse(attempts.burned) }
        attempts.recordFailure()
        XCTAssertTrue(attempts.burned)
        XCTAssertEqual(Companion.PairingAttempts.limit, 5)
    }

    // MARK: Replay

    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func ms(_ offset: TimeInterval = 0) -> Int64 { Int64((now.timeIntervalSince1970 + offset) * 1000) }

    func testAPhoneWithoutACounterYetStillWorks() {
        XCTAssertEqual(Companion.checkSequence(last: nil, seq: nil, now: now), .init(accepted: true, newLast: nil, reason: nil))
    }

    func testTheFirstCounterIsAcceptedAndRemembered() {
        XCTAssertEqual(Companion.checkSequence(last: nil, seq: ms(), now: now), .init(accepted: true, newLast: ms(), reason: nil))
    }

    func testAReplayedRequestIsRefused() {
        let d = Companion.checkSequence(last: ms(), seq: ms(), now: now)
        XCTAssertFalse(d.accepted)
        XCTAssertEqual(d.newLast, ms(), "a refused request doesn't move the counter")
        XCTAssertFalse(Companion.checkSequence(last: ms(5), seq: ms(1), now: now).accepted, "an older request is a replay too")
    }

    func testARisingCounterKeepsWorking() {
        XCTAssertTrue(Companion.checkSequence(last: ms(), seq: ms() + 1, now: now).accepted)
        XCTAssertEqual(Companion.checkSequence(last: ms(), seq: ms(3), now: now).newLast, ms(3))
    }

    func testDroppingTheCounterAfterUsingOneIsRefused() {
        let d = Companion.checkSequence(last: ms(), seq: nil, now: now)
        XCTAssertFalse(d.accepted, "leaving the number off must not get an old request past the check")
        XCTAssertNotNil(d.reason)
    }

    func testACounterFarFromTheClockIsRefused() {
        XCTAssertTrue(Companion.checkSequence(last: nil, seq: ms(599), now: now).accepted)
        XCTAssertTrue(Companion.checkSequence(last: nil, seq: ms(-599), now: now).accepted)
        XCTAssertFalse(Companion.checkSequence(last: nil, seq: ms(601), now: now).accepted)
        XCTAssertFalse(Companion.checkSequence(last: nil, seq: ms(-601), now: now).accepted)
    }

    func testTheNextCounterAlwaysRises() {
        let first = Companion.nextSequence(after: 0, now: now)
        XCTAssertEqual(first, ms())
        XCTAssertEqual(Companion.nextSequence(after: first, now: now), first + 1, "two requests in the same millisecond still differ")
        XCTAssertEqual(Companion.nextSequence(after: first + 10_000, now: now), first + 10_001, "a clock set back doesn't lower it")
    }
}
