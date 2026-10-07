//
//  PairDropTests.swift
//  Notch apple tests
//
//  The PairDrop wire format, safe names, the wrong-code limit and who may chat.
//

import XCTest

final class PairDropTests: XCTestCase {
    func testAHeaderSurvivesTheFrame() throws {
        let h = PairDropHeader(code: "123456", fileName: "a.txt", size: 42, sender: "Sam's Mac")
        let frame = try XCTUnwrap(PairDropLogic.encode(h))
        let n = try XCTUnwrap(PairDropLogic.frameLength(frame.prefix(4)))
        XCTAssertEqual(n, frame.count - 4)
        XCTAssertEqual(PairDropLogic.decode(frame.dropFirst(4)), h)
    }

    func testAnOldVersionsHeaderStillDecodes() throws {
        let json = Data(#"{"code":"111111","fileName":"x.pdf","size":9,"sender":"Old Mac"}"#.utf8)
        let h = try XCTUnwrap(PairDropLogic.decode(json))
        XCTAssertEqual(h.kind, .file)
        XCTAssertEqual(h.fileName, "x.pdf")
        XCTAssertEqual(h.senderService, "")
    }

    func testNonsenseLengthsAreRefused() {
        XCTAssertNil(PairDropLogic.frameLength(Data([0, 0, 0, 0])))
        XCTAssertNil(PairDropLogic.frameLength(Data([0xFF, 0xFF, 0xFF, 0xFF])))
        XCTAssertNil(PairDropLogic.frameLength(Data([0, 1])))
    }

    func testCodesAreSixDigits() {
        XCTAssertTrue(PairDropLogic.isValidCode("012345"))
        XCTAssertFalse(PairDropLogic.isValidCode("12345"))
        XCTAssertFalse(PairDropLogic.isValidCode("12345a"))
    }

    func testFileNamesCannotEscapeDownloads() {
        XCTAssertEqual(PairDropLogic.safeFileName("../../etc/passwd"), "passwd")
        XCTAssertEqual(PairDropLogic.safeFileName("/Users/x/.ssh/id_rsa"), "id_rsa")
        XCTAssertEqual(PairDropLogic.safeFileName(".bashrc"), "_bashrc")
        XCTAssertEqual(PairDropLogic.safeFileName(""), "file")
        XCTAssertEqual(PairDropLogic.safeFileName("a:b.txt"), "a-b.txt")
        XCTAssertLessThanOrEqual(PairDropLogic.safeFileName(String(repeating: "x", count: 500)).count, 200)
    }

    func testTakenNamesGetANumber() {
        let taken: Set<String> = ["a.txt", "1-a.txt"]
        XCTAssertEqual(PairDropLogic.uniqueName("a.txt") { taken.contains($0) }, "2-a.txt")
        XCTAssertEqual(PairDropLogic.uniqueName("b.txt") { taken.contains($0) }, "b.txt")
    }

    func testDisplayNamesAreTidied() {
        XCTAssertEqual(PairDropLogic.displayName("  Sam  ", fallback: "Mac"), "Sam")
        XCTAssertEqual(PairDropLogic.displayName("   ", fallback: "Mac"), "Mac")
        XCTAssertEqual(PairDropLogic.displayName(String(repeating: "n", count: 80), fallback: "Mac").count, 32)
    }

    func testFiveWrongCodesLockForAMinute() {
        var l = PairDropAttemptLimiter()
        let t = Date(timeIntervalSince1970: 1000)
        for i in 0..<4 { l.recordFailure(now: t.addingTimeInterval(Double(i))) }
        XCTAssertFalse(l.isLocked(now: t.addingTimeInterval(5)))
        l.recordFailure(now: t.addingTimeInterval(5))
        XCTAssertTrue(l.isLocked(now: t.addingTimeInterval(6)))
        XCTAssertFalse(l.isLocked(now: t.addingTimeInterval(70)))
    }

    func testSlowGuessesNeverLock() {
        var l = PairDropAttemptLimiter()
        let t = Date(timeIntervalSince1970: 1000)
        for i in 0..<10 { l.recordFailure(now: t.addingTimeInterval(Double(i) * 30)) }
        XCTAssertFalse(l.isLocked(now: t.addingTimeInterval(300)))
    }

    func testASuccessClearsTheCount() {
        var l = PairDropAttemptLimiter()
        let t = Date()
        for _ in 0..<4 { l.recordFailure(now: t) }
        l.recordSuccess()
        l.recordFailure(now: t)
        XCTAssertFalse(l.isLocked(now: t))
    }

    func testOnlyAnEstablishedChatMayMessage() {
        let s = PairDropLogic.Session(peerService: "Sam-ab12", peerName: "Sam", sendCode: "222222", expectCode: "111111")
        let sessions = ["Sam-ab12": s]
        XCTAssertTrue(PairDropLogic.authorised(PairDropHeader(kind: .message, code: "111111", sender: "Sam", senderService: "Sam-ab12", text: "hi"), sessions: sessions))
        XCTAssertFalse(PairDropLogic.authorised(PairDropHeader(kind: .message, code: "999999", sender: "Sam", senderService: "Sam-ab12"), sessions: sessions))
        XCTAssertFalse(PairDropLogic.authorised(PairDropHeader(kind: .message, code: "111111", sender: "X", senderService: "Other-1111"), sessions: sessions))
        XCTAssertFalse(PairDropLogic.authorised(PairDropHeader(kind: .file, code: "111111", sender: "Sam", senderService: "Sam-ab12"), sessions: sessions))
    }
}
