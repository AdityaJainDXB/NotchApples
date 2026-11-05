import XCTest

// The Token Trail view's maths (TokenTrailLogic.swift): reading Claude Code logs and summarising them, no screen and no files.
final class TokenTrailTests: XCTestCase {
    private func line(_ o: [String: Any]) -> String { String(data: try! JSONSerialization.data(withJSONObject: o), encoding: .utf8)! }
    private func file(_ lines: [String], rel: [String] = ["-Users-me-Projects-Cool-App", "s1.jsonl"]) -> TrailFile {
        TokenTrailLogic.parseFile(Data(lines.joined(separator: "\n").utf8), rel: rel)
    }
    private func assistant(_ ts: String, id: String = "m1", req: String = "r1", model: String = "claude-opus-4-5", input: Int = 10, output: Int = 20, cw: Int = 0, cr: Int = 0,
                           content: [[String: Any]] = [], speed: String? = nil, sidechain: Bool = false) -> String {
        var usage: [String: Any] = ["input_tokens": input, "output_tokens": output, "cache_creation_input_tokens": cw, "cache_read_input_tokens": cr]
        if let speed { usage["speed"] = speed }
        return line(["type": "assistant", "timestamp": ts, "requestId": req, "isSidechain": sidechain,
                     "message": ["id": id, "model": model, "usage": usage, "content": content]])
    }
    private func user(_ ts: String, prompt: Bool = true) -> String {
        line(["type": "user", "timestamp": ts, "message": ["content": prompt ? "hello" as Any : [["type": "tool_result"]] as Any]])
    }

    func testTimestampsParseLikeTheSystemParser() {
        for s in ["2026-11-05T14:19:59.123Z", "2026-11-05T14:19:59Z", "2024-02-29T00:00:00.5Z", "1999-12-31T23:59:59.999Z", "2026-11-05T14:19:59+04:00", "2026-11-05T14:19:59-0530"] {
            let want = ISO8601DateFormatter().then(s)
            XCTAssertNotNil(want, s)
            XCTAssertEqual(TokenTrailLogic.seconds(fromISO: s)!, want!, "\(s)")
        }
        XCTAssertNil(TokenTrailLogic.seconds(fromISO: "nonsense"))
        XCTAssertEqual(TokenTrailLogic.daysFromCivil(1970, 1, 1), 0)
        XCTAssertEqual(TokenTrailLogic.dayNumber("1970-01-02"), 1)
    }

    func testAReplyIsCountedOnceAndThinkingAndSkillsAreSeen() {
        let skill: [[String: Any]] = [["type": "thinking"], ["type": "tool_use", "name": "Skill", "input": ["skill": "impeccable"]]]
        let f = file([
            user("2026-11-05T10:00:00Z"),
            assistant("2026-11-05T10:00:05Z", id: "a", input: 100, output: 50, cw: 1000, cr: 5000, content: skill, speed: "fast"),
            assistant("2026-11-05T10:00:06Z", id: "a", input: 100, output: 50, cw: 1000, cr: 5000),   // the same reply written again
            assistant("2026-11-05T10:01:00Z", id: "b", model: "<synthetic>"),
            user("2026-11-05T10:01:30Z", prompt: false),
        ])
        XCTAssertEqual(f.recs.count, 1)
        XCTAssertEqual(f.recs[0].sum, 6150)
        XCTAssertTrue(f.recs[0].think); XCTAssertTrue(f.recs[0].fast)
        XCTAssertEqual(f.skills, ["impeccable": 1])
        XCTAssertEqual(f.proj, "App")
        XCTAssertTrue(f.session)
        XCTAssertEqual(f.tok, 6150)
    }

    func testSubAgentFilesAreNotSessionsAndTheLongestTaskTrimsLongWaits() {
        let sub = file([assistant("2026-11-05T10:00:05Z")], rel: ["-Users-me-p", "s1", "subagents", "agent.jsonl"])
        XCTAssertFalse(sub.session)
        XCTAssertEqual(sub.recs.count, 1, "a sub-agent's tokens still count")
        // A prompt at 10:00, replies at 10:05 and 11:30 (a 85-minute wait counts as 15), then a new prompt.
        let f = file([user("2026-11-05T10:00:00Z"), assistant("2026-11-05T10:05:00Z", id: "x"), assistant("2026-11-05T11:30:00Z", id: "y"), user("2026-11-05T11:31:00Z")])
        XCTAssertEqual(f.longestMs, (5 + 15) * 60_000, accuracy: 1)
        XCTAssertNotNil(f.longestDay)
    }

