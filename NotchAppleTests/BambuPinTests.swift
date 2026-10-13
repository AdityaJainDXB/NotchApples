import XCTest

final class BambuPinTests: XCTestCase {
    func testFirstCertificateIsRemembered() {
        XCTAssertEqual(BambuStatusLogic.decidePin(stored: nil, seen: "ab"), .pinFirst)
        XCTAssertEqual(BambuStatusLogic.decidePin(stored: "", seen: "ab"), .pinFirst)
    }
    func testSameCertificateMatchesWhateverTheCase() {
        XCTAssertEqual(BambuStatusLogic.decidePin(stored: "ABCD", seen: "abcd"), .match)
    }
    func testADifferentCertificateIsRefused() {
        XCTAssertEqual(BambuStatusLogic.decidePin(stored: "abcd", seen: "abce"), .mismatch)
    }
    func testFingerprintIsSha256Hex() {
        XCTAssertEqual(BambuStatusLogic.fingerprint(of: Data("abc".utf8)),
                       "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }
}

final class BambuAlertTests: XCTestCase {
    private func snap(_ state: String, phase: BambuPhase, nozzle: Double? = nil, target: Double? = nil, bed: Double? = nil, bedTarget: Double? = nil) -> BambuSnapshot {
        var s = BambuSnapshot(); s.gcodeState = state; s.phase = phase; s.nozzleC = nozzle; s.nozzleTargetC = target; s.bedC = bed; s.bedTargetC = bedTarget; return s
    }
    func testPauseAndFinishAreEvents() {
        XCTAssertEqual(BambuStatusLogic.event(from: snap("RUNNING", phase: .printing), to: snap("PAUSE", phase: .paused)), .paused)
        XCTAssertEqual(BambuStatusLogic.event(from: snap("RUNNING", phase: .printing), to: snap("FINISH", phase: .idle)), .finished)
        XCTAssertEqual(BambuStatusLogic.event(from: snap("RUNNING", phase: .printing), to: snap("FAILED", phase: .idle)), .failed)
    }
    func testNoEventWithoutAChangeOrFromOffline() {
        XCTAssertNil(BambuStatusLogic.event(from: snap("RUNNING", phase: .printing), to: snap("RUNNING", phase: .printing)))
        XCTAssertNil(BambuStatusLogic.event(from: snap("", phase: .offline), to: snap("PAUSE", phase: .paused)))
        XCTAssertNil(BambuStatusLogic.event(from: snap("FINISH", phase: .idle), to: snap("FINISH", phase: .idle)))
        XCTAssertNil(BambuStatusLogic.event(from: nil, to: snap("FINISH", phase: .idle)))
    }
    func testOverTheLimitAndOvershoot() {
        XCTAssertEqual(BambuStatusLogic.thermalAlert(previous: nil, current: snap("RUNNING", phase: .printing, nozzle: 305)), .nozzleHot(305))
        XCTAssertEqual(BambuStatusLogic.thermalAlert(previous: nil, current: snap("RUNNING", phase: .printing, bed: 115)), .bedHot(115))
        XCTAssertEqual(BambuStatusLogic.thermalAlert(previous: nil, current: snap("RUNNING", phase: .printing, nozzle: 240, target: 220)), .nozzleOvershoot(20))
        XCTAssertNil(BambuStatusLogic.thermalAlert(previous: nil, current: snap("RUNNING", phase: .printing, nozzle: 225, target: 220, bed: 62, bedTarget: 60)))
    }
    func testHeatCreepNeedsARisingHotendWithTheHeaterOff() {
        let before = snap("FINISH", phase: .idle, nozzle: 80, target: 0)
        XCTAssertEqual(BambuStatusLogic.thermalAlert(previous: before, current: snap("FINISH", phase: .idle, nozzle: 83, target: 0)), .heatCreep(83))
        XCTAssertNil(BambuStatusLogic.thermalAlert(previous: before, current: snap("FINISH", phase: .idle, nozzle: 76, target: 0)))
        XCTAssertNil(BambuStatusLogic.thermalAlert(previous: snap("FINISH", phase: .idle, nozzle: 30, target: 0), current: snap("FINISH", phase: .idle, nozzle: 33, target: 0)))
        XCTAssertNil(BambuStatusLogic.thermalAlert(previous: before, current: snap("RUNNING", phase: .printing, nozzle: 90, target: 220)))
    }
    func testNothingWhileOffline() {
        XCTAssertNil(BambuStatusLogic.thermalAlert(previous: nil, current: snap("", phase: .offline, nozzle: 400)))
    }
}
