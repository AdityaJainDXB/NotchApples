//
//  AppAudioTap.swift
//  Notch apple
//
//  Native per-app volume and 10-band EQ, with no audio driver, using Core
//  Audio process taps (macOS 14.2+):
//
//   1. `CATapDescription` + `AudioHardwareCreateProcessTap` capture one app's
//      audio. `.mutedWhenTapped` silences the app's original output while we
//      hold the tap, so the listener only hears our processed copy.
//   2. A private aggregate device combines that tap (input) with the current
//      output device (output).
//   3. An IO proc copies tap → output, applying gain and a cascade of biquad
//      peaking filters (RBJ Audio EQ Cookbook).
//
//  A tap only exists while an app's volume ≠ 100 % or its EQ isn't flat, so
//  untouched apps have zero overhead. The first tap triggers macOS's
//  "System Audio Recording" permission prompt.
//

import Foundation
import CoreAudio
import AudioToolbox
import os

// MARK: - DSP

/// Biquad coefficients, normalised so a0 == 1.
struct BiquadCoefficients {
    var b0: Float = 1, b1: Float = 0, b2: Float = 0, a1: Float = 0, a2: Float = 0

    /// Peaking EQ (RBJ cookbook).
    static func peaking(frequency: Double, gainDB: Double, q: Double, sampleRate: Double) -> BiquadCoefficients {
        guard abs(gainDB) > 0.01, frequency < sampleRate / 2 else { return BiquadCoefficients() }
        let a = pow(10, gainDB / 40)
        let w0 = 2 * Double.pi * frequency / sampleRate
        let alpha = sin(w0) / (2 * q)
        let cosw = cos(w0)
        let a0 = 1 + alpha / a
        return BiquadCoefficients(
            b0: Float((1 + alpha * a) / a0), b1: Float(-2 * cosw / a0), b2: Float((1 - alpha * a) / a0),
            a1: Float(-2 * cosw / a0), a2: Float((1 - alpha / a) / a0))
    }
}

/// Filter state for one band on one channel (transposed direct form II).
private struct BiquadState { var z1: Float = 0, z2: Float = 0 }

/// Parameters shared between the UI thread and the real-time audio thread.
final class TapParameters: @unchecked Sendable {
    static let frequencies: [Double] = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

    private var lock = os_unfair_lock()
    private var _gain: Float = 1
    private var _bands: [BiquadCoefficients] = Array(repeating: BiquadCoefficients(), count: 10)

    func update(gain: Float, eqDB: [Double], sampleRate: Double) {
        let bands = zip(Self.frequencies, eqDB).map {
            BiquadCoefficients.peaking(frequency: $0, gainDB: $1, q: 1.41, sampleRate: sampleRate)
        }
        os_unfair_lock_lock(&lock)
        _gain = gain
        _bands = bands
        os_unfair_lock_unlock(&lock)
    }

    /// Non-blocking read for the audio thread; returns nil if the UI is mid-update.
    func trySnapshot() -> (Float, [BiquadCoefficients])? {
        guard os_unfair_lock_trylock(&lock) else { return nil }
        defer { os_unfair_lock_unlock(&lock) }
        return (_gain, _bands)
    }
}

// MARK: - Tap

@available(macOS 14.2, *)
final class AppAudioTap {
    let pid: pid_t
    let parameters = TapParameters()
    private(set) var sampleRate: Double = 48_000

    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private let ioQueue = DispatchQueue(label: "notchapple.audiotap", qos: .userInteractive)

    // Real-time state (touched only on `ioQueue`).
    private var states: [[BiquadState]] = []
    private var lastGain: Float = 1
    private var lastBands: [BiquadCoefficients] = Array(repeating: BiquadCoefficients(), count: 10)

    enum TapError: LocalizedError {
        case noProcess, create(OSStatus), aggregate(OSStatus), start(OSStatus)
        var errorDescription: String? {
            switch self {
            case .noProcess: "That app isn't playing audio yet."
            case .create(let s): "Couldn't tap the app's audio (\(s)). Allow Notch apple under System Settings → Privacy & Security → Screen & System Audio Recording."
            case .aggregate(let s): "Couldn't create the audio route (\(s))."
            case .start(let s): "Couldn't start audio processing (\(s))."
            }
        }
    }

