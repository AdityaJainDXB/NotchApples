import XCTest
@testable import FoldCore

final class LidFollowerTests: XCTestCase {
    private let tuning = FoldTuning()   // working angle 105

    func testRestingOpenDoesNothing() {
        var f = LidFollower()
        XCTAssertEqual(f.ingest(angle: 105, now: 0, tuning: tuning), [])
        XCTAssertEqual(f.ingest(angle: 104, now: 0.03, tuning: tuning), [])
    }

    func testClosingRequestsOneCaptureAndThenFollows() {
        var f = LidFollower()
        _ = f.ingest(angle: 105, now: 0, tuning: tuning)
        XCTAssertEqual(f.ingest(angle: 95, now: 0.1, tuning: tuning), [.requestCapture])
        XCTAssertEqual(f.ingest(angle: 90, now: 0.13, tuning: tuning), [], "no second capture while one is in flight")
        XCTAssertEqual(f.captureSucceeded(now: 0.2, tuning: tuning), [.update(angle: 90)])
        XCTAssertTrue(f.isActive)
        _ = f.ingest(angle: 60, now: 0.25, tuning: tuning)
        let actions = f.tick(now: 0.27, tuning: tuning)
        guard case .update(let a)? = actions.first else { return XCTFail("expected an update") }
        XCTAssertLessThan(a, 90)
        XCTAssertGreaterThan(a, 60)
    }

    func testReopeningTearsDown() {
        var f = LidFollower()
        _ = f.ingest(angle: 95, now: 0, tuning: tuning)
        _ = f.captureSucceeded(now: 0.1, tuning: tuning)
        XCTAssertEqual(f.ingest(angle: 105, now: 0.2, tuning: tuning), [.teardown(.lidReopened)])
        XCTAssertFalse(f.isActive)
    }

    func testReopeningWhileCapturingTearsDownWhenCaptureLands() {
        var f = LidFollower()
        _ = f.ingest(angle: 95, now: 0, tuning: tuning)                       // capture requested
        XCTAssertEqual(f.ingest(angle: 105, now: 0.05, tuning: tuning), [.teardown(.lidReopened)])
        XCTAssertEqual(f.captureSucceeded(now: 0.1, tuning: tuning), [.teardown(.lidReopened)],
                       "a late snapshot must not bring the overlay up for an open lid")
        XCTAssertFalse(f.isActive)
    }

    func testStaleSensorTearsDownAndStaysDownUntilReopened() {
        var f = LidFollower()
        _ = f.ingest(angle: 95, now: 0, tuning: tuning)
        _ = f.captureSucceeded(now: 0.1, tuning: tuning)
        XCTAssertEqual(f.tick(now: 0.9, tuning: tuning), [.teardown(.sensorStale)])
        XCTAssertEqual(f.tick(now: 1.0, tuning: tuning), [])
        XCTAssertEqual(f.ingest(angle: 60, now: 1.1, tuning: tuning), [], "suppressed until the lid is reopened")
        _ = f.ingest(angle: 105, now: 1.2, tuning: tuning)
        XCTAssertEqual(f.ingest(angle: 95, now: 1.3, tuning: tuning), [.requestCapture])
    }

    func testInvalidReadingWhileShowingTearsDown() {
        var f = LidFollower()
        _ = f.ingest(angle: 95, now: 0, tuning: tuning)
        _ = f.captureSucceeded(now: 0.1, tuning: tuning)
        XCTAssertEqual(f.ingest(angle: nil, now: 0.2, tuning: tuning), [.teardown(.sensorInvalid)])
        XCTAssertEqual(f.ingest(angle: 999, now: 0.3, tuning: tuning), [])
    }

    func testCaptureFailureSuppressesTheGesture() {
        var f = LidFollower()
        _ = f.ingest(angle: 95, now: 0, tuning: tuning)
        XCTAssertEqual(f.captureFailed(), [.teardown(.captureFailed)])
        XCTAssertEqual(f.ingest(angle: 60, now: 0.1, tuning: tuning), [])
    }

    func testNoSensorMacNeverStartsAnything() {
        var f = LidFollower()
        XCTAssertEqual(f.ingest(angle: nil, now: 0, tuning: tuning), [])
        XCTAssertEqual(f.tick(now: 1, tuning: tuning), [])
        XCTAssertFalse(f.isActive)
    }

    func testMockSensorDrivesAFullCloseAndReopen() {
        let sensor = MockLidAngleProvider()
        var f = LidFollower()
        var log: [LidFollower.Action] = []
        var clock = 0.0
        sensor.start { r in
            clock += 0.03
            log += f.ingest(angle: r.angle, now: clock, tuning: self.tuning)
        }
        sensor.play([105, 100, 95])
        XCTAssertEqual(log, [.requestCapture])
        log += f.captureSucceeded(now: clock, tuning: tuning)
        sensor.play([80, 50, 105])
        XCTAssertEqual(log.last, .teardown(.lidReopened))
    }
}
