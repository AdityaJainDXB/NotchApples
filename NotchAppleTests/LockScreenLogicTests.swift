import XCTest

final class LockScreenLogicTests: XCTestCase {
    func testShowsOnlyWhenOnLockedAndPlaying() {
        XCTAssertTrue(LockScreenLogic.shouldShow(enabled: true, locked: true, hasTrack: true))
        XCTAssertFalse(LockScreenLogic.shouldShow(enabled: false, locked: true, hasTrack: true), "off by default")
        XCTAssertFalse(LockScreenLogic.shouldShow(enabled: true, locked: false, hasTrack: true), "only while locked")
        XCTAssertFalse(LockScreenLogic.shouldShow(enabled: true, locked: true, hasTrack: false), "nothing playing")
    }
}
