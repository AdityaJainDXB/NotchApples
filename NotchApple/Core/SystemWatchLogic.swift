//
//  SystemWatchLogic.swift
//  Notch apple
//
//  The rules behind four small guards: "unplug at 80%" battery care, a low disk space warning, an internet-down
//  alert with live latency, and the speed test's maths. No clocks, networks or screens here, so it can be tested.
//  The Windows app has the same rules in services/syswatch.js and the same test cases.
//

import Foundation

enum SystemWatchLogic {
    // MARK: Battery care

    /// Charging is at or past your limit and you haven't been told yet during this charge.
    static func batteryCareDue(percent: Int, pluggedIn: Bool, limit: Int, alreadyAlerted: Bool) -> Bool {
        pluggedIn && percent >= max(50, min(limit, 100)) && !alreadyAlerted
    }

    // MARK: Disk

    /// Low when free space is under `minFreeGB` or under `minFreePercent` of the disk, whichever you hit first.
    static func diskLow(freeBytes: Int64, totalBytes: Int64, minFreeGB: Double = 10, minFreePercent: Double = 8) -> Bool {
        guard totalBytes > 0, freeBytes >= 0 else { return false }
        return Double(freeBytes) < minFreeGB * 1_000_000_000 || Double(freeBytes) / Double(totalBytes) * 100 < minFreePercent
    }

    // MARK: Connection

    enum LinkState: Equatable { case online, slow, down }

    /// Keeps the last few checks. Three failures in a row is "down"; a median above 500 ms is "slow".
    struct Link: Equatable {
        private(set) var failures = 0
        private(set) var latencies: [Double] = []
        static let failuresForDown = 3, slowMs = 500.0, keep = 5

        mutating func record(ok: Bool, ms: Double? = nil) {
            if ok { failures = 0; if let ms { latencies.append(ms); if latencies.count > Self.keep { latencies.removeFirst() } } }
            else { failures += 1 }
        }

        var median: Double? {
            guard !latencies.isEmpty else { return nil }
            let s = latencies.sorted(); return s[s.count / 2]
        }

        var state: LinkState { failures >= Self.failuresForDown ? .down : ((median ?? 0) > Self.slowMs ? .slow : .online) }
    }

    /// What to tell you when the state changes: nil for no change (or for a first look that's fine).
    static func announcement(from old: LinkState, to new: LinkState) -> String? {
        guard old != new else { return nil }
        switch (old, new) {
        case (_, .down): return "Internet is down"
        case (.down, .online): return "Internet is back"
        case (.down, .slow): return "Internet is back, but slow"
        case (.online, .slow): return "Internet is slow"
        case (.slow, .online): return "Internet is back to normal"
        default: return nil
        }
    }

    // MARK: Speed test

    static func megabitsPerSecond(bytes: Int, seconds: Double) -> Double { seconds > 0 ? Double(bytes) * 8 / seconds / 1_000_000 : 0 }

    static func speedText(_ mbps: Double) -> String { mbps >= 100 ? String(format: "%.0f Mbps", mbps) : String(format: "%.1f Mbps", mbps) }
}
