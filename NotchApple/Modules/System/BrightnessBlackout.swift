//
//  BrightnessBlackout.swift
//  Notch apple
//
//  Press ⌥A to take the built-in display's brightness to zero, press it again to bring it back to where it was.
//  An event tap sees the key (so the "å" it would type is swallowed); it needs Accessibility, the same
//  permission the volume and brightness gauge uses. The level to return to is saved, so quitting the app
//  or relaunching while the screen is dark still brings it back. The keyboard backlight goes dark and
//  comes back with it (CoreBrightness, a private framework, so it quietly does nothing if it isn't there).
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

    // MARK: Keyboard backlight

    private let kbLevelKey = "brightnessBlackout.savedKeyboardLevel"
    private let kbAutoKey = "brightnessBlackout.savedKeyboardAuto"
    private lazy var kbClient: NSObject? = {
        dlopen("/System/Library/PrivateFrameworks/CoreBrightness.framework/CoreBrightness", RTLD_LAZY)
        return (NSClassFromString("KeyboardBrightnessClient") as? NSObject.Type)?.init()
    }()

    private var keyboardID: UInt64? {
        guard let c = kbClient, c.responds(to: NSSelectorFromString("copyKeyboardBacklightIDs")),
              let ids = c.perform(NSSelectorFromString("copyKeyboardBacklightIDs"))?.takeRetainedValue() as? [NSNumber] else { return nil }
        return ids.first?.uint64Value
    }

    private func keyboardLevel(_ id: UInt64) -> Float? {
        guard let c = kbClient else { return nil }
        let sel = NSSelectorFromString("brightnessForKeyboard:")
        guard c.responds(to: sel) else { return nil }
        typealias F = @convention(c) (AnyObject, Selector, UInt64) -> Float
        return unsafeBitCast(c.method(for: sel), to: F.self)(c, sel, id)
    }

    private func setKeyboardLevel(_ level: Float, _ id: UInt64) {
        guard let c = kbClient else { return }
        let sel = NSSelectorFromString("setBrightness:forKeyboard:")
        guard c.responds(to: sel) else { return }
        typealias F = @convention(c) (AnyObject, Selector, Float, UInt64) -> Bool
        _ = unsafeBitCast(c.method(for: sel), to: F.self)(c, sel, level, id)
    }

    private func keyboardAuto(_ id: UInt64) -> Bool? {
        guard let c = kbClient else { return nil }
        let sel = NSSelectorFromString("isAutoBrightnessEnabledForKeyboard:")
        guard c.responds(to: sel) else { return nil }
        typealias F = @convention(c) (AnyObject, Selector, UInt64) -> Bool
        return unsafeBitCast(c.method(for: sel), to: F.self)(c, sel, id)
    }

    private func setKeyboardAuto(_ on: Bool, _ id: UInt64) {
        guard let c = kbClient else { return }
        let sel = NSSelectorFromString("enableAutoBrightness:forKeyboard:")
        guard c.responds(to: sel) else { return }
        typealias F = @convention(c) (AnyObject, Selector, Bool, UInt64) -> Void
        unsafeBitCast(c.method(for: sel), to: F.self)(c, sel, on, id)
    }

    private func keyboardDark() {
        guard let id = keyboardID, let level = keyboardLevel(id) else { return }
        let d = UserDefaults.standard
        if d.object(forKey: kbLevelKey) == nil {
            d.set(max(level, 0.25), forKey: kbLevelKey)
            d.set(keyboardAuto(id) ?? true, forKey: kbAutoKey)
        }
        setKeyboardAuto(false, id)
        setKeyboardLevel(0, id)
    }

    private func keyboardRestore() {
        let d = UserDefaults.standard
        guard let id = keyboardID, let saved = d.object(forKey: kbLevelKey) as? Float else { return }
        let auto = d.object(forKey: kbAutoKey) as? Bool ?? true
        d.removeObject(forKey: kbLevelKey)
        d.removeObject(forKey: kbAutoKey)
        setKeyboardLevel(saved, id)
        setKeyboardAuto(auto, id)
    }

    /// Settings → "Reset keyboard brightness": automatic brightness back on and the backlight at a normal level,
    /// whatever state it was left in.
    func resetKeyboardBrightness() {
        let d = UserDefaults.standard
        d.removeObject(forKey: kbLevelKey)
        d.removeObject(forKey: kbAutoKey)
        guard let id = keyboardID else { return }
        setKeyboardAuto(true, id)
        if (keyboardLevel(id) ?? 0) < 0.3 { setKeyboardLevel(0.5, id) }
    }

    var isRunning: Bool { tap != nil }
    var isDark: Bool { UserDefaults.standard.object(forKey: savedKey) != nil }
    var keyboardAvailable: Bool { keyboardID != nil }

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
            guard type == .keyDown, BrightnessBlackout.isOptionA(event) else { return Unmanaged.passUnretained(event) }
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
        keyboardDark()
    }

    /// Brings the brightness back to the saved level (also called on quit and when the feature is switched off).
    func restore() {
        keyboardRestore()
        guard let setBrightness, let saved = UserDefaults.standard.object(forKey: savedKey) as? Float else { return }
        UserDefaults.standard.removeObject(forKey: savedKey)
        _ = setBrightness(CGMainDisplayID(), saved)
    }
}
