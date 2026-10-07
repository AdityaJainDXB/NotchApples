//
//  ClaudeLimitsTests.swift
//  Notch apple tests
//
//  Reading Claude's real usage limits, Claude Code's saved sign-in, and the colour they give.
//

import XCTest

final class ClaudeLimitsTests: XCTestCase {
    private let sample = Data("""
    {"five_hour":{"utilization":25.0,"resets_at":"2025-10-07T19:50:00.123456+00:00"},
     "seven_day":{"utilization":73,"resets_at":"2025-10-09T05:00:00+00:00"},
     "seven_day_opus":null,
     "seven_day_sonnet":{"utilization":"12.5","resets_at":null}}
    """.utf8)

    func testTheUsageReplyIsRead() throws {
        let l = try XCTUnwrap(ClaudeLimitsLogic.parse(sample))
        XCTAssertEqual(l.fiveHour?.percent, 25)
        XCTAssertEqual(l.sevenDay?.percent, 73)
        XCTAssertNil(l.sevenDayOpus)
        XCTAssertEqual(l.sevenDaySonnet?.fraction ?? 0, 0.125, accuracy: 0.0001)
        XCTAssertNotNil(l.fiveHour?.resetsAt)
        XCTAssertNil(l.sevenDaySonnet?.resetsAt)
    }

    func testMicrosecondDatesParse() throws {
        let d = try XCTUnwrap(ClaudeLimitsLogic.date(from: "2025-10-07T19:50:00.123456+00:00"))
        XCTAssertEqual(d.timeIntervalSince1970, 1_759_866_600.123, accuracy: 0.01)
        XCTAssertNotNil(ClaudeLimitsLogic.date(from: "2025-10-09T05:00:00Z"))
        XCTAssertNil(ClaudeLimitsLogic.date(from: "soon"))
    }

