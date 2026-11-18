import XCTest

final class TeleprompterTests: XCTestCase {
    func testSpeedLevelsMapToReadingPace() {
        XCTAssertEqual(TeleprompterLogic.wordsPerMinute(speed: 1), 60)
        XCTAssertEqual(TeleprompterLogic.wordsPerMinute(speed: 4), 120)
        XCTAssertEqual(TeleprompterLogic.wordsPerMinute(speed: 10), 240)
    }

    func testSpeedAndSizeStayInRange() {
        XCTAssertEqual(TeleprompterLogic.clampSpeed(0), 1)
        XCTAssertEqual(TeleprompterLogic.clampSpeed(99), 10)
        XCTAssertEqual(TeleprompterLogic.clampFont(2), 14)
        XCTAssertEqual(TeleprompterLogic.clampFont(500), 44)
        XCTAssertEqual(TeleprompterLogic.wordsPerMinute(speed: 99), 240, "an out-of-range speed is clamped")
    }

    func testFasterIsFasterAndBiggerTextMovesFurtherPerSecond() {
        let slow = TeleprompterLogic.pointsPerSecond(speed: 2, fontSize: 24)
        let fast = TeleprompterLogic.pointsPerSecond(speed: 8, fontSize: 24)
        XCTAssertGreaterThan(fast, slow)
        XCTAssertGreaterThan(TeleprompterLogic.pointsPerSecond(speed: 4, fontSize: 40), TeleprompterLogic.pointsPerSecond(speed: 4, fontSize: 20),
                             "a larger text has taller lines, so the same reading pace needs a bigger step")
        // 120 words a minute at 6 words a line is 0.333 lines a second; a 24 pt line is 33.6 pt tall.
        XCTAssertEqual(TeleprompterLogic.pointsPerSecond(speed: 4, fontSize: 24), 120.0 / 60.0 / 6.0 * 24 * 1.4, accuracy: 0.0001)
    }

    func testWordCountAndReadingTime() {
        XCTAssertEqual(TeleprompterLogic.wordCount("  hello   brave\nnew world  "), 4)
        XCTAssertEqual(TeleprompterLogic.wordCount(""), 0)
        XCTAssertEqual(TeleprompterLogic.seconds(words: 120, speed: 4), 60, "120 words at 120 a minute is a minute")
        XCTAssertEqual(TeleprompterLogic.seconds(words: 0, speed: 4), 0)
        XCTAssertEqual(TeleprompterLogic.clock(75), "1:15")
        XCTAssertEqual(TeleprompterLogic.clock(5), "0:05")
    }

    func testTheScrollAdvancesAndStopsAtTheEnd() {
        var offset = 0.0
        let step = TeleprompterLogic.advance(offset: offset, dt: 1, speed: 4, fontSize: 24, maxOffset: 1000)
        XCTAssertEqual(step.offset, TeleprompterLogic.pointsPerSecond(speed: 4, fontSize: 24), accuracy: 0.0001)
        XCTAssertFalse(step.finished)
        offset = 995
        let end = TeleprompterLogic.advance(offset: offset, dt: 1, speed: 10, fontSize: 40, maxOffset: 1000)
        XCTAssertEqual(end.offset, 1000)
        XCTAssertTrue(end.finished, "reaching the end is reported and the text never scrolls past it")
        XCTAssertTrue(TeleprompterLogic.advance(offset: 0, dt: 1, speed: 4, fontSize: 24, maxOffset: 0).finished, "a script that fits is finished at once")
        XCTAssertEqual(TeleprompterLogic.advance(offset: 10, dt: -5, speed: 4, fontSize: 24, maxOffset: 1000).offset, 10, "time never runs backwards")
    }
}
