//
//  TourLogicTests.swift
//  Notch apple tests
//
//  Who sees the walkthrough and how its steps move.
//

import XCTest

final class TourLogicTests: XCTestCase {
    func testItIsCompulsoryUntilFinishedButNotForANewInstall() {
        XCTAssertTrue(TourLogic.needed(done: false, freshInstall: false))
        XCTAssertFalse(TourLogic.needed(done: true, freshInstall: false))
        XCTAssertFalse(TourLogic.needed(done: false, freshInstall: true))
    }

    func testStepsStayInRange() {
        XCTAssertEqual(TourLogic.back(0), 0)
        XCTAssertEqual(TourLogic.next(TourLogic.stepCount - 1), TourLogic.stepCount - 1)
        XCTAssertEqual(TourLogic.next(2), 3)
        XCTAssertTrue(TourLogic.isLast(TourLogic.stepCount - 1))
        XCTAssertFalse(TourLogic.isLast(0))
    }

    func testASavedStepIsClamped() {
        XCTAssertEqual(TourLogic.clamp(-4), 0)
        XCTAssertEqual(TourLogic.clamp(99), TourLogic.stepCount - 1)
        XCTAssertEqual(TourLogic.clamp(3), 3)
    }
}
