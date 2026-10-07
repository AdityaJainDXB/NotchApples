import XCTest

final class ProjectFocusTests: XCTestCase {
    func testCleanTrimsCollapsesAndCaps() {
        XCTAssertEqual(ProjectFocusLogic.clean("  Web   site \n"), "Web site")
        XCTAssertEqual(ProjectFocusLogic.clean(String(repeating: "a", count: 40)).count, 24)
        XCTAssertEqual(ProjectFocusLogic.clean("   "), "")
    }

    func testAddIgnoresNoProjectOrNoMinutes() {
        XCTAssertTrue(ProjectFocusLogic.add([:], day: "2026-10-07", project: " ", minutes: 25).isEmpty)
        XCTAssertTrue(ProjectFocusLogic.add([:], day: "2026-10-07", project: "A", minutes: 0).isEmpty)
        let log = ProjectFocusLogic.add(ProjectFocusLogic.add([:], day: "2026-10-07", project: "A", minutes: 25), day: "2026-10-07", project: "A", minutes: 25)
        XCTAssertEqual(log["2026-10-07|A"], 50)
    }

    func testTotalsOverTheChosenDaysBiggestFirst() {
        var log: [String: Int] = [:]
        log = ProjectFocusLogic.add(log, day: "2026-10-05", project: "Site", minutes: 25)
        log = ProjectFocusLogic.add(log, day: "2026-10-06", project: "Site", minutes: 50)
        log = ProjectFocusLogic.add(log, day: "2026-10-06", project: "App", minutes: 75)
        log = ProjectFocusLogic.add(log, day: "2026-09-01", project: "Old", minutes: 500)
        let t = ProjectFocusLogic.totals(log, days: ["2026-10-05", "2026-10-06", "2026-10-07"])
        XCTAssertEqual(t.map(\.project), ["App", "Site"])      // 75 each: ties by name
        XCTAssertEqual(t.map(\.minutes), [75, 75])
    }

    func testPruneAndNames() {
        var log = ProjectFocusLogic.add([:], day: "2026-08-01", project: "Old", minutes: 25)
        log = ProjectFocusLogic.add(log, day: "2026-10-01", project: "New", minutes: 25)
        XCTAssertEqual(ProjectFocusLogic.prune(log, before: "2026-09-01").keys.sorted(), ["2026-10-01|New"])
        XCTAssertEqual(ProjectFocusLogic.names(log), ["New", "Old"])
    }
}
