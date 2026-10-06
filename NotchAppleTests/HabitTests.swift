//
//  HabitTests.swift
//  Notch apple tests
//
//  Streak maths for the habit tracker. The Windows app runs the same cases against services/habits.js.
//

import XCTest

final class HabitTests: XCTestCase {
    typealias H = HabitLogic

    func testMovingAcrossMonthsAndYears() {
        XCTAssertEqual(H.addDays("2026-10-06", 1), "2026-10-07")
        XCTAssertEqual(H.addDays("2026-10-01", -1), "2026-09-30")
        XCTAssertEqual(H.addDays("2026-12-31", 1), "2027-01-01")
        XCTAssertEqual(H.addDays("2028-02-28", 1), "2028-02-29", "a leap year")
        XCTAssertEqual(H.addDays("2027-02-28", 1), "2027-03-01")
        XCTAssertNil(H.addDays("nope", 1))
    }

    func testLastDaysEndToday() {
        XCTAssertEqual(H.lastDays(3, today: "2026-10-01"), ["2026-09-29", "2026-09-30", "2026-10-01"])
    }

    func testCurrentStreakCountsBackFromToday() {
        let done: Set = ["2026-10-04", "2026-10-05", "2026-10-06"]
        XCTAssertEqual(H.currentStreak(done, today: "2026-10-06"), 3)
    }

    func testStreakSurvivesUntilADayIsMissed() {
        let done: Set = ["2026-10-04", "2026-10-05"]
        XCTAssertEqual(H.currentStreak(done, today: "2026-10-06"), 2, "today isn't done yet, but yesterday was")
        XCTAssertEqual(H.currentStreak(done, today: "2026-10-07"), 0, "a whole day was missed")
        XCTAssertEqual(H.currentStreak([], today: "2026-10-06"), 0)
    }

    func testAGapBreaksTheRun() {
        let done: Set = ["2026-10-01", "2026-10-02", "2026-10-04", "2026-10-05", "2026-10-06"]
        XCTAssertEqual(H.currentStreak(done, today: "2026-10-06"), 3)
        XCTAssertEqual(H.bestStreak(done), 3)
    }

    func testBestStreakIsTheLongestEver() {
        let done: Set = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-10-05", "2026-10-06"]
        XCTAssertEqual(H.bestStreak(done), 4)
        XCTAssertEqual(H.currentStreak(done, today: "2026-10-06"), 2)
        XCTAssertEqual(H.bestStreak([]), 0)
        XCTAssertEqual(H.bestStreak(["2026-10-06"]), 1)
    }

    func testStreaksCrossMonthAndYearEnds() {
        let done: Set = ["2026-12-30", "2026-12-31", "2027-01-01"]
        XCTAssertEqual(H.currentStreak(done, today: "2027-01-01"), 3)
        XCTAssertEqual(H.bestStreak(done), 3)
    }

    func testThisWeek() {
        let done: Set = ["2026-10-06", "2026-10-04", "2026-09-29", "2026-09-28"]   // the last two are older than 7 days
        XCTAssertEqual(H.thisWeek(done, today: "2026-10-06"), 2)
        XCTAssertEqual(H.thisWeek(["2026-09-30"], today: "2026-10-06"), 1, "six days ago is still inside the 7")
    }
}
