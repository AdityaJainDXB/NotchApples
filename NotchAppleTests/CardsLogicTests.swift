import XCTest

final class CardsLogicTests: XCTestCase {
    private func hand(_ ranks: String...) -> [PlayingCard] { ranks.enumerated().map { PlayingCard(id: "\($0.offset)", rank: $0.element, suit: .spades) } }

    func testDeck() {
        let d = Cards.deck(); XCTAssertEqual(d.count, 52); XCTAssertEqual(Set(d.map(\.id)).count, 52)
    }
    func testBlackjackTotals() {
        XCTAssertEqual(Cards.bjValue(hand("A", "K")).total, 21); XCTAssertTrue(Cards.bjValue(hand("A", "K")).soft)
        XCTAssertEqual(Cards.bjValue(hand("A", "A", "9")).total, 21)
        XCTAssertEqual(Cards.bjValue(hand("A", "K", "5")).total, 16); XCTAssertFalse(Cards.bjValue(hand("A", "K", "5")).soft)
        XCTAssertEqual(Cards.bjValue(hand("K", "Q", "5")).total, 25)
        XCTAssertTrue(Cards.isBlackjack(hand("A", "K"))); XCTAssertFalse(Cards.isBlackjack(hand("7", "7", "7")))
        XCTAssertTrue(Cards.dealerShouldHit(hand("10", "6"))); XCTAssertFalse(Cards.dealerShouldHit(hand("10", "7")))
        XCTAssertFalse(Cards.dealerShouldHit(hand("A", "6")))
    }
    func testBlackjackOutcomes() {
        XCTAssertEqual(Cards.bjOutcome(player: hand("A", "K"), dealer: hand("10", "7")).pay, 1.5)
        XCTAssertEqual(Cards.bjOutcome(player: hand("A", "K"), dealer: hand("A", "Q")).pay, 0)
        XCTAssertEqual(Cards.bjOutcome(player: hand("K", "Q", "5"), dealer: hand("10", "7")).pay, -1)
        XCTAssertEqual(Cards.bjOutcome(player: hand("10", "9"), dealer: hand("10", "6", "9")).pay, 1)
        XCTAssertEqual(Cards.bjOutcome(player: hand("10", "8"), dealer: hand("10", "8")).pay, 0)
        XCTAssertEqual(Cards.bjOutcome(player: hand("10", "7"), dealer: hand("10", "8")).pay, -1)
        XCTAssertEqual(Cards.bjOutcome(player: hand("7", "7", "7"), dealer: hand("A", "K")).pay, -1)
    }
    func testSolitaire() {
        let s = Cards.solDeal(Cards.deck())
        XCTAssertEqual(s.tableau.map(\.count), [1, 2, 3, 4, 5, 6, 7]); XCTAssertEqual(s.stock.count, 24)
        XCTAssertTrue(s.tableau.allSatisfy { p in p.enumerated().allSatisfy { $0.element.up == ($0.offset == p.count - 1) } })
        let red6 = PlayingCard(id: "a", rank: "6", suit: .hearts), b5 = PlayingCard(id: "b", rank: "5", suit: .spades), r5 = PlayingCard(id: "c", rank: "5", suit: .diamonds)
        XCTAssertTrue(Cards.canPlaceTableau(b5, on: [red6])); XCTAssertFalse(Cards.canPlaceTableau(r5, on: [red6]))
        XCTAssertTrue(Cards.canPlaceTableau(PlayingCard(id: "k", rank: "K", suit: .clubs), on: []))
        XCTAssertFalse(Cards.canPlaceTableau(PlayingCard(id: "q", rank: "Q", suit: .clubs), on: []))
        let ac = PlayingCard(id: "x", rank: "A", suit: .clubs)
        XCTAssertTrue(Cards.canPlaceFoundation(ac, on: [])); XCTAssertTrue(Cards.canPlaceFoundation(PlayingCard(id: "y", rank: "2", suit: .clubs), on: [ac]))
        XCTAssertFalse(Cards.canPlaceFoundation(PlayingCard(id: "z", rank: "2", suit: .hearts), on: [ac]))
    }
}
