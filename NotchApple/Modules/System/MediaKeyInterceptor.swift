//
//  MediaKeyInterceptor.swift
//  Notch Apple
//
//  Replaces macOS's own volume and brightness pop-ups with the notch gauge.
//
//  An event tap catches the volume and brightness keys, applies the change
//  itself (CoreAudio for volume, DisplayServices for brightness) and swallows
//  the key, so the system never draws its pop-up. SystemHUDObserver then sees
//  the new level and shows the notch gauge as usual.
//
//  Needs Accessibility (the same permission window snapping uses). Without it,
//  or with the setting off, the keys behave exactly as before.
//

import AppKit
import CoreAudio

final class MediaKeyInterceptor {
    static let shared = MediaKeyInterceptor()

    private var tap: CFMachPort?
    private var source: CFRunLoopSource?

    // NX_KEYTYPE_* values from IOKit/hidsystem/ev_keymap.h.
    private enum Key: Int {
        case soundUp = 0, soundDown = 1, brightnessUp = 2, brightnessDown = 3, mute = 7
    }

    private typealias GetBrightness = @convention(c) (UInt32, UnsafeMutablePointer<Float>) -> Int32
    private typealias SetBrightness = @convention(c) (UInt32, Float) -> Int32
    private let displayServices = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_LAZY)
    private lazy var getBrightness: GetBrightness? = displayServices.flatMap { dlsym($0, "DisplayServicesGetBrightness") }
        .map { unsafeBitCast($0, to: GetBrightness.self) }
    private lazy var setBrightness: SetBrightness? = displayServices.flatMap { dlsym($0, "DisplayServicesSetBrightness") }
        .map { unsafeBitCast($0, to: SetBrightness.self) }

    var isRunning: Bool { tap != nil }

    /// Starts or stops to match the setting. Returns false if Accessibility is missing.
    @discardableResult
    func setEnabled(_ enabled: Bool) -> Bool {
        if !enabled { stop(); return true }
        guard tap == nil else { return true }
        guard AXIsProcessTrusted() else { return false }
        let mask = CGEventMask(1 << 14)   // NSEvent.EventType.systemDefined
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
                                          eventsOfInterest: mask, callback: { _, type, event, info in
            guard let info else { return Unmanaged.passUnretained(event) }
            let me = Unmanaged<MediaKeyInterceptor>.fromOpaque(info).takeUnretainedValue()
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                if let tap = me.tap { CGEvent.tapEnable(tap: tap, enable: true) }
                return Unmanaged.passUnretained(event)
            }
            return me.handle(event) ? nil : Unmanaged.passUnretained(event)
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

    /// Returns true when the key was handled (and should be swallowed).
    private func handle(_ cgEvent: CGEvent) -> Bool {
        guard let event = NSEvent(cgEvent: cgEvent), event.subtype.rawValue == 8 else { return false }
        let code = (event.data1 & 0xFFFF0000) >> 16
        let isDown = ((event.data1 & 0xFF00) >> 8) == 0xA
        guard let key = Key(rawValue: code) else { return false }
        // Option+Shift = quarter steps, like macOS.
        let fine = event.modifierFlags.contains(.option) && event.modifierFlags.contains(.shift)
        let step: Float = fine ? 1.0 / 64 : 1.0 / 16

        switch key {
        case .soundUp, .soundDown, .mute:
            // The tap callback runs on the main thread and must return at once: macOS switches a tap off when it is slow, and a held key
            // sends dozens of events a second. The CoreAudio reads and writes happen on their own queue, merged into one change.
            if isDown { enqueueVolume(delta: key == .soundUp ? step : key == .soundDown ? -step : 0, toggleMute: key == .mute, fromMuted: false) }
            return true
        case .brightnessUp, .brightnessDown:
            guard let getBrightness, let setBrightness else { return false }
            let display = CGMainDisplayID()
            var value: Float = 0
            guard getBrightness(display, &value) == 0 else { return false }
            if isDown {
                let next = max(0, min(1, value + (key == .brightnessUp ? step : -step)))
                _ = setBrightness(display, next)
                Self.flash(symbol: next < 0.35 ? "sun.min.fill" : "sun.max.fill", Double(next))
            }
            return true
        }
    }

    /// Changes the output volume by `delta` (used by scroll gestures on the notch) and shows the gauge.
    func nudgeVolume(_ delta: Float) { enqueueVolume(delta: delta, toggleMute: false, fromMuted: true) }

    // MARK: Volume work (off the main thread, merged)

    private let volumeQueue = DispatchQueue(label: "notchapple.volume", qos: .userInteractive)
    private let pendingLock = NSLock()
    private var pendingDelta: Float = 0
    private var pendingToggleMute = false
    private var pendingFromMuted = false
    private var volumeWorkScheduled = false
    private var lastFlash = Date.distantPast
    private var flashPending = false

    private func enqueueVolume(delta: Float, toggleMute: Bool, fromMuted: Bool) {
        pendingLock.lock()
        pendingDelta += delta
        if toggleMute { pendingToggleMute.toggle() }
        if fromMuted { pendingFromMuted = true }
        let schedule = !volumeWorkScheduled
        volumeWorkScheduled = true
        pendingLock.unlock()
        if schedule { volumeQueue.asyncAfter(deadline: .now() + 0.02) { [weak self] in self?.applyPendingVolume() } }
    }

    private func applyPendingVolume() {
        pendingLock.lock()
        let delta = pendingDelta, toggle = pendingToggleMute, fromMuted = pendingFromMuted
        pendingDelta = 0; pendingToggleMute = false; pendingFromMuted = false; volumeWorkScheduled = false
        pendingLock.unlock()
        guard let device = Self.defaultOutput() else { return }
        if toggle { Self.setMuted(!Self.isMuted(device), device) }
        if delta != 0 {
            let now = (fromMuted && Self.isMuted(device)) ? 0 : (Self.volume(device) ?? 0.5)
            Self.setVolume(max(0, min(1, now + delta)), device)
            if delta > 0 || !fromMuted { Self.setMuted(false, device) }
        }
        let level = Self.isMuted(device) ? 0 : Double(Self.volume(device) ?? 0)
        showGauge(level)
    }

    /// The gauge is redrawn at most about 20 times a second; the last level always gets drawn.
    private func showGauge(_ level: Double) {
        let symbol = level <= 0.001 ? "speaker.slash.fill" : level < 0.34 ? "speaker.wave.1.fill" : level < 0.67 ? "speaker.wave.2.fill" : "speaker.wave.3.fill"
        pendingLock.lock()
        let wait = max(0, 0.05 - Date().timeIntervalSince(lastFlash))
        let already = flashPending
        if wait == 0 { lastFlash = Date() } else { flashPending = true }
        pendingLock.unlock()
        if wait == 0 { Self.flash(symbol: symbol, level); return }
        if already { return }
        volumeQueue.asyncAfter(deadline: .now() + wait) { [weak self] in
            guard let self else { return }
            self.pendingLock.lock(); self.flashPending = false; self.lastFlash = Date(); self.pendingLock.unlock()
            let now = Self.defaultOutput().map { Self.isMuted($0) ? 0 : Double(Self.volume($0) ?? 0) } ?? level
            Self.flash(symbol: now <= 0.001 ? "speaker.slash.fill" : now < 0.34 ? "speaker.wave.1.fill" : now < 0.67 ? "speaker.wave.2.fill" : "speaker.wave.3.fill", now)
        }
    }

    private static func flash(symbol: String, _ value: Double) {
        DispatchQueue.main.async {
            MainActor.assumeIsolated { LiveActivityCenter.shared.showHUD(symbol: symbol, value: value) }
        }
    }

    // MARK: CoreAudio

    private static func address(_ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeOutput) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    }

    private static func defaultOutput() -> AudioObjectID? {
        var id = AudioObjectID(0), size = UInt32(MemoryLayout<AudioObjectID>.size)
        var addr = address(kAudioHardwarePropertyDefaultOutputDevice, scope: kAudioObjectPropertyScopeGlobal)
        return AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr ? id : nil
    }

    // 'vmvc' is the virtual main volume the system keys use.
    private static let virtualMainVolume = AudioObjectPropertySelector(0x766D7663)

    private static func volume(_ device: AudioObjectID) -> Float? {
        var value: Float32 = 0, size = UInt32(MemoryLayout<Float32>.size)
        var addr = address(virtualMainVolume)
        return AudioObjectGetPropertyData(device, &addr, 0, nil, &size, &value) == noErr ? value : nil
    }

    private static func setVolume(_ value: Float, _ device: AudioObjectID) {
        var v = Float32(value)
        var addr = address(virtualMainVolume)
        AudioObjectSetPropertyData(device, &addr, 0, nil, UInt32(MemoryLayout<Float32>.size), &v)
    }

    private static func isMuted(_ device: AudioObjectID) -> Bool {
        var value: UInt32 = 0, size = UInt32(MemoryLayout<UInt32>.size)
        var addr = address(kAudioDevicePropertyMute)
        return AudioObjectGetPropertyData(device, &addr, 0, nil, &size, &value) == noErr && value != 0
    }

    private static func setMuted(_ muted: Bool, _ device: AudioObjectID) {
        var v: UInt32 = muted ? 1 : 0
        var addr = address(kAudioDevicePropertyMute)
        AudioObjectSetPropertyData(device, &addr, 0, nil, UInt32(MemoryLayout<UInt32>.size), &v)
    }
}