    init(pid: pid_t, outputDeviceUID: String) throws {
        self.pid = pid
        let processObject = try Self.processObject(for: pid)

        // 1. Tap the process and mute its direct output while tapped.
        let description = CATapDescription(stereoMixdownOfProcesses: [processObject])
        description.uuid = UUID()
        description.muteBehavior = .mutedWhenTapped
        description.isPrivate = true
        description.name = "Notch apple tap \(pid)"
        var tap = AudioObjectID(kAudioObjectUnknown)
        var status = AudioHardwareCreateProcessTap(description, &tap)
        guard status == noErr else { throw TapError.create(status) }
        tapID = tap

        if let format = Self.tapFormat(tap) { sampleRate = format.mSampleRate }

        // 2. Aggregate device: tap in, real output device out.
        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Notch apple \(pid)",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceMainSubDeviceKey: outputDeviceUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputDeviceUID]],
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true,
                                               kAudioSubTapUIDKey: description.uuid.uuidString]],
        ]
        var agg = AudioObjectID(kAudioObjectUnknown)
        status = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &agg)
        guard status == noErr else { teardown(); throw TapError.aggregate(status) }
        aggregateID = agg

        // 3. Process audio.
        status = AudioDeviceCreateIOProcIDWithBlock(&procID, agg, ioQueue) { [weak self] _, input, _, output, _ in
            self?.process(input: input, output: output)
        }
        guard status == noErr else { teardown(); throw TapError.start(status) }
        status = AudioDeviceStart(agg, procID)
        guard status == noErr else { teardown(); throw TapError.start(status) }
    }

    deinit { teardown() }

    func teardown() {
        if aggregateID != kAudioObjectUnknown {
            if let procID {
                AudioDeviceStop(aggregateID, procID)
                AudioDeviceDestroyIOProcID(aggregateID, procID)
            }
            AudioHardwareDestroyAggregateDevice(aggregateID)
        }
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
        procID = nil
        aggregateID = AudioObjectID(kAudioObjectUnknown)
        tapID = AudioObjectID(kAudioObjectUnknown)
    }

    // MARK: Real-time processing

    private func process(input: UnsafePointer<AudioBufferList>, output: UnsafeMutablePointer<AudioBufferList>) {
        if let (gain, bands) = parameters.trySnapshot() {
            lastGain = gain
            lastBands = bands
        }
        let inList = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
        let outList = UnsafeMutableAudioBufferListPointer(output)

        let inChannels = Self.channels(of: inList)
        let outChannels = Self.channels(of: outList)
        guard !inChannels.isEmpty, !outChannels.isEmpty else { return }
        if states.count != outChannels.count {
            states = Array(repeating: Array(repeating: BiquadState(), count: 10), count: outChannels.count)
        }
        let frames = min(inChannels[0].frames, outChannels[0].frames)
        let activeBands = lastBands.indices.filter { lastBands[$0].b1 != 0 || lastBands[$0].b0 != 1 }

        for (c, out) in outChannels.enumerated() {
            let src = inChannels[min(c, inChannels.count - 1)]
            for i in 0..<frames {
                var x = src.pointer[i * src.stride] * lastGain
                for b in activeBands {
                    let k = lastBands[b]
                    let y = k.b0 * x + states[c][b].z1
                    states[c][b].z1 = k.b1 * x - k.a1 * y + states[c][b].z2
                    states[c][b].z2 = k.b2 * x - k.a2 * y
                    x = y
                }
                out.pointer[i * out.stride] = max(-1, min(1, x))
            }
        }
    }

    /// A view onto one channel of a (possibly interleaved) Float32 buffer list.
    private struct Channel { let pointer: UnsafeMutablePointer<Float>; let stride: Int; let frames: Int }

    private static func channels(of list: UnsafeMutableAudioBufferListPointer) -> [Channel] {
        var result: [Channel] = []
        for buffer in list {
            guard let data = buffer.mData, buffer.mNumberChannels > 0 else { continue }
            let n = Int(buffer.mNumberChannels)
            let frames = Int(buffer.mDataByteSize) / (MemoryLayout<Float>.size * n)
            let base = data.assumingMemoryBound(to: Float.self)
            for c in 0..<n { result.append(Channel(pointer: base + c, stride: n, frames: frames)) }
        }
        return result
    }

    // MARK: Helpers

    private static func processObject(for pid: pid_t) throws -> AudioObjectID {
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
                                                 mScope: kAudioObjectPropertyScopeGlobal,
                                                 mElement: kAudioObjectPropertyElementMain)
        var qualifier = pid
        var object = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address,
                                                UInt32(MemoryLayout<pid_t>.size), &qualifier, &size, &object)
        guard status == noErr, object != kAudioObjectUnknown else { throw TapError.noProcess }
        return object
    }

    private static func tapFormat(_ tap: AudioObjectID) -> AudioStreamBasicDescription? {
        var address = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyFormat,
                                                 mScope: kAudioObjectPropertyScopeGlobal,
                                                 mElement: kAudioObjectPropertyElementMain)
        var format = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        return AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &format) == noErr ? format : nil
    }
}

// MARK: - Manager

/// Creates, updates and destroys taps as the user moves sliders.
final class AppAudioTapManager {
    static let shared = AppAudioTapManager()

    static var isSupported: Bool {
        if #available(macOS 14.2, *) { return true } else { return false }
    }

    private var taps: [pid_t: AnyObject] = [:]
    private(set) var lastError: String?

    /// Applies volume (0…1.5, 1 = unchanged) and EQ (dB per band) to an app.
    func apply(pid: pid_t, volume: Double, eqDB: [Double], outputDeviceUID: String) {
        guard #available(macOS 14.2, *) else { return }
        let neutral = abs(volume - 1) < 0.01 && eqDB.allSatisfy { abs($0) < 0.1 }
        if neutral {
            (taps.removeValue(forKey: pid) as? AppAudioTap)?.teardown()
            return
        }
        do {
            let tap: AppAudioTap
            if let existing = taps[pid] as? AppAudioTap { tap = existing }
            else {
                tap = try AppAudioTap(pid: pid, outputDeviceUID: outputDeviceUID)
                taps[pid] = tap
            }
            tap.parameters.update(gain: Float(volume), eqDB: eqDB, sampleRate: tap.sampleRate)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Rebuilds every tap (e.g. after the output device changes).
    func removeAll() {
        guard #available(macOS 14.2, *) else { return }
        taps.values.forEach { ($0 as? AppAudioTap)?.teardown() }
        taps.removeAll()
    }
}
