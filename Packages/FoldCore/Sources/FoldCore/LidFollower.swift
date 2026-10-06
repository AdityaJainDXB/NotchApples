//
//  LidFollower.swift
//  Notch apple, Lid Fold
//
//  Original to Notch apple (uses Still's GestureGate and FoldMath.smooth). Turns a stream of lid angles
//  into "what should the overlay do now", with no UI in it, so it can be tested with a mock sensor.
//  Replaces the sensor/gate/timer logic that sat in Still's AppModel.
//

import Foundation

public struct LidFollower {
    public enum Action: Equatable {
        case requestCapture              // start a snapshot: the lid has started to close
        case update(angle: Double)       // move the overlay to this (smoothed) angle
        case teardown(FoldTeardownReason)
    }

    public private(set) var gate = GestureGate()
    public private(set) var smoothed: Double?
    private var latest: Double?
    private var lastReading: TimeInterval?
    private var lastTick: TimeInterval?
    private var captureInFlight = false

    public init() {}

    public var isActive: Bool { gate.state == .active }

    /// Feed every sensor reading here.
    public mutating func ingest(angle: Double?, now: TimeInterval, tuning: FoldTuning) -> [Action] {
        guard let angle, angle.isFinite, (0...200).contains(angle) else {
            let wasShowing = gate.state == .active || captureInFlight
            gate.fail()
            captureInFlight = false
            latest = nil
            return wasShowing ? [.teardown(.sensorInvalid)] : []
        }
        latest = angle
        lastReading = now
        let before = gate.state
        let state = gate.update(angle: angle, workingAngle: tuning.validated.workingAngle)
        if state == .idle && (before == .active || before == .captureRequested) {
            captureInFlight = false
            return [.teardown(.lidReopened)]
        }
        if state == .captureRequested && !captureInFlight {
            captureInFlight = true
            return [.requestCapture]
        }
        return []
    }

    /// The snapshot finished and the overlay is up.
    public mutating func captureSucceeded(now: TimeInterval, tuning: FoldTuning) -> [Action] {
        captureInFlight = false
        gate.captured()
        guard gate.state == .active else { return [.teardown(.lidReopened)] }   // reopened while capturing
        smoothed = latest ?? tuning.validated.workingAngle
        lastTick = now
        return [.update(angle: smoothed!)]
    }

    /// The snapshot failed: stay clear until the lid is reopened and closed again.
    public mutating func captureFailed() -> [Action] {
        captureInFlight = false
        gate.fail()
        return [.teardown(.captureFailed)]
    }

    /// Call about 60 times a second while active.
    public mutating func tick(now: TimeInterval, tuning: FoldTuning) -> [Action] {
        guard gate.state == .active, let current = smoothed else { return [] }
        let age = lastReading.map { now - $0 }
        if let reason = FoldFailSafe.check(trigger: .lid, elapsed: 0, sensorAge: age, angle: latest) {
            gate.fail()
            return [.teardown(reason)]
        }
        let dt = lastTick.map { now - $0 } ?? 0
        lastTick = now
        let next = FoldMath.smooth(current: current, target: latest ?? current, dt: dt, response: tuning.validated.response)
        guard abs(next - current) > 0.01 else { return [] }
        smoothed = next
        return [.update(angle: next)]
    }

    public mutating func reset() {
        gate.reset()
        smoothed = nil; latest = nil; lastReading = nil; lastTick = nil; captureInFlight = false
    }
}
