//
//  SystemWatchTests.swift
//  Notch apple tests
//
//  Battery care, low disk, the internet-down state machine and the speed test maths. The Windows app runs the same
//  cases against services/syswatch.js.
//

import XCTest

final class SystemWatchTests: XCTestCase {
    typealias S = SystemWatchLogic

    func testBatteryCareFiresOncePerChargeAtYourLimit() {
        XCTAssertFalse(S.batteryCareDue(percent: 79, pluggedIn: true, limit: 80, alreadyAlerted: false))
        XCTAssertTrue(S.batteryCareDue(percent: 80, pluggedIn: true, limit: 80, alreadyAlerted: false))
        XCTAssertFalse(S.batteryCareDue(percent: 90, pluggedIn: true, limit: 80, alreadyAlerted: true), "already told you")
        XCTAssertFalse(S.batteryCareDue(percent: 90, pluggedIn: false, limit: 80, alreadyAlerted: false), "not charging")
        XCTAssertTrue(S.batteryCareDue(percent: 100, pluggedIn: true, limit: 200, alreadyAlerted: false), "the limit is kept in range")
        XCTAssertFalse(S.batteryCareDue(percent: 40, pluggedIn: true, limit: 10, alreadyAlerted: false), "never below 50%")
    }

    func testDiskLowByGigabytesOrPercent() {
        let gb: Int64 = 1_000_000_000
        XCTAssertTrue(S.diskLow(freeBytes: 9 * gb, totalBytes: 500 * gb), "under 10 GB")
        XCTAssertTrue(S.diskLow(freeBytes: 30 * gb, totalBytes: 500 * gb), "6% of the disk")
        XCTAssertFalse(S.diskLow(freeBytes: 100 * gb, totalBytes: 500 * gb))
        XCTAssertFalse(S.diskLow(freeBytes: 0, totalBytes: 0), "no disk information means no alarm")
        XCTAssertTrue(S.diskLow(freeBytes: 20 * gb, totalBytes: 256 * gb, minFreeGB: 25), "your own threshold")
    }

    func testThreeFailuresInARowMeansDown() {
        var l = S.Link()
        l.record(ok: true, ms: 40); XCTAssertEqual(l.state, .online)
        l.record(ok: false); l.record(ok: false); XCTAssertEqual(l.state, .online, "two misses are not an outage")
        l.record(ok: false); XCTAssertEqual(l.state, .down)
        l.record(ok: true, ms: 50); XCTAssertEqual(l.state, .online, "one good check brings it back")
    }

    func testSlowMeansTheMedianIsHigh() {
        var l = S.Link()
        for ms in [800.0, 900, 700, 40, 650] { l.record(ok: true, ms: ms) }
        XCTAssertEqual(l.state, .slow)
        XCTAssertEqual(l.median, 700)
        for ms in [30.0, 35, 40, 45, 50] { l.record(ok: true, ms: ms) }
        XCTAssertEqual(l.state, .online, "only the last five count")
        var one = S.Link(); one.record(ok: true, ms: 4000); one.record(ok: true, ms: 30); one.record(ok: true, ms: 35)
        XCTAssertEqual(one.state, .online, "a single spike isn't slow")
    }

    func testAnnouncementsOnlyOnChange() {
        XCTAssertNil(S.announcement(from: .online, to: .online))
        XCTAssertEqual(S.announcement(from: .online, to: .down), "Internet is down")
        XCTAssertEqual(S.announcement(from: .slow, to: .down), "Internet is down")
        XCTAssertEqual(S.announcement(from: .down, to: .online), "Internet is back")
        XCTAssertEqual(S.announcement(from: .down, to: .slow), "Internet is back, but slow")
        XCTAssertEqual(S.announcement(from: .online, to: .slow), "Internet is slow")
        XCTAssertEqual(S.announcement(from: .slow, to: .online), "Internet is back to normal")
    }

    func testSpeedMaths() {
        XCTAssertEqual(S.megabitsPerSecond(bytes: 25_000_000, seconds: 2), 100, accuracy: 0.001)
        XCTAssertEqual(S.megabitsPerSecond(bytes: 1_000_000, seconds: 0), 0)
        XCTAssertEqual(S.speedText(7.84), "7.8 Mbps")
        XCTAssertEqual(S.speedText(234.6), "235 Mbps")
    }
}
