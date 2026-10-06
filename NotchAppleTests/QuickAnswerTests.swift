//
//  QuickAnswerTests.swift
//  Notch apple tests
//
//  The short answers typed into the command palette and calculator. The Windows app runs the same cases against
//  services/answers.js.
//

import XCTest

final class QuickAnswerTests: XCTestCase {
    typealias Q = QuickAnswerLogic
    private var cal: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }
    private func utc(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 12, _ min: Int = 0) -> Date { cal.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))! }
    private func text(_ q: String, now: Date? = nil) -> String? { Q.answer(q, now: now ?? utc(2026, 10, 6), calendar: cal)?.text }

    func testPercentages() {
        XCTAssertEqual(text("12% of 80"), "9.6")
        XCTAssertEqual(text("what is 50 % of 9"), "4.5")
        XCTAssertEqual(text("15% off 200"), "170")
        XCTAssertEqual(text("200 + 15%"), "230")
        XCTAssertEqual(text("200 - 15%"), "170")
        XCTAssertEqual(text("20 is what % of 80"), "25%")
        XCTAssertNil(text("20 is what % of 0"))
        XCTAssertEqual(Q.answer("12% of 80")?.copy, "9.6")
    }

    func testUnitConversions() {
        XCTAssertEqual(text("5 km in mi"), "5 km = 3.1069 mi")
        XCTAssertEqual(text("100 c to f"), "100 c = 212 f")
        XCTAssertEqual(text("2 kg to lb"), "2 kg = 4.4092 lb")
        XCTAssertNil(text("5 km in kg"), "mismatched units")
    }

    func testDaysUntil() {
        XCTAssertEqual(text("days until 25 dec"), "80 days")
        XCTAssertEqual(text("days until dec 25"), "80 days")
        XCTAssertEqual(text("days until 2026-10-07"), "1 day")
        XCTAssertEqual(text("days until 2026-10-06"), "Today")
        XCTAssertEqual(text("days until 2026-10-01"), "5 days ago")
        XCTAssertEqual(text("days until 1 oct"), "360 days", "this year's date has passed, so it means next year")
        XCTAssertNil(text("days until 31 feb"))
        XCTAssertNil(text("days until someday"))
    }

    func testTimeInACity() {
        XCTAssertEqual(text("time in tokyo", now: utc(2026, 1, 15, 6, 30)), "15:30 in Tokyo (Thu)")
        XCTAssertEqual(text("time in new york", now: utc(2026, 1, 15, 6, 30)), "01:30 in New York (Thu)")
        XCTAssertEqual(text("time in london", now: utc(2026, 1, 15, 23, 30)), "23:30 in London (Thu)")
        XCTAssertEqual(text("time in delhi", now: utc(2026, 1, 15, 0, 0)), "05:30 in Delhi (Thu)")
        XCTAssertNil(text("time in atlantis"))
    }

    func testOrdinaryTextIsNotAnAnswer() {
        XCTAssertNil(text("hello world"))
        XCTAssertNil(text(""))
        XCTAssertNil(text("12 of 80"))
    }
}
