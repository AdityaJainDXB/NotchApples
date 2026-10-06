//
//  WellbeingTests.swift
//  Notch apple tests
//
//  Break reminders, the breathing circle, the bedtime nudge, the focus goal and countdowns. The Windows app runs
//  the same cases against services/wellbeing.js.
//

import XCTest

final class WellbeingTests: XCTestCase {
    typealias W = WellbeingLogic
    private let min: Int64 = 60_000
    private let all: [W.Break: W.BreakSetting] = [.eyes: .init(on: true, everyMinutes: 20), .water: .init(on: true, everyMinutes: 60),
                                                  .stretch: .init(on: false, everyMinutes: 45), .posture: .init(on: true, everyMinutes: 30)]

    func testNothingIsDueBeforeTheFirstInterval() {
        XCTAssertNil(W.nextDue(now: 19 * min, startedMs: 0, last: [:], settings: all, minuteOfDay: 600, from: 540, to: 1080))
    }

    func testTheMostOverdueReminderComesFirst() {
        // 65 minutes in: eyes (20), water (60) and posture (30) are all due; eyes is 45 minutes late.
        XCTAssertEqual(W.nextDue(now: 65 * min, startedMs: 0, last: [:], settings: all, minuteOfDay: 600, from: 540, to: 1080), .eyes)
    }

    func testAShownReminderWaitsForItsNextInterval() {
        let last: [W.Break: Int64] = [.eyes: 60 * min, .posture: 60 * min, .water: 60 * min]
        XCTAssertNil(W.nextDue(now: 65 * min, startedMs: 0, last: last, settings: all, minuteOfDay: 600, from: 540, to: 1080))
        XCTAssertEqual(W.nextDue(now: 81 * min, startedMs: 0, last: last, settings: all, minuteOfDay: 600, from: 540, to: 1080), .eyes)
    }

    func testTurnedOffRemindersNeverFire() {
        XCTAssertNotEqual(W.nextDue(now: 500 * min, startedMs: 0, last: [:], settings: all, minuteOfDay: 600, from: 540, to: 1080), .stretch)
        var off = all; for k in off.keys { off[k]!.on = false }
        XCTAssertNil(W.nextDue(now: 500 * min, startedMs: 0, last: [:], settings: off, minuteOfDay: 600, from: 540, to: 1080))
    }

    func testActiveHoursAndSnooze() {
        XCTAssertNil(W.nextDue(now: 500 * min, startedMs: 0, last: [:], settings: all, minuteOfDay: 300, from: 540, to: 1080), "5 am is outside 9-18")
        XCTAssertNil(W.nextDue(now: 500 * min, startedMs: 0, last: [:], settings: all, minuteOfDay: 600, from: 540, to: 1080, snoozedUntilMs: 600 * min))
        XCTAssertTrue(W.isActive(minuteOfDay: 60, from: 1320, to: 360), "22:00 to 06:00 runs past midnight")
        XCTAssertFalse(W.isActive(minuteOfDay: 720, from: 1320, to: 360))
        XCTAssertTrue(W.isActive(minuteOfDay: 5, from: 0, to: 0), "the same start and end means all day")
    }

    func testBoxBreathingPhases() {
        XCTAssertEqual(W.breath(.box, elapsed: 0), .init(label: "Breathe in", size: 0, secondsLeft: 4, cycles: 0))
        XCTAssertEqual(W.breath(.box, elapsed: 2).size, 0.5, accuracy: 0.001)
        XCTAssertEqual(W.breath(.box, elapsed: 4.5), .init(label: "Hold", size: 1, secondsLeft: 4, cycles: 0))
        XCTAssertEqual(W.breath(.box, elapsed: 10).size, 0.5, accuracy: 0.001, "halfway out")
        XCTAssertEqual(W.breath(.box, elapsed: 13), .init(label: "Hold", size: 0, secondsLeft: 3, cycles: 0))
        XCTAssertEqual(W.breath(.box, elapsed: 16.5).label, "Breathe in")
        XCTAssertEqual(W.breath(.box, elapsed: 16.5).cycles, 1)
    }

    func testCalmBreathingLengthsAndRelax() {
        XCTAssertEqual(W.Pattern.calm.cycle, 19)
        XCTAssertEqual(W.breath(.calm, elapsed: 5).label, "Hold")
        XCTAssertEqual(W.breath(.calm, elapsed: 12).label, "Breathe out")
        XCTAssertEqual(W.breath(.relax, elapsed: 7.5).size, 0.5, accuracy: 0.001)
    }

    func testBedtimeNudgeOncePerDay() {
        // Bedtime 23:00 (1380), nudge 30 minutes before.
        XCTAssertFalse(W.bedtimeDue(minuteOfDay: 1340, bedtime: 1380, lead: 30, lastDayKey: "", todayKey: "2026-10-06"))
        XCTAssertTrue(W.bedtimeDue(minuteOfDay: 1350, bedtime: 1380, lead: 30, lastDayKey: "", todayKey: "2026-10-06"))
        XCTAssertTrue(W.bedtimeDue(minuteOfDay: 1400, bedtime: 1380, lead: 30, lastDayKey: "2026-10-05", todayKey: "2026-10-06"))
        XCTAssertFalse(W.bedtimeDue(minuteOfDay: 1400, bedtime: 1380, lead: 30, lastDayKey: "2026-10-06", todayKey: "2026-10-06"), "already nudged today")
        XCTAssertFalse(W.bedtimeDue(minuteOfDay: 10, bedtime: 1380, lead: 30, lastDayKey: "", todayKey: "2026-10-07"), "the window for a 23:00 bedtime ends at midnight")
        XCTAssertTrue(W.bedtimeDue(minuteOfDay: 10, bedtime: 1410, lead: 30, lastDayKey: "", todayKey: "2026-10-07"), "for 23:30 it runs to 00:30, past midnight")
    }

    func testGoalFraction() {
        XCTAssertEqual(W.goalFraction(minutes: 50, goal: 100), 0.5)
        XCTAssertEqual(W.goalFraction(minutes: 300, goal: 100), 1)
        XCTAssertEqual(W.goalFraction(minutes: 50, goal: 0), 0)
    }

    func testCountdowns() {
        XCTAssertEqual(W.daysBetween("2026-10-06", "2026-10-06"), 0)
        XCTAssertEqual(W.daysBetween("2026-10-06", "2026-12-25"), 80)
        XCTAssertEqual(W.daysBetween("2026-10-06", "2026-10-01"), -5)
        XCTAssertEqual(W.daysBetween("2027-12-31", "2028-03-01"), 61, "across a leap year")
        XCTAssertNil(W.daysBetween("2026-13-01", "2026-10-06"))
        XCTAssertNil(W.daysBetween("soon", "2026-10-06"))
        XCTAssertEqual([0, 1, -1, 12, -3].map(W.countdownLabel), ["Today", "Tomorrow", "Yesterday", "In 12 days", "3 days ago"])
    }
}
