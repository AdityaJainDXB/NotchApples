//
//  AudioDeviceController.swift
//  Notch apple
//
//  CoreAudio wrapper for output-device routing and master volume, plus a
//  bridge to the open-source BackgroundMusic driver for per-app volume.
//
//  Why a driver? macOS offers no public API to change another app's volume.
//  BackgroundMusic (https://github.com/kyleneideck/BackgroundMusic) installs a
//  virtual output device ("Background Music", UID "BGMDevice") that apps play
//  into; it exposes a custom property `apvs` holding per-app relative volumes.
//  When the driver is installed we read/write that property directly. When it
//  isn't, the per-app UI explains how to install it.
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
    /// 0…100 where 50 is unchanged (BackgroundMusic's relative scale).
    var level: Double
}

final class AudioDeviceController: ObservableObject {
    static let shared = AudioDeviceController()

    @Published private(set) var outputs: [AudioDevice] = []
    @Published private(set) var defaultOutput: AudioDeviceID = 0
    @Published var volume: Float = 0.5
    @Published private(set) var backgroundMusicDevice: AudioDeviceID?
    @Published var appVolumes: [AppVolume] = []

    private static let bgmUID = "BGMDevice"
    /// FourCC 'apvs' — kAudioDeviceCustomPropertyAppVolumes in BGM_Types.h
    private static let bgmAppVolumes: AudioObjectPropertySelector = 0x61707673

    init() { refresh() }

    // MARK: Devices

    func refresh() {
        outputs = Self.allDevices().filter { Self.hasOutput($0.id) }
        defaultOutput = Self.getDefaultOutput()
        volume = Self.getVolume(defaultOutput) ?? volume
        backgroundMusicDevice = Self.allDevices().first { $0.uid == Self.bgmUID }?.id
        refreshAppVolumes()
    }

    func setDefaultOutput(_ id: AudioDeviceID) {
        var dev = id
        var addr = Self.address(kAudioHardwarePropertyDefaultOutputDevice)
        AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil,
                                   UInt32(MemoryLayout<AudioDeviceID>.size), &dev)
        refresh()
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

    // MARK: Per-app volume (BackgroundMusic)

    /// Lists regular running apps, merged with any levels BackgroundMusic already stores.
    func refreshAppVolumes() {
        let stored = readBGMVolumes()
        appVolumes = NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular && $0.bundleIdentifier != Bundle.main.bundleIdentifier }
            .compactMap { app in
                guard let bid = app.bundleIdentifier else { return nil }
                return AppVolume(bundleID: bid, name: app.localizedName ?? bid, pid: app.processIdentifier,
                                 level: stored[bid] ?? 50)
            }
            .sorted { $0.name < $1.name }
    }

    func setAppVolume(_ app: AppVolume, level: Double) {
        if let i = appVolumes.firstIndex(of: app) { appVolumes[i].level = level }
        guard let device = backgroundMusicDevice else { return }
        let entry: [String: Any] = ["pid": app.pid, "bid": app.bundleID, "rvol": Int(level)]
        var array: Unmanaged<CFArray> = .passRetained([entry] as CFArray)
        defer { array.release() }
        var addr = AudioObjectPropertyAddress(mSelector: Self.bgmAppVolumes,
                                              mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        AudioObjectSetPropertyData(device, &addr, 0, nil, UInt32(MemoryLayout<CFArray>.size), &array)
    }

    private func readBGMVolumes() -> [String: Double] {
        guard let device = backgroundMusicDevice else { return [:] }
        var addr = AudioObjectPropertyAddress(mSelector: Self.bgmAppVolumes,
                                              mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(MemoryLayout<CFArray>.size)
        var array: Unmanaged<CFArray>?
        guard AudioObjectGetPropertyData(device, &addr, 0, nil, &size, &array) == noErr,
              let list = array?.takeRetainedValue() as? [[String: Any]] else { return [:] }
        var result: [String: Double] = [:]
        for item in list {
            if let bid = item["bid"] as? String, let v = item["rvol"] as? Int { result[bid] = Double(v) }
        }
        return result
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
