import XCTest
@testable import FoldCore

final class LidAngleProvidingTests: XCTestCase {
    func testMockDeliversReadingsOnlyWhileStarted() {
        let sensor = MockLidAngleProvider()
        var seen: [Double?] = []
        sensor.send(100)                                   // not started: ignored
        sensor.start { seen.append($0.angle) }
        sensor.play([100, 80, 60])
        sensor.stop()
        sensor.send(10)                                    // stopped: ignored
        XCTAssertEqual(seen.count, 3)
        XCTAssertEqual(seen.compactMap { $0 }, [100, 80, 60])
        XCTAssertFalse(sensor.isStarted)
    }

    func testMacWithoutSensorReportsNoAngleAndNeverCrashes() {
        let sensor = MockLidAngleProvider(hasSensor: false)
        var readings: [LidReading] = []
        sensor.start { readings.append($0) }
        XCTAssertEqual(readings.count, 1)
        XCTAssertNil(readings[0].angle)
        XCTAssertTrue(readings[0].message.contains("No readable"))
    }

    func testRestartReplacesTheHandler() {
        let sensor = MockLidAngleProvider()
        var first = 0, second = 0
        sensor.start { _ in first += 1 }
        sensor.start { _ in second += 1 }
        sensor.send(90)
        XCTAssertEqual(first, 0)
        XCTAssertEqual(second, 1)
    }
}