    func testTheSummaryDeduplicatesAcrossFilesAndPricesModels() {
        let a = file([assistant("2026-11-05T10:00:00Z", id: "same", model: "claude-sonnet-4-5", input: 1_000_000, output: 0)])
        let b = file([assistant("2026-11-05T10:00:00Z", id: "same", model: "claude-sonnet-4-5", input: 1_000_000, output: 0),   // a resumed session replays it
                      assistant("2026-11-05T12:00:00Z", id: "other", model: "gpt-x", input: 500, output: 500)])
        let s = TokenTrailLogic.build([a, b])
        XCTAssertEqual(s.replies, 2)
        XCTAssertEqual(s.total(cache: true), 1_001_000)
        XCTAssertEqual(s.totalUSD, 3.0, accuracy: 0.0001, "one million Sonnet input tokens at $3")
        XCTAssertEqual(s.unpriced, 1000, "the unknown model is left out of the value, not guessed")
        XCTAssertEqual(s.total(cache: false), 1_001_000)
        XCTAssertEqual(TrailPricing.price("claude-haiku-4-5")?.0, 1)
        XCTAssertEqual(TrailPricing.price("claude-3-5-haiku-20241022")?.1, 4)
        XCTAssertEqual(TrailPricing.price("claude-opus-4-1-20250805")?.1, 75)
        XCTAssertEqual(TrailPricing.price("claude-opus-4-5")?.1, 25)
        XCTAssertNil(TrailPricing.price("claude chat"))
        XCTAssertEqual(TrailPricing.value("claude-opus-4-5", [0, 0, 1_000_000, 1_000_000])!, 5 * 1.25 + 5 * 0.1, accuracy: 0.0001)
    }

    func testFiveHourBlocksAndTheBiggestOne() {
        let f = file([assistant("2026-11-05T10:20:00Z", id: "1", input: 100, output: 0), assistant("2026-11-05T12:00:00Z", id: "2", input: 200, output: 0),
                      assistant("2026-11-05T15:30:00Z", id: "3", input: 50, output: 0)])      // 5h10m after 10:20: a new block
        let s = TokenTrailLogic.build([f])
        XCTAssertEqual(s.blocks.count, 2)
        XCTAssertEqual(s.blocks[0].tokens, 300)
        XCTAssertEqual(s.peakBlock, 300)
        XCTAssertEqual(s.blocks[0].start, s.blocks[0].start.rounded(.down) , "blocks start on the hour")
        XCTAssertEqual(Int(s.blocks[0].start) % 3600, 0)
    }

    func testStreaksHeatmapAndBudgetStages() {
        var s = TrailSummary()
        let cal = Calendar.current
        let now = Date()
        for back in [0, 1, 2, 5, 6] { s.days[TrailSummary.key(cal.date(byAdding: .day, value: -back, to: now)!)] = [100 * (back + 1), 0, 0, 0] }
        s.days[TrailSummary.key(cal.date(byAdding: .day, value: -40, to: now)!)] = [1, 0, 0, 0]
        let streak = s.streaks(now: now)
        XCTAssertEqual(streak.best, 3)
        XCTAssertEqual(streak.current, 3)
        var old = TrailSummary()
        old.days[TrailSummary.key(cal.date(byAdding: .day, value: -3, to: now)!)] = [5, 0, 0, 0]
        XCTAssertEqual(old.streaks(now: now).current, 0, "a streak that ended three days ago is over")
        let heat = s.heat(cache: true, now: now)
        XCTAssertEqual(heat.values.count, 53 * 7)
        XCTAssertEqual(heat.levels.filter { $0 > 0 }.count, 6)
        XCTAssertTrue(heat.levels.contains(4))
        XCTAssertEqual(heat.levels.last { $0 >= 0 }, heat.levels[heat.values.lastIndex { $0 >= 0 }!])
        XCTAssertEqual(TrailSummary.budgetStage(spent: 79, budget: 100), 0)
        XCTAssertEqual(TrailSummary.budgetStage(spent: 80, budget: 100), 80)
        XCTAssertEqual(TrailSummary.budgetStage(spent: 100, budget: 100), 100)
        XCTAssertEqual(TrailSummary.budgetStage(spent: 500, budget: 0), 0)
        XCTAssertEqual(s.lastDays(1, cache: true, now: now), 100)
        XCTAssertEqual(s.lastDays(7, cache: true, now: now), 100 + 200 + 300 + 600 + 700)
    }

    func testNumbersAreShownShortly() {
        XCTAssertEqual(TrailFormat.tokens(950), "950")
        XCTAssertEqual(TrailFormat.tokens(12_345), "12.3K")
        XCTAssertEqual(TrailFormat.tokens(1_234_567), "1.23M")
        XCTAssertEqual(TrailFormat.tokens(2_500_000_000), "2.50B")
        XCTAssertEqual(TrailFormat.money(3.456), "$3.46")
        XCTAssertEqual(TrailFormat.money(1234.4), "$1,234")
        XCTAssertEqual(TrailFormat.duration(95 * 60_000), "1h 35m")
        XCTAssertEqual(TrailFormat.model("claude-opus-4-5-20251101"), "opus-4-5")
    }
}

private extension ISO8601DateFormatter {
    func then(_ s: String) -> Double? {
        formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = date(from: s) { return d.timeIntervalSince1970 }
        formatOptions = [.withInternetDateTime]
        if let d = date(from: s) { return d.timeIntervalSince1970 }
        formatOptions = [.withInternetDateTime, .withColonSeparatorInTimeZone]
        return nil
    }
}
