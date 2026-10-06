//
//  LidAngleProviding.swift
//  Notch apple, Lid Fold
//
//  Original to Notch apple. How a lid-angle reading reaches the rest of the app, so the real sensor
//  (IOKit, in the app target) and a scripted mock are interchangeable. Macs without the sensor
//  (M1 Air, 13" MacBook Pro) deliver `LidReading(angle: nil, ...)` and everything else keeps working.
//

import Foundation

public struct LidReading: Equatable, Sendable {
    /// Degrees (0 closed ... about 135 open), or nil when there is no usable reading.
    public let angle: Double?
    /// A short, plain-English status for the settings screen.
    public let message: String
    public init(angle: Double?, message: String) { self.angle = angle; self.message = message }
}

public protocol LidAngleProviding: AnyObject {
    /// Starts delivering readings to `handler` (from any thread). Calling again replaces the handler.
    func start(_ handler: @escaping @Sendable (LidReading) -> Void)
    /// Stops the sensor and releases every resource. Idempotent.
    func stop()
}

/// A scripted sensor for tests and for trying the feature on a Mac that has none.
public final class MockLidAngleProvider: LidAngleProviding, @unchecked Sendable {
    public private(set) var isStarted = false
    private var handler: (@Sendable (LidReading) -> Void)?
    private let lock = NSLock()
    private let hasSensor: Bool

    /// `hasSensor: false` behaves like a Mac without the sensor: start() reports "no sensor" once.
    public init(hasSensor: Bool = true) { self.hasSensor = hasSensor }

    public func start(_ handler: @escaping @Sendable (LidReading) -> Void) {
        lock.lock(); isStarted = true; self.handler = handler; lock.unlock()
        if !hasSensor { handler(LidReading(angle: nil, message: "No readable lid-angle sensor on this Mac.")) }
    }

    public func stop() {
        lock.lock(); isStarted = false; handler = nil; lock.unlock()
    }

    /// Delivers one reading, as the real sensor would.
    public func send(_ angle: Double?, message: String = "Mock lid sensor") {
        lock.lock(); let h = handler; lock.unlock()
        h?(LidReading(angle: angle, message: message))
    }

    public func play(_ angles: [Double]) { for a in angles { send(a) } }
}