    func testAnUnusableReplyIsNil() {
        XCTAssertNil(ClaudeLimitsLogic.parse(Data("{}".utf8)))
        XCTAssertNil(ClaudeLimitsLogic.parse(Data("not json".utf8)))
        XCTAssertNil(ClaudeLimitsLogic.parse(Data(#"{"five_hour":{"utilization":"lots"}}"#.utf8)))
        XCTAssertNil(ClaudeLimitsLogic.parse(Data(#"{"five_hour":{"utilization":-3}}"#.utf8)))
    }

    func testTheKeychainSignInIsRead() throws {
        let json = Data(#"{"claudeAiOauth":{"accessToken":"sk-ant-oat01-abc","refreshToken":"r","expiresAt":1759866600000,"subscriptionType":"max"}}"#.utf8)
        let c = try XCTUnwrap(ClaudeLimitsLogic.credential(from: json))
        XCTAssertEqual(c.token, "sk-ant-oat01-abc")
        XCTAssertEqual(c.expiresAt?.timeIntervalSince1970, 1_759_866_600)
        XCTAssertTrue(c.isExpired(now: Date(timeIntervalSince1970: 1_759_866_700)))
        XCTAssertFalse(c.isExpired(now: Date(timeIntervalSince1970: 1_759_866_000)))
        XCTAssertNil(ClaudeLimitsLogic.credential(from: Data(#"{"other":1}"#.utf8)))
        XCTAssertNil(ClaudeLimitsLogic.credential(from: Data(#"{"claudeAiOauth":{"accessToken":""}}"#.utf8)))
    }

    func testRealLimitsGetAColour() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        // 25% used with 2h50m left of a 5h window: a bit over half through, comfortably on pace.
        let a = ClaudeLimit(fraction: 0.25, resetsAt: now.addingTimeInterval(2.8 * 3600))
        XCTAssertEqual(ClaudeLimitsLogic.pace(a, length: ClaudeLimitsLogic.fiveHourLength, now: now).light, .green)
        // 73% of the week with about two days left: nearing the limit.
        let w = ClaudeLimit(fraction: 0.73, resetsAt: now.addingTimeInterval(2 * 86_400))
        XCTAssertEqual(ClaudeLimitsLogic.pace(w, length: ClaudeLimitsLogic.sevenDayLength, now: now).light, .yellow)
        // 100%: red whenever.
        XCTAssertEqual(ClaudeLimitsLogic.pace(ClaudeLimit(fraction: 1, resetsAt: nil), length: 5 * 3600, now: now).light, .red)
    }

    func testHeadersAreRead() {
        let l = ClaudeLimitsLogic.parse(headers: [
            "Anthropic-Ratelimit-Unified-5h-Utilization": "0.34", "anthropic-ratelimit-unified-5h-reset": "1790000000",
            "anthropic-ratelimit-unified-7d-utilization": "0.78", "anthropic-ratelimit-unified-7d-reset": "1790400000000"])
        XCTAssertEqual(l?.fiveHour?.percent, 34)
        XCTAssertEqual(l?.sevenDay?.percent, 78)
        XCTAssertEqual(l?.fiveHour?.resetsAt, Date(timeIntervalSince1970: 1_790_000_000))
        XCTAssertEqual(l?.sevenDay?.resetsAt, Date(timeIntervalSince1970: 1_790_400_000))
        XCTAssertNil(ClaudeLimitsLogic.parse(headers: ["content-type": "json"]))
    }

    func testHashedKeychainNamesAreFound() {
        let dump = """
        keychain: "/Users/x/Library/Keychains/login.keychain-db"
            "svce"<blob>="Claude Code-credentials-11e1b79e"
            "svce"<blob>="Other"
            "svce"<blob>="Claude Code-credentials"
            "svce"<blob>="Claude Code-credentials-11e1b79e"
        """
        XCTAssertEqual(ClaudeLimitsLogic.credentialServices(fromDump: dump), ["Claude Code-credentials", "Claude Code-credentials-11e1b79e"])
    }

    func testAlertsFireOncePerLevelAndWindow() {
        typealias L = ClaudeLimitsLogic
        let r = Date(timeIntervalSince1970: 1_790_000_000)
        XCTAssertEqual(L.alertLevel(0.5), 0)
        XCTAssertEqual(L.alertLevel(0.8), 1)
        XCTAssertEqual(L.alertLevel(0.97), 2)
        XCTAssertTrue(L.alertDue(level: 1, lastLevel: 0, lastReset: r, reset: r))
        XCTAssertFalse(L.alertDue(level: 1, lastLevel: 1, lastReset: r, reset: r))
        XCTAssertTrue(L.alertDue(level: 2, lastLevel: 1, lastReset: r, reset: r))
        // A new window (later reset time) starts over.
        XCTAssertTrue(L.alertDue(level: 1, lastLevel: 2, lastReset: r, reset: r.addingTimeInterval(5 * 3600)))
    }

    func testTimeToLimitOnlyWhenItBeatsTheReset() {
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        let len = ClaudeLimitsLogic.fiveHourLength
        // 2h in, 50% used: full in 2 more hours, reset in 3h.
        let fast = ClaudeLimit(fraction: 0.5, resetsAt: now.addingTimeInterval(3 * 3600))
        XCTAssertEqual(ClaudeLimitsLogic.timeToLimit(fast, length: len, now: now) ?? 0, 2 * 3600, accuracy: 1)
        // 2h in, 10% used: would last past the reset.
        XCTAssertNil(ClaudeLimitsLogic.timeToLimit(ClaudeLimit(fraction: 0.1, resetsAt: now.addingTimeInterval(3 * 3600)), length: len, now: now))
        XCTAssertNil(ClaudeLimitsLogic.timeToLimit(ClaudeLimit(fraction: 0.5, resetsAt: nil), length: len, now: now))
        XCTAssertEqual(ClaudeLimitsLogic.duration(4800), "1h 20m")
        XCTAssertEqual(ClaudeLimitsLogic.duration(2700), "45m")
    }

    func testHistoryKeepsThirtyDaysAndSkipsCloseSamples() {
        typealias H = ClaudeHistoryLogic
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        let old = ClaudeUsageSample(account: "a", time: now.addingTimeInterval(-31 * 86_400), fiveHour: 0.5, sevenDay: 0.5)
        let first = ClaudeUsageSample(account: "a", time: now.addingTimeInterval(-3600), fiveHour: 0.2, sevenDay: 0.4)
        var list = H.appended([old, first], ClaudeUsageSample(account: "a", time: now.addingTimeInterval(-3500), fiveHour: 0.3, sevenDay: 0.4), now: now)
        XCTAssertEqual(list, [first])                       // too close to the last one, and the old one is gone
        list = H.appended(list, ClaudeUsageSample(account: "b", time: now.addingTimeInterval(-3500), fiveHour: 0.3, sevenDay: 0.4), now: now)
        XCTAssertEqual(list.count, 2)                       // another account is its own series
        let days = H.dailyPeaks(list, account: "a", days: 30, now: now)
        XCTAssertEqual(days.count, 30)
        XCTAssertEqual(days.last?.sevenDayPeak, 0.4)
        XCTAssertNil(days.first?.sevenDayPeak)
    }

    func testAccountsAreNamedAndPicked() {
        let home = "/Users/x"
        XCTAssertEqual(ClaudeAccountLogic.service(forConfigDir: home + "/.claude", home: home), "Claude Code-credentials")
        let hashed = ClaudeAccountLogic.service(forConfigDir: home + "/.claude-work", home: home)
        XCTAssertTrue(hashed.hasPrefix("Claude Code-credentials-"))
        XCTAssertEqual(hashed.count, "Claude Code-credentials-".count + 8)
        let list = ClaudeAccountLogic.accounts(services: ["Claude Code-credentials", hashed], emails: [hashed: "me@work.com"])
        XCTAssertEqual(list.map(\.label), ["Account 1", "me@work.com"])
        XCTAssertEqual(ClaudeAccountLogic.active(list, picked: hashed)?.label, "me@work.com")
        XCTAssertEqual(ClaudeAccountLogic.active(list, picked: "gone")?.label, "Account 1")
        XCTAssertEqual(ClaudeAccountLogic.accounts(services: ["Claude Code-credentials"], emails: [:]).first?.label, "Claude account")
    }
}
