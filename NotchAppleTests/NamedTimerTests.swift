import XCTest

final class NamedTimerTests: XCTestCase {
    private func p(_ s: String) -> String { ProjectString(NamedTimerLogic.parse(s)) }
    private func ProjectString(_ r: (name: String, seconds: Int)?) -> String { r.map { "\($0.name)|\($0.seconds)" } ?? "nil" }

    func testUnitsClockAndBareNumbers() {
        XCTAssertEqual(p("Pasta 10m"), "Pasta|600")
        XCTAssertEqual(p("Tea 3 min"), "Tea|180")
        XCTAssertEqual(p("1h30m"), "Timer|5400")
        XCTAssertEqual(p("Run 1h 30m"), "Run|5400")
        XCTAssertEqual(p("Laundry for 45"), "Laundry|2700")
        XCTAssertEqual(p("Egg 1:30"), "Egg|90")
        XCTAssertEqual(p("Meeting 1:00:00"), "Meeting|3600")
        XCTAssertEqual(p("Nap 1.5h"), "Nap|5400")
        XCTAssertEqual(p("Quick 90s"), "Quick|90")
        XCTAssertEqual(p("25"), "Timer|1500")
    }

    func testRefusesNoTimeZeroAndOverADay() {
        XCTAssertEqual(p("Just words"), "nil")
        XCTAssertEqual(p(""), "nil")
        XCTAssertEqual(p("x 0m"), "nil")
        XCTAssertEqual(p("x 25h"), "nil")
        XCTAssertEqual(p("Room2m"), "nil")
    }

    func testClock() {
        XCTAssertEqual(NamedTimerLogic.clock(125), "2:05")
        XCTAssertEqual(NamedTimerLogic.clock(3723), "1:02:03")
        XCTAssertEqual(NamedTimerLogic.clock(-5), "0:00")
    }
}
