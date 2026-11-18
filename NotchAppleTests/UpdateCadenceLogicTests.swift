//
//  UpdateCadenceLogicTests.swift
//  Notch Apple
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

    // The reminder counter (every 4th or 5th notch open while an update waits).
    func testTheReminderComesOnTheFourthOpenAndTheCountStartsAgain() {
        var opens = 0
        for _ in 0..<3 { let r = UpdateCadenceLogic.reminderStep(opens: opens, every: 4, updateWaiting: true, mayAnnounce: true, alreadyShowing: false); XCTAssertFalse(r.fire); opens = r.opens }
        let fourth = UpdateCadenceLogic.reminderStep(opens: opens, every: 4, updateWaiting: true, mayAnnounce: true, alreadyShowing: false)
        XCTAssertTrue(fourth.fire)
        XCTAssertEqual(fourth.opens, 0, "after a reminder the count starts again, so quitting does not bring it straight back")
        // The next launch: one open is not enough to remind again.
        XCTAssertFalse(UpdateCadenceLogic.reminderStep(opens: fourth.opens, every: 4, updateWaiting: true, mayAnnounce: true, alreadyShowing: false).fire)
    }

    func testNoUpdateWaitingClearsTheCount() {
        let r = UpdateCadenceLogic.reminderStep(opens: 7, every: 4, updateWaiting: false, mayAnnounce: true, alreadyShowing: false)
        XCTAssertEqual(r, UpdateCadenceLogic.ReminderStep(opens: 0, fire: false), "after updating, an old count must not remind about the next release at once")
    }

    func testAReminderAlreadyOnScreenOrHeldBackDoesNotCount() {
        XCTAssertEqual(UpdateCadenceLogic.reminderStep(opens: 2, every: 4, updateWaiting: true, mayAnnounce: true, alreadyShowing: true).opens, 2)
        XCTAssertEqual(UpdateCadenceLogic.reminderStep(opens: 2, every: 4, updateWaiting: true, mayAnnounce: false, alreadyShowing: false).opens, 2)
    }
}
