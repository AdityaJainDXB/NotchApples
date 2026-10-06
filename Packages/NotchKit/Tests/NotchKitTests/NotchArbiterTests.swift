import XCTest
@testable import NotchKit

@MainActor
private final class Probe: NotchClaimant {
    var preempted: [NotchPriority] = []
    var available = 0
    func notchPreempted(by priority: NotchPriority) { preempted.append(priority) }
    func notchAvailable() { available += 1 }
}

@MainActor
final class NotchArbiterTests: XCTestCase {
    func testFreeNotchIsGranted() {
        let a = NotchArbiter(), p = Probe()
        XCTAssertNotNil(a.request(.cleaning, owner: p))
        XCTAssertEqual(a.current, .cleaning)
    }

    func testLidFoldPreemptsCleaningThenCleaningResumes() {
        let a = NotchArbiter(), clean = Probe(), fold = Probe()
        let c = a.request(.cleaning, owner: clean)!
        let f = a.request(.lidFold, owner: fold)
        XCTAssertNotNil(f)
        XCTAssertEqual(clean.preempted, [.lidFold])
        XCTAssertFalse(a.holds(c))
        a.release(f!)
        XCTAssertEqual(clean.available, 1)
        XCTAssertEqual(a.current, .cleaning)
    }

    func testBadgeIsDroppedWhileHigherPriorityHoldsTheNotch() {
        let a = NotchArbiter(), fold = Probe(), badge = Probe()
        _ = a.request(.lidFold, owner: fold)
        XCTAssertNil(a.request(.badge, owner: badge))
        XCTAssertEqual(badge.available, 0)
    }

    func testCleaningIsQueuedBehindLidFold() {
        let a = NotchArbiter(), fold = Probe(), clean = Probe()
        let f = a.request(.lidFold, owner: fold)!
        XCTAssertNil(a.request(.cleaning, owner: clean))
        a.release(f)
        XCTAssertEqual(clean.available, 1)
        XCTAssertEqual(a.current, .cleaning)
    }

    func testBadgeNeverPreemptsCleaning() {
        let a = NotchArbiter(), clean = Probe(), badge = Probe()
        _ = a.request(.cleaning, owner: clean)
        XCTAssertNil(a.request(.badge, owner: badge))
        XCTAssertTrue(clean.preempted.isEmpty)
    }

    func testReleasingAQueuedClaimRemovesItFromTheQueue() {
        let a = NotchArbiter(), fold = Probe(), clean = Probe()
        let f = a.request(.lidFold, owner: fold)!
        _ = a.request(.cleaning, owner: clean)
        a.release(f)                       // clean takes over
        XCTAssertEqual(a.current, .cleaning)
    }

    func testDeallocatedWaiterIsSkipped() {
        let a = NotchArbiter(), fold = Probe()
        let f = a.request(.lidFold, owner: fold)!
        do { let gone = Probe(); _ = a.request(.cleaning, owner: gone) }
        a.release(f)
        XCTAssertNil(a.current)
    }

    func testPermissionLinksAndLimitedMode() {
        XCTAssertTrue(ModulePermission.screenRecording.settingsURL.absoluteString.hasSuffix("Privacy_ScreenCapture"))
        XCTAssertTrue(ModulePermission.fullDiskAccess.settingsURL.absoluteString.hasSuffix("Privacy_AllFiles"))
        XCTAssertTrue(PermissionStatus.denied.isLimited)
        XCTAssertTrue(PermissionStatus.notDetermined.isLimited)
        XCTAssertFalse(PermissionStatus.granted.isLimited)
    }
}

/// Behaves the way the Cleaner must: when the notch is taken it finishes the item it is moving to the
/// Trash (never stops halfway through one), then idles; when the notch is free again it carries on.
@MainActor
private final class CleaningDouble: NotchClaimant {
    enum State: Equatable { case idle, movingItem, pausedBetweenItems, resumed, finished }
    var state: State = .idle
    var pauseRequested = false
    var itemsMoved = 0

    func beginItem() { state = .movingItem }
    func finishItem() {
        itemsMoved += 1
        if pauseRequested { state = .pausedBetweenItems; pauseRequested = false } else { state = .idle }
    }
    func notchPreempted(by priority: NotchPriority) {
        if state == .movingItem { pauseRequested = true } else { state = .pausedBetweenItems }
    }
    func notchAvailable() { state = .resumed }
}

@MainActor
final class NotchArbiterMidCleaningTests: XCTestCase {
    func testLidFoldMidItemLetsTheItemFinishThenPauses() {
        let a = NotchArbiter(), clean = CleaningDouble(), fold = Probe()
        _ = a.request(.cleaning, owner: clean)
        clean.beginItem()
        let f = a.request(.lidFold, owner: fold)
        XCTAssertNotNil(f)
        XCTAssertEqual(clean.state, .movingItem, "the arbiter never interrupts an item")
        XCTAssertTrue(clean.pauseRequested)
        clean.finishItem()
        XCTAssertEqual(clean.state, .pausedBetweenItems)
        XCTAssertEqual(clean.itemsMoved, 1)
        a.release(f!)
        XCTAssertEqual(clean.state, .resumed)
        XCTAssertEqual(a.current, .cleaning)
    }

    func testLidFoldBetweenItemsPausesAtOnce() {
        let a = NotchArbiter(), clean = CleaningDouble(), fold = Probe()
        _ = a.request(.cleaning, owner: clean)
        let f = a.request(.lidFold, owner: fold)!
        XCTAssertEqual(clean.state, .pausedBetweenItems)
        a.release(f)
        XCTAssertEqual(clean.state, .resumed)
    }

    func testCleaningThatFinishesWhilePausedIsNotResumedLater() {
        let a = NotchArbiter(), clean = CleaningDouble(), fold = Probe()
        let c = a.request(.cleaning, owner: clean)!
        let f = a.request(.lidFold, owner: fold)!
        a.release(c)                                   // the cleaner gives up while the fold is showing
        a.release(f)
        XCTAssertNil(a.current)
        XCTAssertEqual(clean.state, .pausedBetweenItems, "nothing may restart a cleaner that already ended")
    }

    func testASecondLidFoldWhileOneIsShowingIsRefused() {
        let a = NotchArbiter(), fold1 = Probe(), fold2 = Probe()
        let f = a.request(.lidFold, owner: fold1)!
        XCTAssertNil(a.request(.lidFold, owner: fold2))
        a.release(f)
        XCTAssertNil(a.current)
        XCTAssertEqual(fold2.available, 0)
    }

    func testRepeatedFoldsDuringOneCleaningResumeItEachTime() {
        let a = NotchArbiter(), clean = CleaningDouble(), fold = Probe()
        _ = a.request(.cleaning, owner: clean)
        for _ in 0..<3 {
            let f = a.request(.lidFold, owner: fold)!
            a.release(f)
            XCTAssertEqual(clean.state, .resumed)
            XCTAssertEqual(a.current, .cleaning)
        }
    }
}
