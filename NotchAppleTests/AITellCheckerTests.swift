import XCTest

final class AITellCheckerTests: XCTestCase {
    private let robot = "Nestled in the heart of Dubai, our studio serves as a vibrant hub, showcasing a rich tapestry of designs. Additionally, it plays a pivotal role in the community — a testament to its legacy. Certainly! I hope this helps."
    private let human = "We're a small 3D printing shop in Dubai. We print custom parts, gifts and prototypes. Most orders ship within a week, and if one is late we tell you why."

    func testRobotTextScoresHighAndHumanTextLow() {
        let r = AITellChecker.report(robot), h = AITellChecker.report(human)
        XCTAssertGreaterThan(r.score, 40)
        XCTAssertLessThan(h.score, 15)
        XCTAssertGreaterThan(r.total, h.total)
        XCTAssertEqual(AITellChecker.report("").score, 0)
    }

    func testFindsTheTellsByName() {
        let labels = Set(AITellChecker.report(robot).tells.map(\.label))
        XCTAssertTrue(labels.isSuperset(of: ["AI vocabulary", "Promotional words", "Puffed-up importance", "Chatbot leftovers"]))
        XCTAssertTrue(AITellChecker.report("It is not just a tool, it's a way of life.").tells.contains { $0.label == "Negative parallelism" })
        XCTAssertTrue(AITellChecker.report("One. Two — three — four — five.").tells.contains { $0.label == "Em dashes" && $0.count == 2 })
        XCTAssertFalse(AITellChecker.report("One dash — is fine.").tells.contains { $0.label == "Em dashes" })
    }

    func testSafeFixes() {
        XCTAssertEqual(AITellChecker.autoFix("It serves as a hub and boasts two rooms."), "It is a hub and has two rooms.")
        XCTAssertEqual(AITellChecker.autoFix("We’re “open”."), "We're \"open\".")
        XCTAssertEqual(AITellChecker.autoFix("Here is **the** point."), "Here is the point.")
        XCTAssertEqual(AITellChecker.autoFix("It works. Additionally, it is cheap."), "It works. It is cheap.")
        XCTAssertEqual(AITellChecker.autoFix("A — B — C — D"), "A — B, C, D")
        XCTAssertEqual(AITellChecker.autoFix("Certainly! Here you go."), "Here you go.")
    }

    func testFixingLowersTheScore() {
        XCTAssertLessThan(AITellChecker.report(AITellChecker.autoFix(robot)).total, AITellChecker.report(robot).total)
    }

    func testUniformRhythm() {
        XCTAssertTrue(AITellChecker.isUniform([10, 11, 10, 9, 10, 11]))
        XCTAssertFalse(AITellChecker.isUniform([3, 22, 7, 14, 5, 30]))
        XCTAssertFalse(AITellChecker.isUniform([10, 10]))
    }

    func testVerdictWords() {
        XCTAssertEqual(AITellChecker.verdict(5), "Reads like a person")
        XCTAssertEqual(AITellChecker.verdict(90), "Reads like a chatbot")
    }
}
