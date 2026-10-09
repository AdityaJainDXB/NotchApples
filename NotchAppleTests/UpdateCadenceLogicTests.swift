//
//  UpdateCadenceLogicTests.swift
//  Notch apple
//

import XCTest

final class UpdateCadenceLogicTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func may(weekly: Bool = true, last: Date?, offered: String = "", version: String = "2.1.0", required: Bool = false) -> Bool {
        UpdateCadenceLogic.mayAnnounce(weekly: weekly, lastOffer: last, offeredVersion: offered, version: version, now: now, required: required)
    }

    func testOffIsAlwaysAllowed() {
        XCTAssertTrue(may(weekly: false, last: now.addingTimeInterval(-60)))
    }

    func testTheFirstAnnouncementComesThrough() {
        XCTAssertTrue(may(last: nil))
    }

    func testAnotherReleaseWithinAWeekWaits() {
        XCTAssertFalse(may(last: now.addingTimeInterval(-2 * 86_400), offered: "2.0.9", version: "2.1.0"))
        XCTAssertFalse(may(last: now.addingTimeInterval(-6.9 * 86_400), offered: "2.0.9", version: "2.1.0"))
    }

    func testAfterAWeekTheNewestIsOffered() {
        XCTAssertTrue(may(last: now.addingTimeInterval(-7 * 86_400), offered: "2.0.9", version: "2.1.0"))
        XCTAssertTrue(may(last: now.addingTimeInterval(-30 * 86_400), offered: "2.0.9", version: "2.1.0"))
    }

    func testTheVersionAlreadyOnOfferStaysVisible() {
        XCTAssertTrue(may(last: now.addingTimeInterval(-86_400), offered: "2.1.0", version: "2.1.0"))
    }

    func testRequiredReleasesAreNeverHeldBack() {
        XCTAssertTrue(may(last: now.addingTimeInterval(-60), offered: "2.0.9", version: "2.1.0", required: true))
    }

    func testNextOfferIsAWeekAfterTheLast() {
        XCTAssertEqual(UpdateCadenceLogic.nextOffer(lastOffer: now), now.addingTimeInterval(7 * 86_400))
        XCTAssertNil(UpdateCadenceLogic.nextOffer(lastOffer: nil))
    }
}
