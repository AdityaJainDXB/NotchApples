//
//  AudioDeviceController.swift
//  Notch apple
//
//  CoreAudio wrapper for output-device routing, master volume, and per-app
//  volume / EQ.
//
//  Per-app audio has two backends:
//   • Native (macOS 14.2+): Core Audio process taps — see AppAudioTap.swift.
//     No driver, nothing to install.
//   • BackgroundMusic driver (macOS 14.0–14.1 fallback): the open-source
//     driver (https://github.com/kyleneideck/BackgroundMusic, bundled in the
//     DMG) exposes a custom `apvs` property holding per-app relative volumes.
//

import Foundation
import CoreAudio
import AppKit

struct AudioDevice: Identifiable, Hashable {
    let id: AudioDeviceID
    let name: String
    let uid: String
}

struct AppVolume: Identifiable, Hashable {
    var id: String { bundleID }
    let bundleID: String
    let name: String
    let pid: pid_t
    /// Percent, 0…150, where 100 is unchanged.
    var level: Double
}

final class AudioDeviceController: ObservableObject {
    static let shared = AudioDeviceController()

    @Published private(set) var outputs: [AudioDevice] = []
    @Published private(set) var defaultOutput: AudioDeviceID = 0
    @Published var volume: Float = 0.5
    @Published private(set) var backgroundMusicDevice: AudioDeviceID?
    @Published var appVolumes: [AppVolume] = []
    /// Last per-app audio error to show in the UI, if any.
    @Published private(set) var appAudioError: String?
    /// Left/right balance of the output: 0 is all left, 0.5 the middle, 1 all right (Now Playing's slider).
    @Published private(set) var balance: Float = 0.5
    /// False when the output can't be panned (a mono speaker, or a device without either control).
    @Published private(set) var balanceSupported = false

    /// Which per-app backend is active.
    enum Backend { case native, backgroundMusic, unavailable }
    var backend: Backend {
        if AppAudioTapManager.isSupported { return .native }
        return backgroundMusicDevice != nil ? .backgroundMusic : .unavailable
    }

