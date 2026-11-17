import XCTest

final class ThreeCardTests: XCTestCase {
    private func hand(_ s: String) -> [PlayingCard] {
        // "AS KH 10D": rank then suit letter.
        s.split(separator: " ").enumerated().map { i, t in
            let suit: Suit = ["S": .spades, "H": .hearts, "D": .diamonds, "C": .clubs][t.last!]!
            return PlayingCard(id: "\(i)\(t)", rank: String(t.dropLast()), suit: suit)
        }
    }
    private func cat(_ s: String) -> ThreeCard.Category { ThreeCard.evaluate(hand(s)).category }

    func testCategories() {
        XCTAssertEqual(cat("7S 7H 7D"), .threeOfAKind)
        XCTAssertEqual(cat("9H 10H JH"), .straightFlush)
        XCTAssertEqual(cat("9H 10C JH"), .straight)
        XCTAssertEqual(cat("2H 9H KH"), .flush)
        XCTAssertEqual(cat("5C 5D KH"), .pair)
        XCTAssertEqual(cat("2C 9D KH"), .highCard)
        XCTAssertEqual(cat("AS 2H 3D"), .straight, "A-2-3 is a straight")
        XCTAssertEqual(cat("QS KH AD"), .straight, "Q-K-A is a straight")
        XCTAssertEqual(cat("KS AH 2D"), .highCard, "no wrap-around straight")
    }

    func testThreeOfAKindBeatsStraightFlush() {
        XCTAssertGreaterThan(ThreeCard.evaluate(hand("2S 2H 2D")), ThreeCard.evaluate(hand("QH KH AH")))
    }

    func testOrderAndTieBreaks() {
        let order = ["2C 9D KH", "5C 5D KH", "2H 9H KH", "9H 10C JH", "9H 10H JH", "7S 7H 7D"].map { ThreeCard.evaluate(hand($0)) }
        XCTAssertEqual(order, order.sorted(), "high card < pair < flush < straight < straight flush < three of a kind")
        XCTAssertLessThan(ThreeCard.evaluate(hand("AS 2H 3D")), ThreeCard.evaluate(hand("2S 3H 4D")), "A-2-3 is the lowest straight")
        XCTAssertLessThan(ThreeCard.evaluate(hand("8C 8D 2H")), ThreeCard.evaluate(hand("8S 8H 3D")), "equal pairs: the kicker decides")
        XCTAssertLessThan(ThreeCard.evaluate(hand("KC 9D 2H")), ThreeCard.evaluate(hand("KS 9H 3D")), "high card: third card decides")
        XCTAssertLessThan(ThreeCard.evaluate(hand("AS 9D 8H")), ThreeCard.evaluate(hand("2C 2D 3H")), "a pair beats ace-high")
    }

    func testWinnersAndDraws() {
        XCTAssertEqual(ThreeCard.winners([hand("2C 9D KH"), hand("5C 5D 3H")]), [1])
        XCTAssertEqual(ThreeCard.winners([hand("KC 9D 2H"), hand("KS 9H 2D")]), [0, 1], "suits never break a tie: a draw")
        XCTAssertEqual(ThreeCard.split(31, among: 2), [16, 15])
    }

    func testComputerPlaysQueenHighOrBetter() {
        XCTAssertTrue(ThreeCard.cpuPlays(hand("QC 6D 4H")))
        XCTAssertFalse(ThreeCard.cpuPlays(hand("JC 9D 4H")))
        XCTAssertTrue(ThreeCard.cpuPlays(hand("2C 2D 4H")))
    }
}
