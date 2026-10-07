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

    func testPeaksAreTheBusiestWindowAndWeek() {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
        let day0 = Date(timeIntervalSince1970: 1_760_000_000)
        func entry(_ t: TimeInterval, _ out: Int) -> ClaudeUsageEntry {
            ClaudeUsageEntry(time: day0.addingTimeInterval(t), model: "m", input: 0, output: out, cacheWrite: 0, cacheRead: 0)
        }
        // Window one: 300 + 200. Window two (a day later): 900. Ten days after that: 50.
        let entries = [entry(0, 300), entry(600, 200), entry(86_400, 900), entry(11 * 86_400, 50)]
        XCTAssertEqual(ClaudeUsageLogic.peakBlock(entries), 900)
        XCTAssertEqual(ClaudeUsageLogic.peakWeek(entries, calendar: cal), 1400)
    }
}