    /// Saved per-app levels (bundle ID → percent), so settings survive relaunch.
    private var savedLevels: [String: Double] {
        get { UserDefaults.standard.dictionary(forKey: "audio.appLevels") as? [String: Double] ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: "audio.appLevels") }
    }

    private var outputUID: String? { outputs.first { $0.id == defaultOutput }?.uid }

    private static let bgmUID = "BGMDevice"
    /// FourCC 'apvs' — kAudioDeviceCustomPropertyAppVolumes in BGM_Types.h
    private static let bgmAppVolumes: AudioObjectPropertySelector = 0x61707673

    init() { refresh() }

    // MARK: Devices

    func refresh() {
        outputs = Self.allDevices().filter { Self.hasOutput($0.id) }
        defaultOutput = Self.getDefaultOutput()
        volume = Self.getVolume(defaultOutput) ?? volume
        refreshBalance()
        backgroundMusicDevice = Self.allDevices().first { $0.uid == Self.bgmUID }?.id
        refreshAppVolumes()
    }

    func setDefaultOutput(_ id: AudioDeviceID) {
        var dev = id
        var addr = Self.address(kAudioHardwarePropertyDefaultOutputDevice)
        AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil,
                                   UInt32(MemoryLayout<AudioDeviceID>.size), &dev)
        refresh()
        // Taps are bound to an output device, so rebuild them on the new one.
        AppAudioTapManager.shared.removeAll()
        appVolumes.forEach { reapply($0) }
    }

    func setVolume(_ value: Float) {
        volume = value
        var v = value
        // Try the master element first, then fall back to per-channel (L/R).
        for element in [kAudioObjectPropertyElementMain, 1, 2] {
            var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyVolumeScalar,
                                                  mScope: kAudioDevicePropertyScopeOutput, mElement: element)
            var settable: DarwinBoolean = false
            if AudioObjectIsPropertySettable(defaultOutput, &addr, &settable) == noErr, settable.boolValue {
                AudioObjectSetPropertyData(defaultOutput, &addr, 0, nil, UInt32(MemoryLayout<Float>.size), &v)
                if element == kAudioObjectPropertyElementMain { return }
            }
        }
    }

    // MARK: Balance (left / right)

    /// kAudioHardwareServiceDeviceProperty_VirtualMainBalance ('bmbl'): the same balance as System Settings → Sound.
    private static let virtualBalance: AudioObjectPropertySelector = 0x626D_626C

    private func balanceAddress() -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: Self.virtualBalance, mScope: kAudioDevicePropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
    }

    private func channelAddress(_ channel: UInt32) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyVolumeScalar, mScope: kAudioDevicePropertyScopeOutput, mElement: channel)
    }

    private func settable(_ addr: AudioObjectPropertyAddress) -> Bool {
        var a = addr
        var ok: DarwinBoolean = false
        return AudioObjectHasProperty(defaultOutput, &a) && AudioObjectIsPropertySettable(defaultOutput, &a, &ok) == noErr && ok.boolValue
    }

    private func readFloat(_ addr: AudioObjectPropertyAddress) -> Float? {
        var a = addr
        var v: Float32 = 0
        var size = UInt32(MemoryLayout<Float32>.size)
        guard AudioObjectHasProperty(defaultOutput, &a), AudioObjectGetPropertyData(defaultOutput, &a, 0, nil, &size, &v) == noErr else { return nil }
        return v
    }

    /// Reads the balance of the current output.
    func refreshBalance() {
        if settable(balanceAddress()), let b = readFloat(balanceAddress()) {
            balance = b; balanceSupported = true
        } else if settable(channelAddress(1)), settable(channelAddress(2)), let l = readFloat(channelAddress(1)), let r = readFloat(channelAddress(2)) {
            // No balance control: work it out from the two channel volumes.
            let top = max(l, r)
            balance = top > 0 ? (l >= r ? r / top * 0.5 : 1 - l / top * 0.5) : 0.5
            balanceSupported = true
        } else {
            balance = 0.5; balanceSupported = false
        }
    }

    /// Pans the output: 0 sends everything to the left speaker, 1 to the right, 0.5 is the middle.
    func setBalance(_ value: Float) {
        let b = min(max(value, 0), 1)
        balance = b
        var addr = balanceAddress()
        if settable(addr) {
            var v = Float32(b)
            AudioObjectSetPropertyData(defaultOutput, &addr, 0, nil, UInt32(MemoryLayout<Float32>.size), &v)
            return
        }
        // Fallback: scale the left and right channels around the current volume.
        guard settable(channelAddress(1)), settable(channelAddress(2)) else { return }
        let top = max(readFloat(channelAddress(1)) ?? volume, readFloat(channelAddress(2)) ?? volume, 0.05)
        for (channel, level) in [(UInt32(1), top * min(1, 2 * (1 - b))), (UInt32(2), top * min(1, 2 * b))] {
            var a = channelAddress(channel)
            var v = Float32(level)
            AudioObjectSetPropertyData(defaultOutput, &a, 0, nil, UInt32(MemoryLayout<Float32>.size), &v)
        }
    }

    // MARK: Per-app volume and EQ

    /// Lists regular running apps with their saved levels.
    func refreshAppVolumes() {
        let saved = savedLevels
        appVolumes = NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular && $0.bundleIdentifier != Bundle.main.bundleIdentifier }
            .compactMap { app in
                guard let bid = app.bundleIdentifier else { return nil }
                return AppVolume(bundleID: bid, name: app.localizedName ?? bid, pid: app.processIdentifier,
                                 level: saved[bid] ?? 100)
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    func setAppVolume(_ app: AppVolume, level: Double) {
        guard let i = appVolumes.firstIndex(where: { $0.bundleID == app.bundleID }) else { return }
        appVolumes[i].level = level
        savedLevels[app.bundleID] = level
        reapply(appVolumes[i])
    }

    /// Pushes the app's current volume + EQ to whichever backend is active.
    func reapply(_ app: AppVolume) {
        let eq = EQStore.shared.gains(for: app.bundleID)
        switch backend {
        case .native:
            guard let uid = outputUID else { return }
            AppAudioTapManager.shared.apply(pid: app.pid, volume: app.level / 100, eqDB: eq, outputDeviceUID: uid)
            appAudioError = AppAudioTapManager.shared.lastError
        case .backgroundMusic:
            writeBGMVolume(app, percent: app.level)
        case .unavailable:
            break
        }
    }

    func reapply(bundleID: String) {
        if let app = appVolumes.first(where: { $0.bundleID == bundleID }) { reapply(app) }
    }

    /// BackgroundMusic's scale is 0…100 with 50 = unchanged.
    private func writeBGMVolume(_ app: AppVolume, percent: Double) {
        guard let device = backgroundMusicDevice else { return }
        let entry: [String: Any] = ["pid": app.pid, "bid": app.bundleID, "rvol": Int(min(100, percent / 2))]
        var array: Unmanaged<CFArray> = .passRetained([entry] as CFArray)
        defer { array.release() }
        var addr = AudioObjectPropertyAddress(mSelector: Self.bgmAppVolumes,
                                              mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        AudioObjectSetPropertyData(device, &addr, 0, nil, UInt32(MemoryLayout<CFArray>.size), &array)
    }

    // MARK: CoreAudio helpers

    private static func address(_ selector: AudioObjectPropertySelector,
                                scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    }

    private static func allDevices() -> [AudioDevice] {
        var addr = address(kAudioHardwarePropertyDevices)
        var size: UInt32 = 0
        AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size)
        var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids)
        return ids.map { AudioDevice(id: $0, name: string($0, kAudioObjectPropertyName) ?? "Unknown",
                                     uid: string($0, kAudioDevicePropertyDeviceUID) ?? "") }
    }

    private static func string(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
        var addr = address(selector)
        var size = UInt32(MemoryLayout<CFString?>.size)
        var value: Unmanaged<CFString>?
        guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &value) == noErr else { return nil }
        return value?.takeRetainedValue() as String?
    }

    private static func hasOutput(_ id: AudioDeviceID) -> Bool {
        var addr = address(kAudioDevicePropertyStreamConfiguration, scope: kAudioDevicePropertyScopeOutput)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr, size > 0 else { return false }
        let buffer = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { buffer.deallocate() }
        guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, buffer) == noErr else { return false }
        let list = UnsafeMutableAudioBufferListPointer(buffer.assumingMemoryBound(to: AudioBufferList.self))
        return list.contains { $0.mNumberChannels > 0 }
    }

    private static func getDefaultOutput() -> AudioDeviceID {
        var addr = address(kAudioHardwarePropertyDefaultOutputDevice)
        var id: AudioDeviceID = 0
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id)
        return id
    }

    private static func getVolume(_ id: AudioDeviceID) -> Float? {
        for element in [kAudioObjectPropertyElementMain, 1] {
            var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyVolumeScalar,
                                                  mScope: kAudioDevicePropertyScopeOutput, mElement: element)
            var v: Float = 0
            var size = UInt32(MemoryLayout<Float>.size)
            if AudioObjectHasProperty(id, &addr), AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &v) == noErr { return v }
        }
        return nil
    }
}
