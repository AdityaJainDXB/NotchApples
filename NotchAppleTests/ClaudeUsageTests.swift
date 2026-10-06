//
//  ClaudeUsageTests.swift
//  Notch apple tests
//
//  The Claude Code usage tracker's maths: reading transcript lines, the 5-hour windows, today and the week.
//

import XCTest

final class ClaudeUsageTests: XCTestCase {
    private let cal: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }()
    private func t(_ iso: String) -> Date { ClaudeUsageLogic.date(from: iso)! }
    private func entry(_ iso: String, tokens: Int = 100, model: String = "claude-sonnet-4-20250514") -> ClaudeUsageEntry {
        ClaudeUsageEntry(time: t(iso), model: model, input: tokens / 2, output: tokens - tokens / 2, cacheWrite: 10, cacheRead: 1000)
    }

    // MARK: Reading lines

    func testParsesAnAssistantReplyWithUsage() throws {
        let line = #"{"type":"assistant","timestamp":"2026-10-06T10:15:30.250Z","requestId":"req_1","message":{"id":"msg_1","model":"claude-opus-4-5-20251101","usage":{"input_tokens":120,"output_tokens":80,"cache_creation_input_tokens":300,"cache_read_input_tokens":4000}}}"#
        let parsed = try XCTUnwrap(ClaudeUsageLogic.parse(line: Data(line.utf8)))
        XCTAssertEqual(parsed.key, "msg_1:req_1")
        XCTAssertEqual(parsed.entry.tokens, 200)
        XCTAssertEqual(parsed.entry.allTokens, 4500)
        XCTAssertEqual(parsed.entry.model, "claude-opus-4-5-20251101")
    }

    func testIgnoresUserLinesBrokenJSONAndEmptyUsage() {
        XCTAssertNil(ClaudeUsageLogic.parse(line: Data(#"{"type":"user","timestamp":"2026-10-06T10:00:00Z","message":{"usage":{"input_tokens":5}}}"#.utf8)))
        XCTAssertNil(ClaudeUsageLogic.parse(line: Data("not json".utf8)))
        XCTAssertNil(ClaudeUsageLogic.parse(line: Data(#"{"type":"assistant","timestamp":"2026-10-06T10:00:00Z","message":{"model":"x","usage":{}}}"#.utf8)))
        XCTAssertNil(ClaudeUsageLogic.parse(line: Data(#"{"type":"assistant","timestamp":"2026-10-06T10:00:00Z","message":{"model":"<synthetic>","usage":{"input_tokens":5}}}"#.utf8)))
    }

    func testTimestampsWithAndWithoutFractions() {
        XCTAssertNotNil(ClaudeUsageLogic.date(from: "2026-10-06T10:15:30.250Z"))
        XCTAssertNotNil(ClaudeUsageLogic.date(from: "2026-10-06T10:15:30Z"))
        XCTAssertNil(ClaudeUsageLogic.date(from: "yesterday"))
    }

    // MARK: Windows

    func testAWindowStartsAtTheHourOfItsFirstMessage() {
        XCTAssertEqual(ClaudeUsageLogic.blockStart(for: t("2026-10-06T10:47:12Z")), t("2026-10-06T10:00:00Z"))
    }

    func testMessagesInsideFiveHoursShareAWindow() {
        let b = ClaudeUsageLogic.blocks([entry("2026-10-06T10:20:00Z"), entry("2026-10-06T12:00:00Z"), entry("2026-10-06T14:50:00Z")])
        XCTAssertEqual(b.count, 1)
        XCTAssertEqual(b[0].totals.messages, 3)
        XCTAssertEqual(b[0].start, t("2026-10-06T10:00:00Z"))
        XCTAssertEqual(b[0].end, t("2026-10-06T15:00:00Z"))
    }

    func testAMessageAfterTheWindowEndsStartsANewOne() {
        let b = ClaudeUsageLogic.blocks([entry("2026-10-06T10:20:00Z"), entry("2026-10-06T15:05:00Z")])
        XCTAssertEqual(b.count, 2)
        XCTAssertEqual(b[1].start, t("2026-10-06T15:00:00Z"))
    }

    func testOrderDoesNotMatter() {
        let a = [entry("2026-10-06T10:20:00Z"), entry("2026-10-06T11:00:00Z")]
        XCTAssertEqual(ClaudeUsageLogic.blocks(a), ClaudeUsageLogic.blocks(a.reversed()))
    }

    func testCurrentWindowMustBeActive() {
        let entries = [entry("2026-10-06T10:20:00Z")]
        XCTAssertNotNil(ClaudeUsageLogic.currentBlock(entries, now: t("2026-10-06T12:00:00Z")))
        XCTAssertNil(ClaudeUsageLogic.currentBlock(entries, now: t("2026-10-06T15:30:00Z")), "the window has ended")
        XCTAssertNil(ClaudeUsageLogic.currentBlock([], now: t("2026-10-06T12:00:00Z")))
    }

    // MARK: Totals

    func testTodayAndWeekTotals() {
        let now = t("2026-10-06T18:00:00Z")
        let s = ClaudeUsageLogic.summary([
            entry("2026-10-06T09:00:00Z", tokens: 100),                       // today
            entry("2026-10-05T09:00:00Z", tokens: 200),                       // yesterday
            entry("2026-09-30T09:00:00Z", tokens: 400),                       // 6 days ago: still this week
            entry("2026-09-29T09:00:00Z", tokens: 800),                       // 7 days ago: out
        ], now: now, calendar: cal)
        XCTAssertEqual(s.today.tokens, 100)
        XCTAssertEqual(s.week.tokens, 700)
        XCTAssertEqual(s.week.messages, 3)
    }

    func testModelsAreRankedByTokens() {
        let s = ClaudeUsageLogic.summary([
            entry("2026-10-06T09:00:00Z", tokens: 100, model: "claude-haiku-4-5-20251001"),
            entry("2026-10-06T09:05:00Z", tokens: 900, model: "claude-opus-4-5-20251101"),
        ], now: t("2026-10-06T10:00:00Z"), calendar: cal)
        XCTAssertEqual(s.byModel.map(\.model), ["claude-opus-4-5-20251101", "claude-haiku-4-5-20251001"])
    }

    func testFutureEntriesAreIgnoredInTotals() {
        let s = ClaudeUsageLogic.summary([entry("2026-10-07T09:00:00Z", tokens: 500)], now: t("2026-10-06T10:00:00Z"), calendar: cal)
        XCTAssertEqual(s.week.tokens, 0)
    }

    // MARK: Words and numbers

    func testFormatting() {
        XCTAssertEqual(ClaudeUsageLogic.format(999), "999")
        XCTAssertEqual(ClaudeUsageLogic.format(12_345), "12.3K")
        XCTAssertEqual(ClaudeUsageLogic.format(4_560_000), "4.56M")
    }

    func testFriendlyModelNames() {
        XCTAssertEqual(ClaudeUsageLogic.friendlyModel("claude-opus-4-5-20251101"), "Opus 4.5")
        XCTAssertEqual(ClaudeUsageLogic.friendlyModel("claude-sonnet-4-20250514"), "Sonnet 4")
        XCTAssertEqual(ClaudeUsageLogic.friendlyModel("claude-3-5-sonnet-20241022"), "Sonnet 3.5")
        XCTAssertEqual(ClaudeUsageLogic.friendlyModel("claude-haiku-4-5-20251001"), "Haiku 4.5")
        XCTAssertEqual(ClaudeUsageLogic.friendlyModel("gpt-something"), "gpt-something")
    }

    func testBudgetFractionAndCountdown() {
        XCTAssertNil(ClaudeUsageLogic.fraction(500, budget: 0))
        XCTAssertEqual(ClaudeUsageLogic.fraction(500, budget: 1000), 0.5)
        XCTAssertEqual(ClaudeUsageLogic.fraction(5000, budget: 1000), 1, "never past full")
        let now = t("2026-10-06T10:00:00Z")
        XCTAssertEqual(ClaudeUsageLogic.remaining(until: now.addingTimeInterval(2 * 3600 + 14 * 60), now: now), "2h 14m")
        XCTAssertEqual(ClaudeUsageLogic.remaining(until: now.addingTimeInterval(45 * 60), now: now), "45m")
        XCTAssertEqual(ClaudeUsageLogic.remaining(until: now.addingTimeInterval(10), now: now), "now")
    }

    // MARK: Alerts and the daily summary

    func testBudgetAlertFiresOncePerPeriodAtNinetyPercent() {
        XCTAssertFalse(ClaudeUsageLogic.alertDue(used: 899, budget: 1000, alertedKey: "", key: "w1"))
        XCTAssertTrue(ClaudeUsageLogic.alertDue(used: 900, budget: 1000, alertedKey: "", key: "w1"))
        XCTAssertFalse(ClaudeUsageLogic.alertDue(used: 950, budget: 1000, alertedKey: "w1", key: "w1"), "already told you this period")
        XCTAssertTrue(ClaudeUsageLogic.alertDue(used: 950, budget: 1000, alertedKey: "w1", key: "w2"), "a new period re-arms it")
        XCTAssertFalse(ClaudeUsageLogic.alertDue(used: 5000, budget: 0, alertedKey: "", key: "w1"), "no budget, no alert")
        XCTAssertTrue(ClaudeUsageLogic.alertDue(used: 500, budget: 1000, threshold: 0.5, alertedKey: "", key: "w1"))
    }

    func testDailySummaryOncePerDayAfterYourTime() {
        XCTAssertFalse(ClaudeUsageLogic.summaryDue(minuteOfDay: 1000, at: 1080, lastDayKey: "", todayKey: "2026-10-06"))
        XCTAssertTrue(ClaudeUsageLogic.summaryDue(minuteOfDay: 1080, at: 1080, lastDayKey: "2026-10-05", todayKey: "2026-10-06"))
        XCTAssertTrue(ClaudeUsageLogic.summaryDue(minuteOfDay: 1300, at: 1080, lastDayKey: "", todayKey: "2026-10-06"), "late is better than never")
        XCTAssertFalse(ClaudeUsageLogic.summaryDue(minuteOfDay: 1300, at: 1080, lastDayKey: "2026-10-06", todayKey: "2026-10-06"))
    }

    func testSummaryWording() {
        var today = ClaudeTokens(), week = ClaudeTokens()
        XCTAssertEqual(ClaudeUsageLogic.summaryText(today: today, week: week, topModel: nil), "No Claude Code use today. This week: 0 tokens.")
        today.add(entry("2026-10-06T10:00:00Z", tokens: 1000)); week.add(entry("2026-10-06T10:00:00Z", tokens: 1000)); week.add(entry("2026-10-05T10:00:00Z", tokens: 20_000))
        XCTAssertEqual(ClaudeUsageLogic.summaryText(today: today, week: week, topModel: "claude-opus-5-5"), "1,000 tokens in 1 reply today · 21.0K this week · mostly Opus 5.5")
        today.add(entry("2026-10-06T11:00:00Z", tokens: 500))
        XCTAssertEqual(ClaudeUsageLogic.summaryText(today: today, week: week, topModel: nil), "1,500 tokens in 2 replies today · 21.0K this week")
    }
}
