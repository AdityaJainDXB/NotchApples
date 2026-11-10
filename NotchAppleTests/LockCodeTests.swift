import XCTest

final class LockCodeTests: XCTestCase {
    func testOnlyFourToEightDigitsAreValid() {
        XCTAssertTrue(LockCode.isValid("1234"))
        XCTAssertTrue(LockCode.isValid("12345678"))
        XCTAssertFalse(LockCode.isValid("123"))
        XCTAssertFalse(LockCode.isValid("123456789"))
        XCTAssertFalse(LockCode.isValid("12a4"))
        XCTAssertFalse(LockCode.isValid("١٢٣٤"))
        XCTAssertFalse(LockCode.isValid(""))
    }

    func testTypingKeepsDigitsOnlyAndCapsTheLength() {
        XCTAssertEqual(LockCode.cleaned("1a2b3c4"), "1234")
        XCTAssertEqual(LockCode.cleaned("1234567890"), "12345678")
    }

    func testTheHashDependsOnTheCodeAndTheSalt() {
        let salt = LockCode.makeSalt()
        XCTAssertEqual(salt.count, 32)
        XCTAssertNotEqual(LockCode.makeSalt(), salt)
        let h = LockCode.hash("1234", salt: salt)
        XCTAssertTrue(LockCode.matches("1234", salt: salt, hash: h))
        XCTAssertFalse(LockCode.matches("1235", salt: salt, hash: h))
        XCTAssertNotEqual(LockCode.hash("1234", salt: LockCode.makeSalt()), h)
        XCTAssertFalse(h.contains("1234"))
    }

    func testTheWaitStartsAfterFiveWrongTriesAndGrowsToACap() {
        for n in 0..<5 { XCTAssertEqual(LockCode.lockoutSeconds(failures: n), 0) }
        XCTAssertEqual(LockCode.lockoutSeconds(failures: 5), 30)
        XCTAssertEqual(LockCode.lockoutSeconds(failures: 6), 60)
        XCTAssertEqual(LockCode.lockoutSeconds(failures: 7), 120)
        XCTAssertEqual(LockCode.lockoutSeconds(failures: 40), 900)
    }

    func testTheStoreAcceptsTheRightCodeAndWaitsAfterTooManyWrongOnes() {
        LockCodeStore.clear()
        XCTAssertFalse(LockCodeStore.isSet)
        XCTAssertFalse(LockCodeStore.set("12"))
        XCTAssertTrue(LockCodeStore.set("2468"))
        XCTAssertTrue(LockCodeStore.isSet)
        XCTAssertTrue(LockCodeStore.isRight("2468"))
        XCTAssertFalse(LockCodeStore.isRight("2469"))
        XCTAssertEqual(LockCodeStore.waitRemaining(), 0, "looking is not a try")
        XCTAssertTrue(LockCodeStore.check("2468"))
        let t = Date()
        for _ in 0..<5 { XCTAssertFalse(LockCodeStore.check("0000", now: t)) }
        XCTAssertEqual(LockCodeStore.waitRemaining(now: t), 30)
        XCTAssertFalse(LockCodeStore.check("2468", now: t), "no try is accepted while waiting")
        XCTAssertTrue(LockCodeStore.check("2468", now: t.addingTimeInterval(31)))
        XCTAssertEqual(LockCodeStore.waitRemaining(now: t.addingTimeInterval(31)), 0)
        LockCodeStore.clear()
        XCTAssertFalse(LockCodeStore.isSet)
    }
}
