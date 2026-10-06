//
//  IOKitLidAngleProvider.swift
//  Notch apple, Lid Fold
//
//  Origin:  Still, native/Sources/Still/LidSensor.swift
//           https://github.com/kavishshahh (project: Still)
//           (MIT, Copyright (c) 2026 Akshay Sharma and Kavish Shah; LICENSES/Still-MIT.txt)
//           which in turn follows the sensor discovery and report layout of
//           Sam Henri Gold's LidAngleSensor, https://github.com/samhenrigold/LidAngleSensor
//           (Apache License 2.0; LICENSES/LidAngleSensor-Apache-2.0.txt, notice in LICENSES/NOTICE.md)
//  Changes: MODIFIED REWRITE. Conforms to `LidAngleProviding` (FoldCore) instead of a main-actor
//           closure; readings arrive on the sensor queue, not the main thread; the app-specific model
//           lookup and logger names are gone; messages reworded; the sensor only runs between start()
//           and stop(), so it costs nothing while Lid Fold's "Follow the lid" is off.
//

import Foundation
import IOKit.hid
import FoldCore

final class IOKitLidAngleProvider: LidAngleProviding, @unchecked Sendable {
    private static let noOptions = IOOptionBits(kIOHIDOptionsTypeNone)
    private static let pollInterval: DispatchTimeInterval = .milliseconds(33)
    private static let failureLimit = 5
    private static let retryDelay: DispatchTimeInterval = .seconds(2)

    /// All HID state lives on this one queue.
    private let queue = DispatchQueue(label: "com.notchapple.lidfold.sensor", qos: .userInitiated)
    private var handler: (@Sendable (LidReading) -> Void)?
    private var timer: DispatchSourceTimer?
    private var device: IOHIDDevice?
    private var failures = 0

    deinit {
        timer?.cancel()
        if let device { IOHIDDeviceClose(device, Self.noOptions) }
    }

    func start(_ handler: @escaping @Sendable (LidReading) -> Void) {
        queue.async { [self] in
            self.handler = handler
            startOnQueue()
        }
    }

    func stop() {
        queue.async { [self] in
            handler = nil
            stopOnQueue()
        }
    }

    private func startOnQueue() {
        stopOnQueue()
        switch Self.probe() {
        case .readable(let candidate):
            guard IOHIDDeviceOpen(candidate, Self.noOptions) == kIOReturnSuccess else {
                publish(nil, "The lid sensor was found but could not be opened.")
                return
            }
            device = candidate
            let clock = DispatchSource.makeTimerSource(queue: queue)
            clock.schedule(deadline: .now(), repeating: Self.pollInterval, leeway: .milliseconds(3))
            clock.setEventHandler { [weak self] in self?.poll() }
            timer = clock
            clock.resume()
        case .vendorSpecificOnly:
            publish(nil, "This Mac has lid-sensor hardware, but it is not readable through the interface Lid Fold uses.")
        case .notFound:
            publish(nil, "No readable lid-angle sensor on this Mac.")
        }
    }

    private func stopOnQueue() {
        timer?.cancel()
        timer = nil
        if let device { IOHIDDeviceClose(device, Self.noOptions) }
        device = nil
        failures = 0
    }

    // MARK: Discovery

    private enum ProbeResult {
        case readable(IOHIDDevice)
        case vendorSpecificOnly
        case notFound
    }

    private static func probe() -> ProbeResult {
        // Apple product 0x8104 on the standard Sensor usage page (0x0020), Orientation usage (0x008A).
        // Three spellings of the same match; they are OR-ed.
        let standard: [[String: Any]] = [
            [kIOHIDVendorIDKey as String: 0x05AC, kIOHIDProductIDKey as String: 0x8104,
             "UsagePage": 0x0020, "Usage": 0x008A],
            [kIOHIDVendorIDKey as String: 0x05AC, kIOHIDProductIDKey as String: 0x8104,
             kIOHIDPrimaryUsagePageKey as String: 0x0020, kIOHIDPrimaryUsageKey as String: 0x008A],
            [kIOHIDVendorIDKey as String: 0x05AC,
             kIOHIDDeviceUsagePageKey as String: 0x0020, kIOHIDDeviceUsageKey as String: 0x008A]
        ]
        for candidate in devices(matching: standard) {
            guard IOHIDDeviceOpen(candidate, noOptions) == kIOReturnSuccess else { continue }
            let angle = read(candidate)
            IOHIDDeviceClose(candidate, noOptions)
            if angle != nil { return .readable(candidate) }
        }
        let vendor: [[String: Any]] = [[kIOHIDVendorIDKey as String: 0x05AC, kIOHIDProductIDKey as String: 0x8104]]
        if !devices(matching: vendor).isEmpty { return .vendorSpecificOnly }
        return .notFound
    }

    private static func devices(matching dictionaries: [[String: Any]]) -> [IOHIDDevice] {
        let manager = IOHIDManagerCreate(kCFAllocatorDefault, noOptions)
        IOHIDManagerSetDeviceMatchingMultiple(manager, dictionaries as CFArray)
        guard IOHIDManagerOpen(manager, noOptions) == kIOReturnSuccess else { return [] }
        defer { IOHIDManagerClose(manager, noOptions) }
        let found = IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice> ?? []
        return Array(found)
    }

    // MARK: Reading

    /// Feature report 1: byte 0 is the report ID, bytes 1 and 2 the angle in degrees (little-endian).
    private static func read(_ device: IOHIDDevice) -> Double? {
        var bytes = [UInt8](repeating: 0, count: 8)
        var count = CFIndex(bytes.count)
        let result = IOHIDDeviceGetReport(device, kIOHIDReportTypeFeature, 1, &bytes, &count)
        guard result == kIOReturnSuccess, count >= 3 else { return nil }
        let degrees = Double(UInt16(bytes[2]) << 8 | UInt16(bytes[1]))
        // A lid cannot be open past flat; anything larger is a garbage report.
        guard (0...200).contains(degrees) else { return nil }
        return degrees
    }

    private func poll() {
        guard let device else { return }
        guard let angle = Self.read(device) else {
            failures += 1
            if failures == Self.failureLimit {
                // Reads fail for reasons that pass on their own (another process holding the device, a
                // sleep/wake transition), so look again instead of giving up for good.
                publish(nil, "Lid sensor interrupted. Reconnecting…")
                stopOnQueue()
                queue.asyncAfter(deadline: .now() + Self.retryDelay) { [weak self] in
                    guard let self, self.handler != nil else { return }
                    self.startOnQueue()
                }
            }
            return
        }
        failures = 0
        publish(angle, "Lid sensor available")
    }

    private func publish(_ angle: Double?, _ message: String) {
        handler?(LidReading(angle: angle, message: message))
    }
}
