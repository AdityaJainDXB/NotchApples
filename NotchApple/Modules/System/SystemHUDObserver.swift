//
//  SystemHUDObserver.swift
//  Notch apple
//
//  Watches the system volume (CoreAudio property listeners) and the built-in
//  display's brightness, and asks the closed notch to flash a gauge when either
//  changes. Nothing is shown for the value read at launch, while the notch is
//  open, or while it is hidden with the invisibility shortcut.
//
//  Brightness comes from the DisplayServices framework, which is private but
//  ships with every Mac and is what System Settings itself uses. It is loaded
//  at run time, so if it is ever missing the brightness gauge simply doesn't
//  appear. macOS has no public brightness-change notification, so it is polled
//  a few times a second.
//

import AppKit
import CoreAudio
import CoreGraphics

@MainActor
final class SystemHUDObserver {
    static let shared = SystemHUDObserver()

    private var started = false
    private var lastVolume: Float?
    private var lastMuted: Bool?
    private var lastBrightness: Float?
    private var device = AudioDeviceID(kAudioObjectUnknown)
    private var deviceListeners: [(AudioObjectPropertyAddress, AudioObjectPropertyListenerBlock)] = []
    private var systemListener: AudioObjectPropertyListenerBlock?
    private var brightnessTimer: Timer?

    private typealias GetBrightness = @convention(c) (UInt32, UnsafeMutablePointer<Float>) -> Int32
    private let getBrightness: GetBrightness? = {
        guard let handle = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_LAZY),
              let symbol = dlsym(handle, "DisplayServicesGetBrightness") else { return nil }
        return unsafeBitCast(symbol, to: GetBrightness.self)
    }()

    // MARK: Start

    func start() {
        guard !started else { return }
        started = true
        observeDefaultOutputDevice()
        attachToDefaultDevice(silently: true)
        startBrightnessPolling()
    }

    // MARK: Volume

    private static func address(_ selector: AudioObjectPropertySelector, element: AudioObjectPropertyElement = kAudioObjectPropertyElementMain,
                                scope: AudioObjectPropertyScope = kAudioDevicePropertyScopeOutput) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: element)
    }

    private func observeDefaultOutputDevice() {
        var addr = Self.address(kAudioHardwarePropertyDefaultOutputDevice, scope: kAudioObjectPropertyScopeGlobal)
        let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            Task { @MainActor in self?.attachToDefaultDevice(silently: true) }
        }
        systemListener = block
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &addr, .main, block)
    }

    /// Moves the volume listeners to the current default output device (headphones, AirPods, HDMI…).
    private func attachToDefaultDevice(silently: Bool) {
        detachDeviceListeners()
        var id = AudioDeviceID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var addr = Self.address(kAudioHardwarePropertyDefaultOutputDevice, scope: kAudioObjectPropertyScopeGlobal)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr,
              id != kAudioObjectUnknown else { return }
        device = id
        // 'vmvc' is the "virtual main volume" the system volume keys change; the others cover devices without it.
        let selectors: [(AudioObjectPropertySelector, AudioObjectPropertyElement)] = [
            (0x766D7663, kAudioObjectPropertyElementMain),
            (kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyElementMain),
            (kAudioDevicePropertyVolumeScalar, 1), (kAudioDevicePropertyVolumeScalar, 2),
            (kAudioDevicePropertyMute, kAudioObjectPropertyElementMain),
        ]
        for (selector, element) in selectors {
            var a = Self.address(selector, element: element)
            guard AudioObjectHasProperty(id, &a) else { continue }
            let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
                Task { @MainActor in self?.volumeChanged() }
            }
            if AudioObjectAddPropertyListenerBlock(id, &a, .main, block) == noErr { deviceListeners.append((a, block)) }
        }
        lastVolume = readVolume()
        lastMuted = readMuted()
    }

    private func detachDeviceListeners() {
        guard device != kAudioObjectUnknown else { return }
        for (addr, block) in deviceListeners {
            var a = addr
            AudioObjectRemovePropertyListenerBlock(device, &a, .main, block)
        }
        deviceListeners.removeAll()
    }

    private func readVolume() -> Float? {
        for (selector, element) in [(AudioObjectPropertySelector(0x766D7663), kAudioObjectPropertyElementMain),
                                    (kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyElementMain)] {
            var a = Self.address(selector, element: element)
            var v: Float = 0
            var size = UInt32(MemoryLayout<Float>.size)
            if AudioObjectHasProperty(device, &a), AudioObjectGetPropertyData(device, &a, 0, nil, &size, &v) == noErr { return v }
        }
        // Some devices only expose per-channel volume: use the average of left and right.
        var values: [Float] = []
        for element in [AudioObjectPropertyElement(1), 2] {
            var a = Self.address(kAudioDevicePropertyVolumeScalar, element: element)
            var v: Float = 0
            var size = UInt32(MemoryLayout<Float>.size)
            if AudioObjectHasProperty(device, &a), AudioObjectGetPropertyData(device, &a, 0, nil, &size, &v) == noErr { values.append(v) }
        }
        return values.isEmpty ? nil : values.reduce(0, +) / Float(values.count)
    }

    private func readMuted() -> Bool? {
        var a = Self.address(kAudioDevicePropertyMute)
        var m: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectHasProperty(device, &a), AudioObjectGetPropertyData(device, &a, 0, nil, &size, &m) == noErr else { return nil }
        return m != 0
    }

    private func volumeChanged() {
        let volume = readVolume(), muted = readMuted()
        defer { lastVolume = volume; lastMuted = muted }
        guard let volume else { return }
        let changed = abs(volume - (lastVolume ?? volume)) > 0.001 || muted != lastMuted
        guard changed else { return }
        let level = (muted ?? false) ? 0 : Double(volume)
        let symbol: String
        switch level {
        case ...0.001: symbol = "speaker.slash.fill"
        case ..<0.34: symbol = "speaker.wave.1.fill"
        case ..<0.67: symbol = "speaker.wave.2.fill"
        default: symbol = "speaker.wave.3.fill"
        }
        LiveActivityCenter.shared.showHUD(symbol: symbol, value: level)
    }

    // MARK: Brightness

    private static func builtInDisplay() -> CGDirectDisplayID? {
        var count: UInt32 = 0
        var ids = [CGDirectDisplayID](repeating: 0, count: 8)
        guard CGGetActiveDisplayList(8, &ids, &count) == .success else { return nil }
        return ids.prefix(Int(count)).first { CGDisplayIsBuiltin($0) != 0 }
    }

    private func readBrightness() -> Float? {
        guard let getBrightness, let display = Self.builtInDisplay() else { return nil }
        var value: Float = 0
        return getBrightness(display, &value) == 0 ? value : nil
    }

    private func startBrightnessPolling() {
        guard getBrightness != nil else { return }
        lastBrightness = readBrightness()
        let timer = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.pollBrightness() }
        }
        timer.tolerance = 0.1
        RunLoop.main.add(timer, forMode: .common)
        brightnessTimer = timer
    }

    private func pollBrightness() {
        guard let now = readBrightness() else { return }
        defer { lastBrightness = now }
        guard let last = lastBrightness, abs(now - last) >= 0.012 else { return }
        LiveActivityCenter.shared.showHUD(symbol: now < 0.35 ? "sun.min.fill" : "sun.max.fill", value: Double(now))
    }
}
