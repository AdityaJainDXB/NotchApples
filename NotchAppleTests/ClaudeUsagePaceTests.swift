//
//  ClaudeUsagePaceTests.swift
//  Notch apple tests
//
//  The green / yellow / red pacing of the Claude usage tracker and when the notch announces a change.
//

import XCTest

final class ClaudeUsagePaceTests: XCTestCase {
    private let hour: TimeInterval = 3600

    func testNoBudgetMeansNoPace() {
        XCTAssertNil(ClaudeUsageLogic.pace(used: 1000, budget: 0, elapsed: hour, length: 5 * hour))
    }

    func testLowSteadyUseIsGreen() {
        let p = ClaudeUsageLogic.pace(used: 100, budget: 1000, elapsed: 2.5 * hour, length: 5 * hour)!
        XCTAssertEqual(p.light, .green)
        XCTAssertEqual(p.percent, 10)
    }

    func testNearTheLimitIsYellow() {
        XCTAssertEqual(ClaudeUsageLogic.pace(used: 800, budget: 1000, elapsed: 4.5 * hour, length: 5 * hour)!.light, .yellow)
    }

    func testOnCourseToReachTheLimitIsYellow() {
        // 40% used after a fifth of the window: heading for 200%, but not red until half is gone.
        XCTAssertEqual(ClaudeUsageLogic.pace(used: 400, budget: 1000, elapsed: hour, length: 5 * hour)!.light, .yellow)
    }

    func testReachingTheLimitIsRed() {
        XCTAssertEqual(ClaudeUsageLogic.pace(used: 1000, budget: 1000, elapsed: 4 * hour, length: 5 * hour)!.light, .red)
        XCTAssertEqual(ClaudeUsageLogic.pace(used: 1500, budget: 1000, elapsed: hour, length: 5 * hour)!.light, .red)
    }

    func testBurningFastWithHalfUsedIsRed() {
        XCTAssertEqual(ClaudeUsageLogic.pace(used: 600, budget: 1000, elapsed: hour, length: 5 * hour)!.light, .red)
    }

    func testTheFirstMinutesAreNotProjected() {
        let p = ClaudeUsageLogic.pace(used: 200, budget: 1000, elapsed: 60, length: 5 * hour)!
        XCTAssertNil(p.projected)
        XCTAssertEqual(p.light, .green)
    }

    func testToastsFireOnColourChangeSpikeAndReset() {
        let green = UsagePace(light: .green, fraction: 0.30, projected: nil)
        XCTAssertNil(ClaudeUsageLogic.toastReason(previous: nil, now: green))
        XCTAssertNil(ClaudeUsageLogic.toastReason(previous: (.green, 0.28), now: green))
        XCTAssertEqual(ClaudeUsageLogic.toastReason(previous: (.green, 0.18), now: green), .spike)
        XCTAssertEqual(ClaudeUsageLogic.toastReason(previous: (.yellow, 0.30), now: green), .colour)
        XCTAssertEqual(ClaudeUsageLogic.toastReason(previous: (.red, 1.0), now: green), .reset)
    }
}
