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
