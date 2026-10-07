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
}
