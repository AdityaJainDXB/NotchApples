//
//  MusicLevelMeter.swift
//  Notch apple
//
//  Makes the music bars beside the notch move with the song. A listen-only
//  Core Audio tap (macOS 14.2+) hears what the Mac is playing, never changes
//  or mutes it, and nothing is recorded or saved. Four band-pass filters split
//  it into bass, low-mids, mids and highs; each bar follows one band.
//
//  It only runs while music is showing beside the closed notch. If the tap
//  can't start (no "System Audio Recording" permission, older macOS), the
//  bars fall back to their gentle animation.
//

import CoreAudio
import AudioToolbox
import Foundation
import os

final class MusicLevelMeter: @unchecked Sendable {
    static let shared = MusicLevelMeter()

    static let bandCount = 4
    /// Centre frequencies: kick/bass, low-mids (vocals, snare body), mids, highs (hats, air).
    private static let centres: [Double] = [90, 400, 1600, 6000]

    private var lock = os_unfair_lock()
    private var raw = [Float](repeating: 0, count: bandCount)   // written by the audio thread
    private var smoothed = [Float](repeating: 0, count: bandCount)
    private var peaks = [Float](repeating: 0.02, count: bandCount)

    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private let ioQueue = DispatchQueue(label: "notchapple.levels", qos: .userInitiated)
    private var filters: [[BandPass]] = []
    private(set) var isRunning = false
    private var failed = false

    /// True when the bars follow real audio (false = decorative animation).
    var isLive: Bool { isRunning }

    // MARK: Start / stop

    func start() {
        guard !isRunning, !failed else { return }
        guard #available(macOS 14.2, *) else { failed = true; return }
        guard let outputUID = Self.defaultOutputUID() else { return }
        // Listen to everything the Mac plays except Notch apple itself, without muting anything.
        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: Self.ownProcessObject().map { [$0] } ?? [])
        description.uuid = UUID()
        description.muteBehavior = .unmuted
        description.isPrivate = true
        description.name = "Notch apple music bars"
        var tap = AudioObjectID(kAudioObjectUnknown)
        guard AudioHardwareCreateProcessTap(description, &tap) == noErr else { failed = true; return }
        tapID = tap
        let rate = Self.tapSampleRate(tap) ?? 48_000
        filters = (0..<2).map { _ in Self.centres.map { BandPass(centre: $0, q: 1.1, sampleRate: rate) } }

        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Notch apple music bars",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceMainSubDeviceKey: outputUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: description.uuid.uuidString]],
        ]
        var agg = AudioObjectID(kAudioObjectUnknown)
        guard AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &agg) == noErr else { stop(); failed = true; return }
        aggregateID = agg
        let status = AudioDeviceCreateIOProcIDWithBlock(&procID, agg, ioQueue) { [weak self] _, input, _, _, _ in
            self?.analyse(input)
        }
        guard status == noErr, AudioDeviceStart(agg, procID) == noErr else { stop(); failed = true; return }
        isRunning = true
    }

    func stop() {
        if aggregateID != kAudioObjectUnknown {
            if let procID { AudioDeviceStop(aggregateID, procID); AudioDeviceDestroyIOProcID(aggregateID, procID) }
            AudioHardwareDestroyAggregateDevice(aggregateID)
        }
        if tapID != kAudioObjectUnknown, #available(macOS 14.2, *) { AudioHardwareDestroyProcessTap(tapID) }
        procID = nil
        aggregateID = AudioObjectID(kAudioObjectUnknown)
        tapID = AudioObjectID(kAudioObjectUnknown)
        isRunning = false
        os_unfair_lock_lock(&lock); raw = raw.map { _ in 0 }; os_unfair_lock_unlock(&lock)
    }

    /// Try again later (e.g. after the permission is granted).
    func resetFailure() { failed = false }

    // MARK: Analysis (audio thread)

    private func analyse(_ input: UnsafePointer<AudioBufferList>) {
        let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
        var energy = [Float](repeating: 0, count: Self.bandCount)
        var count = 0
        var channel = 0
        for buffer in list {
            guard let data = buffer.mData, buffer.mNumberChannels > 0 else { continue }
            let n = Int(buffer.mNumberChannels)
            let frames = Int(buffer.mDataByteSize) / (MemoryLayout<Float>.size * n)
            let samples = data.assumingMemoryBound(to: Float.self)
            for c in 0..<n where channel + c < filters.count {
                for i in 0..<frames {
                    let x = samples[i * n + c]
                    for b in 0..<Self.bandCount {
                        let y = filters[channel + c][b].process(x)
                        energy[b] += y * y
                    }
                }
                count += frames
            }
            channel += n
        }
        guard count > 0 else { return }
        os_unfair_lock_lock(&lock)
        for b in 0..<Self.bandCount { raw[b] = (energy[b] / Float(count)).squareRoot() }
        os_unfair_lock_unlock(&lock)
    }

    // MARK: For drawing (main thread, ~20 times a second)

    /// 0…1 per bar: fast rise, slower fall, auto-levelled so quiet and loud songs both move nicely.
    func nextFrame() -> [CGFloat] {
        os_unfair_lock_lock(&lock)
        let now = raw
        os_unfair_lock_unlock(&lock)
        var out = [CGFloat](repeating: 0, count: Self.bandCount)
        for b in 0..<Self.bandCount {
            peaks[b] = max(now[b], peaks[b] * 0.995, 0.004)
            let target = min(1, now[b] / peaks[b])
            smoothed[b] += (target - smoothed[b]) * (target > smoothed[b] ? 0.7 : 0.25)
            out[b] = CGFloat(smoothed[b])
        }
        return out
    }

    // MARK: Helpers

    private static func defaultOutputUID() -> String? {
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice,
                                                 mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var device = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device) == noErr else { return nil }
        address.mSelector = kAudioDevicePropertyDeviceUID
        var uid: Unmanaged<CFString>?
        size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &uid) == noErr, let uid else { return nil }
        return uid.takeRetainedValue() as String
    }

    private static func ownProcessObject() -> AudioObjectID? {
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
                                                 mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var pid = getpid()
        var object = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address,
                                                UInt32(MemoryLayout<pid_t>.size), &pid, &size, &object)
        return status == noErr && object != kAudioObjectUnknown ? object : nil
    }

    private static func tapSampleRate(_ tap: AudioObjectID) -> Double? {
        var address = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyFormat,
                                                 mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var format = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        return AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &format) == noErr ? format.mSampleRate : nil
    }
}

/// RBJ band-pass (constant 0 dB peak gain), transposed direct form II.
private struct BandPass {
    let b0: Float, b2: Float, a1: Float, a2: Float
    var z1: Float = 0, z2: Float = 0

    init(centre: Double, q: Double, sampleRate: Double) {
        let w0 = 2 * Double.pi * min(centre, sampleRate * 0.45) / sampleRate
        let alpha = sin(w0) / (2 * q)
        let a0 = 1 + alpha
        b0 = Float(alpha / a0); b2 = Float(-alpha / a0)
        a1 = Float(-2 * cos(w0) / a0); a2 = Float((1 - alpha) / a0)
    }

    mutating func process(_ x: Float) -> Float {
        let y = b0 * x + z1
        z1 = -a1 * y + z2
        z2 = b2 * x - a2 * y
        return y
    }
}
