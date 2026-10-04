//
//  ScreenRecordingDetector.swift
//  Notch apple
//
//  Tells the notch when the screen is being recorded so it can show a
//  recording dot. macOS has no public "someone is recording" notification, so
//  this combines what can be observed without extra permissions:
//   • a recording started from Notch apple itself (Today → Start recording),
//   • the system `screencapture` tool in video mode (⌘⇧5 and `screencapture -v`),
//  (`CGDisplayIsCaptured` is no longer supported by macOS, so it can't be used.)
//  Recorders that stream through their own code (OBS, Zoom, browsers) can't be
//  seen by any public API, so they will not light the dot.
//

import AppKit
import CoreGraphics
import Darwin

@MainActor
final class ScreenRecordingDetector {
    static let shared = ScreenRecordingDetector()

    /// Set by ScreenRecorder while a recording made from the Today tab is running.
    var ownRecordingActive = false { didSet { poll() } }

    private var timer: Timer?

    func start() {
        guard timer == nil else { return }
        // Scanning the process list is the costly part, so every 4 s (8 s in Low Power Mode).
        timer = Power.timer(4) { [weak self] in self?.poll() }
        poll()
    }

    /// Every change in "is the screen being recorded", whatever the indicator setting (for auto-hide).
    var onRawChange: (Bool) -> Void = { _ in }
    private var lastRaw = false

    func poll() {
        let recording = ownRecordingActive || Self.systemRecorderRunning()
        if recording != lastRaw { lastRaw = recording; onRawChange(recording) }
        LiveActivityCenter.shared.setScreenRecording(recording && SettingsManager.shared.showRecordingIndicator)
    }

    /// True when a `screencapture` process was started in video mode (-v / -V).
    private static func systemRecorderRunning() -> Bool {
        let bytes = proc_listallpids(nil, 0)
        guard bytes > 0 else { return false }
        var pids = [pid_t](repeating: 0, count: Int(bytes) / MemoryLayout<pid_t>.size + 16)
        let filled = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size))
        guard filled > 0 else { return false }
        var nameBuffer = [CChar](repeating: 0, count: 64)
        for pid in pids.prefix(Int(filled)) where pid > 0 {
            guard proc_name(pid, &nameBuffer, UInt32(nameBuffer.count)) > 0,
                  String(cString: nameBuffer) == "screencapture" else { continue }
            if videoFlagPresent(pid) { return true }
        }
        return false
    }

    /// Reads the process arguments (KERN_PROCARGS2) and looks for -v or -V.
    private static func videoFlagPresent(_ pid: pid_t) -> Bool {
        var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
        var size = 0
        guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > 0 else { return false }
        var buffer = [UInt8](repeating: 0, count: size)
        guard sysctl(&mib, 3, &buffer, &size, nil, 0) == 0 else { return false }
        let text = String(decoding: buffer.prefix(size), as: UTF8.self)
        return text.split(separator: "\0").contains { arg in
            arg.hasPrefix("-") && !arg.hasPrefix("--") && (arg.contains("v") || arg.contains("V")) && arg.count <= 6
        }
    }
}
