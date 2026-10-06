import XCTest
@testable import FoldCore

final class FoldSessionTests: XCTestCase {
    func testEveryNonLidTriggerHasAHardCeiling() {
        for t in FoldTrigger.allCases where t != .lid {
            let limit = FoldFailSafe.maxDuration(t)
            XCTAssertNotNil(limit, "\(t) must end by itself")
            XCTAssertLessThanOrEqual(limit ?? 999, 30)
        }
        XCTAssertNil(FoldFailSafe.maxDuration(.lid))
    }

    func testMaxDurationTearsDown() {
        XCTAssertNil(FoldFailSafe.check(trigger: .preview, elapsed: 5.9, sensorAge: nil, angle: nil))
        XCTAssertEqual(FoldFailSafe.check(trigger: .preview, elapsed: 6, sensorAge: nil, angle: nil), .maxDuration)
        XCTAssertEqual(FoldFailSafe.check(trigger: .demo, elapsed: 12, sensorAge: nil, angle: nil), .maxDuration)
        XCTAssertEqual(FoldFailSafe.check(trigger: .hotkey, elapsed: 30, sensorAge: nil, angle: nil), .maxDuration)
    }

    func testBadClockTearsDown() {
        XCTAssertEqual(FoldFailSafe.check(trigger: .hotkey, elapsed: .nan, sensorAge: nil, angle: nil), .unknown)
        XCTAssertEqual(FoldFailSafe.check(trigger: .hotkey, elapsed: -1, sensorAge: nil, angle: nil), .unknown)
    }

    func testLidTriggerNeedsAFreshValidAngle() {
        XCTAssertNil(FoldFailSafe.check(trigger: .lid, elapsed: 500, sensorAge: 0.1, angle: 60), "no ceiling for the lid")
        XCTAssertEqual(FoldFailSafe.check(trigger: .lid, elapsed: 1, sensorAge: 0.6, angle: 60), .sensorStale)
        XCTAssertEqual(FoldFailSafe.check(trigger: .lid, elapsed: 1, sensorAge: nil, angle: 60), .sensorStale)
        XCTAssertEqual(FoldFailSafe.check(trigger: .lid, elapsed: 1, sensorAge: 0.1, angle: nil), .sensorInvalid)
        XCTAssertEqual(FoldFailSafe.check(trigger: .lid, elapsed: 1, sensorAge: 0.1, angle: .nan), .sensorInvalid)
        XCTAssertEqual(FoldFailSafe.check(trigger: .lid, elapsed: 1, sensorAge: 0.1, angle: 400), .sensorInvalid)
    }

    func testPreviewCurveGoesDownAndBackThenEnds() throws {
        let start = try XCTUnwrap(FoldCurves.previewAngle(elapsed: 0, working: 105))
        let mid = try XCTUnwrap(FoldCurves.previewAngle(elapsed: 2, working: 105))
        let late = try XCTUnwrap(FoldCurves.previewAngle(elapsed: 3.99, working: 105))
        XCTAssertEqual(start, 105, accuracy: 1e-9)
        XCTAssertEqual(mid, 30, accuracy: 1e-9)
        XCTAssertGreaterThan(late, 100)
        XCTAssertNil(FoldCurves.previewAngle(elapsed: 4, working: 105))
        XCTAssertNil(FoldCurves.previewAngle(elapsed: -1, working: 105))
        XCTAssertNil(FoldCurves.previewAngle(elapsed: .nan, working: 105))
    }

    func testHeldCurveEasesThenHolds() {
        XCTAssertEqual(FoldCurves.heldAngle(elapsed: 0, working: 105, resting: 30), 105, accuracy: 1e-9)
        let partway = FoldCurves.heldAngle(elapsed: 1, working: 105, resting: 30)
        XCTAssertLessThan(partway, 105)
        XCTAssertGreaterThan(partway, 30)
        XCTAssertEqual(FoldCurves.heldAngle(elapsed: 2.5, working: 105, resting: 30), 30, accuracy: 1e-9)
        XCTAssertEqual(FoldCurves.heldAngle(elapsed: 999, working: 105, resting: 30), 30, accuracy: 1e-9)
        XCTAssertEqual(FoldCurves.heldAngle(elapsed: .nan, working: 105, resting: 30), 105, accuracy: 1e-9)
    }

    func testProgressMapsToAngleWithinTuning() {
        let t = FoldTuning()
        XCTAssertEqual(FoldCurves.angle(forProgress: 0, tuning: t), t.validated.workingAngle, accuracy: 1e-9)
        XCTAssertEqual(FoldCurves.angle(forProgress: 1, tuning: t), t.validated.fadeAngle, accuracy: 1e-9)
        XCTAssertEqual(FoldCurves.angle(forProgress: 7, tuning: t), t.validated.fadeAngle, accuracy: 1e-9)
        XCTAssertEqual(FoldCurves.angle(forProgress: .nan, tuning: t), t.validated.workingAngle, accuracy: 1e-9)
    }
}
