import XCTest


final class MessengerQuotaTests: XCTestCase {
    private var cal: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }
    private func date(_ y: Int, _ m: Int, _ d: Int) -> Date { cal.date(from: DateComponents(year: y, month: m, day: d, hour: 12))! }

    func testMonthlyLimitsPerTier() {
        XCTAssertEqual(MessengerQuotaLogic.limit(for: .free), 500)
        XCTAssertEqual(MessengerQuotaLogic.limit(for: .pro), 1_000)
        XCTAssertEqual(MessengerQuotaLogic.limit(for: .ultimate), 5_000)
    }

    func testCountStartsAgainInANewMonth() {
        let old = MessengerQuotaLogic.Count(month: "2026-10", used: 480)
        XCTAssertEqual(MessengerQuotaLogic.current(old, now: date(2026, 11, 1), calendar: cal), .init(month: "2026-11", used: 0))
        let same = MessengerQuotaLogic.Count(month: "2026-11", used: 12)
        XCTAssertEqual(MessengerQuotaLogic.current(same, now: date(2026, 11, 30), calendar: cal).used, 12)
        XCTAssertEqual(MessengerQuotaLogic.current(nil, now: date(2026, 11, 3), calendar: cal).used, 0)
    }

    func testNearLimitAndRemaining() {
        let c = { MessengerQuotaLogic.Count(month: "2026-11", used: $0) }
        XCTAssertFalse(MessengerQuotaLogic.isNearLimit(c(399), limit: 500))
        XCTAssertTrue(MessengerQuotaLogic.isNearLimit(c(400), limit: 500))
        XCTAssertFalse(MessengerQuotaLogic.isNearLimit(c(500), limit: 500))
        XCTAssertEqual(MessengerQuotaLogic.remaining(c(520), limit: 500), 0)
    }

    func testBurstLimitIsFiveInTenSeconds() {
        let now = Date()
        let four = (0..<4).map { now.addingTimeInterval(-Double($0)) }
        XCTAssertNil(MessengerQuotaLogic.burstWait(recent: four, now: now))
        let five = (0..<5).map { now.addingTimeInterval(-Double($0) * 2) }       // sent 0, 2, 4, 6, 8 seconds ago
        XCTAssertEqual(MessengerQuotaLogic.burstWait(recent: five, now: now), 2)  // the oldest leaves the window in 2 seconds
        let old = (0..<5).map { now.addingTimeInterval(-11 - Double($0)) }
        XCTAssertNil(MessengerQuotaLogic.burstWait(recent: old, now: now))
    }
}
