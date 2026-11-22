import XCTest

final class HumanizerTests: XCTestCase {
    private var cal: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }
    private func date(_ y: Int, _ m: Int, _ d: Int) -> Date { cal.date(from: DateComponents(year: y, month: m, day: d, hour: 12))! }
    private func usage(used: Int = 0, credits: Int = 0) -> HumanizerLogic.Usage { .init(month: "2026-11", used: used, credits: credits) }

    func testLimitsByPlan() {
        XCTAssertEqual(HumanizerLogic.perRequestLimit(for: .free), 500)
        XCTAssertEqual(HumanizerLogic.perRequestLimit(for: .pro), 1_000)
        XCTAssertNil(HumanizerLogic.perRequestLimit(for: .ultimate))
        XCTAssertEqual(HumanizerLogic.monthlyAllowance(for: .free), 3_000)
        XCTAssertEqual(HumanizerLogic.monthlyAllowance(for: .pro), 15_000)
        XCTAssertEqual(HumanizerLogic.monthlyAllowance(for: .ultimate), 40_000)
        XCTAssertEqual(HumanizerLogic.wordsPerDollar, 50_000)
    }

    func testWordCount() {
        XCTAssertEqual(HumanizerLogic.wordCount("  Hello,   big\nworld  "), 3)
        XCTAssertEqual(HumanizerLogic.wordCount(""), 0)
    }

    func testOneRequestCannotBeLongerThanThePlanAllows() {
        XCTAssertEqual(HumanizerLogic.decide(words: 501, tier: .free, usage: usage()), .tooLong(limit: 500, words: 501))
        XCTAssertEqual(HumanizerLogic.decide(words: 500, tier: .free, usage: usage()), .allowed(fromMonth: 500, fromCredits: 0))
        XCTAssertEqual(HumanizerLogic.decide(words: 1_001, tier: .pro, usage: usage()), .tooLong(limit: 1_000, words: 1_001))
        XCTAssertEqual(HumanizerLogic.decide(words: 30_000, tier: .ultimate, usage: usage()), .allowed(fromMonth: 30_000, fromCredits: 0))
        XCTAssertEqual(HumanizerLogic.decide(words: 0, tier: .pro, usage: usage()), .empty)
    }

    func testTheMonthRunsOutThenCreditsCoverTheRest() {
        XCTAssertEqual(HumanizerLogic.decide(words: 400, tier: .free, usage: usage(used: 2_700)), .outOfWords(needed: 400, left: 300))
        XCTAssertEqual(HumanizerLogic.decide(words: 400, tier: .free, usage: usage(used: 2_700, credits: 100)), .allowed(fromMonth: 300, fromCredits: 100))
        XCTAssertEqual(HumanizerLogic.decide(words: 400, tier: .free, usage: usage(used: 2_700, credits: 99)), .outOfWords(needed: 400, left: 399))
        XCTAssertEqual(HumanizerLogic.decide(words: 100, tier: .free, usage: usage(used: 3_000, credits: 500)), .allowed(fromMonth: 0, fromCredits: 100))
    }

    func testApplyingTakesMonthFirstThenCredits() {
        let d = HumanizerLogic.decide(words: 400, tier: .free, usage: usage(used: 2_700, credits: 150))
        XCTAssertEqual(HumanizerLogic.applying(d, to: usage(used: 2_700, credits: 150)), usage(used: 3_000, credits: 50))
        let blocked = HumanizerLogic.decide(words: 600, tier: .free, usage: usage())
        XCTAssertEqual(HumanizerLogic.applying(blocked, to: usage(used: 5)), usage(used: 5))
    }

    func testANewMonthRenewsWordsButKeepsCredits() {
        let old = HumanizerLogic.Usage(month: "2026-10", used: 2_900, credits: 700)
        let now = HumanizerLogic.current(old, now: date(2026, 11, 1), calendar: cal)
        XCTAssertEqual(now, HumanizerLogic.Usage(month: "2026-11", used: 0, credits: 700))
        XCTAssertEqual(HumanizerLogic.totalLeft(now, tier: .free), 3_700)
    }

    func testCreditsPrice() {
        XCTAssertEqual(HumanizerLogic.dollars(forWords: 50_000), 1.0)
        XCTAssertEqual(HumanizerLogic.dollars(forWords: 25_000), 0.5)
        XCTAssertEqual(HumanizerLogic.dollars(forWords: 1), 0.01)
    }

    func testReplyIsCleanedAndMessagesExplainThemselves() {
        XCTAssertEqual(HumanizerLogic.clean("<<<TEXT\n  Hi there.\nTEXT>>>\n"), "Hi there.")
        XCTAssertTrue(HumanizerLogic.userMessage("abc").contains("abc"))
        XCTAssertNotNil(HumanizerLogic.message(for: .tooLong(limit: 500, words: 600), tier: .free))
        XCTAssertNotNil(HumanizerLogic.message(for: .outOfWords(needed: 10, left: 0), tier: .pro))
        XCTAssertNil(HumanizerLogic.message(for: .allowed(fromMonth: 1, fromCredits: 0), tier: .pro))
    }

    func testAdminHasNoLimits() {
        XCTAssertNil(HumanizerLogic.perRequestLimit(for: .admin))
        XCTAssertEqual(HumanizerLogic.monthlyAllowance(for: .admin), Int.max)
        XCTAssertNil(HumanizerLogic.message(for: .allowed(fromMonth: 999_999, fromCredits: 0), tier: .admin))
    }

    func testAdminTotalLeftDoesNotOverflowWithCredits() {
        let u = HumanizerLogic.Usage(month: "2026-11", used: 0, credits: 500)
        XCTAssertEqual(HumanizerLogic.totalLeft(u, tier: .admin), Int.max)
    }
}
