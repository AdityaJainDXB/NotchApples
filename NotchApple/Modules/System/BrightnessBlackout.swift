//
//  BrightnessBlackout.swift
//  Notch apple
//
//  Press ⌥A to take the built-in display's brightness to zero, press it again to bring it back to where it was.
//  An event tap sees the key (so the "å" it would type is swallowed); it needs Accessibility, the same
//  permission the volume and brightness gauge uses. The level to return to is saved, so quitting the app
//  or relaunching while the screen is dark still brings it back.
//

import AppKit

final class BrightnessBlackout {
    static let shared = BrightnessBlackout()

    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private let savedKey = "brightnessBlackout.savedLevel"

    private typealias GetBrightness = @convention(c) (UInt32, UnsafeMutablePointer<Float>) -> Int32
    private typealias SetBrightness = @convention(c) (UInt32, Float) -> Int32
    private let displayServices = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_LAZY)
    private lazy var getBrightness: GetBrightness? = displayServices.flatMap { dlsym($0, "DisplayServicesGetBrightness") }
        .map { unsafeBitCast($0, to: GetBrightness.self) }
    private lazy var setBrightness: SetBrightness? = displayServices.flatMap { dlsym($0, "DisplayServicesSetBrightness") }
        .map { unsafeBitCast($0, to: SetBrightness.self) }

    var isRunning: Bool { tap != nil }
    var isDark: Bool { UserDefaults.standard.object(forKey: savedKey) != nil }

    @discardableResult
    func setEnabled(_ enabled: Bool) -> Bool {
        if !enabled { stop(); restore(); return true }
        guard tap == nil else { return true }
        guard AXIsProcessTrusted() else { return false }
        let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
                                          eventsOfInterest: mask, callback: { _, type, event, info in
            guard let info else { return Unmanaged.passUnretained(event) }
            let me = Unmanaged<BrightnessBlackout>.fromOpaque(info).takeUnretainedValue()
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                if let tap = me.tap { CGEvent.tapEnable(tap: tap, enable: true) }
                return Unmanaged.passUnretained(event)
            }
            guard type == .keyDown, Self.isOptionA(event) else { return Unmanaged.passUnretained(event) }
            if event.getIntegerValueField(.keyboardEventAutorepeat) == 0 {
                DispatchQueue.main.async { me.toggle() }
            }
            return nil
        }, userInfo: Unmanaged.passUnretained(self).toOpaque()) else { return false }
        self.tap = tap
        source = CFMachPortCreateRunLoopSource(nil, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return true
    }

    func stop() {
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        tap = nil
        source = nil
    }

    /// Exactly ⌥A: key code 0 (the A key) with Option and no other modifier.
    private static func isOptionA(_ event: CGEvent) -> Bool {
        guard event.getIntegerValueField(.keyboardEventKeycode) == 0 else { return false }
        let f = event.flags
        return f.contains(.maskAlternate) && !f.contains(.maskCommand) && !f.contains(.maskControl) && !f.contains(.maskShift)
    }

    func toggle() {
        isDark ? restore() : goDark()
    }

    private func goDark() {
        guard let getBrightness, let setBrightness else { return }
        let display = CGMainDisplayID()
        var value: Float = 0
        guard getBrightness(display, &value) == 0 else { return }
        // Never save "already dark" as the level to come back to.
        UserDefaults.standard.set(max(value, 0.25), forKey: savedKey)
        _ = setBrightness(display, 0)
    }

    /// Brings the brightness back to the saved level (also called on quit and when the feature is switched off).
    func restore() {
        guard let setBrightness, let saved = UserDefaults.standard.object(forKey: savedKey) as? Float else { return }
        UserDefaults.standard.removeObject(forKey: savedKey)
        _ = setBrightness(CGMainDisplayID(), saved)
    }
}
