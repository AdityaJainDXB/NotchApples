//
//  SystemWatch.swift
//  Notch apple
//
//  Four small guards, all off until you turn them on in Settings → Extras: "unplug at 80%" battery care, a low disk
//  space warning, an internet-down alert, and a speed test button in the Stats tab. The internet check fetches a tiny
//  Apple page every 20 seconds to see if you're online and how fast it answers; the speed test downloads about 20 MB
//  from Cloudflare when you press it. The rules live in SystemWatchLogic.swift.
//

import AppKit
import SwiftUI

@MainActor
final class SystemWatch: ObservableObject {
    static let shared = SystemWatch()
    typealias L = SystemWatchLogic

    @AppStorage("watch.batteryCare") var batteryCare = false
    @AppStorage("watch.batteryLimit") var batteryLimit = 80
    @AppStorage("watch.diskLow") var diskAlert = false
    @AppStorage("watch.diskGB") var diskGB = 10
    @AppStorage("watch.internet") var internetAlert = false { didSet { link = L.Link(); state = .online; latency = nil } }
    @Published private(set) var state: L.LinkState = .online
    @Published private(set) var latency: Double?

    private var link = L.Link()
    private var careAlerted = false
    private var diskAlerted = false
    private var timer: Timer?
    private var tick = 0

    func start() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.check() } }
        timer?.tolerance = 4
    }

    private func check() {
        tick += 1
        checkBattery()
        if tick % 15 == 1 { checkDisk() }     // about every 5 minutes
        if internetAlert { Task { await checkInternet() } }
    }

    private func checkBattery() {
        guard let b = LiveActivityCenter.battery() else { return }
        if !b.pluggedIn { careAlerted = false; return }
        guard batteryCare, L.batteryCareDue(percent: b.percent, pluggedIn: b.pluggedIn, limit: batteryLimit, alreadyAlerted: careAlerted) else { return }
        careAlerted = true
        LiveActivityCenter.shared.flash(LiveActivity(symbol: "battery.75percent", label: "\(b.percent)%", tint: .systemGreen), seconds: 6)
        Notifier.post(title: "Battery at \(b.percent)%", body: "You can unplug now: staying under \(batteryLimit)% is gentler on the battery.")
    }

    private func checkDisk() {
        guard diskAlert, let v = try? URL(fileURLWithPath: "/").resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeTotalCapacityKey]),
              let free = v.volumeAvailableCapacityForImportantUsage, let total = v.volumeTotalCapacity else { return }
        let low = L.diskLow(freeBytes: free, totalBytes: Int64(total), minFreeGB: Double(diskGB))
        if low, !diskAlerted {
            diskAlerted = true
            LiveActivityCenter.shared.flash(LiveActivity(symbol: "internaldrive", label: ByteCountFormatter.string(fromByteCount: free, countStyle: .file), tint: .systemOrange), seconds: 6)
            Notifier.post(title: "Low disk space", body: "Only \(ByteCountFormatter.string(fromByteCount: free, countStyle: .file)) is free on your Mac.")
        } else if !low, Double(free) > Double(diskGB) * 1_200_000_000 { diskAlerted = false }   // re-arm once it has clearly recovered
    }

    private func checkInternet() async {
        var request = URLRequest(url: URL(string: "https://www.apple.com/library/test/success.html")!, timeoutInterval: 4)
        request.httpMethod = "HEAD"; request.cachePolicy = .reloadIgnoringLocalCacheData
        let start = Date()
        let ok = ((try? await URLSession.shared.data(for: request).1 as? HTTPURLResponse)?.statusCode ?? 0) < 400
        let ms = Date().timeIntervalSince(start) * 1000
        let old = link.state
        link.record(ok: ok, ms: ok ? ms : nil)
        latency = link.median
        state = link.state
        if let text = L.announcement(from: old, to: link.state) {
            let down = link.state == .down
            LiveActivityCenter.shared.flash(LiveActivity(symbol: down ? "wifi.slash" : "wifi", label: nil, tint: down ? .systemYellow : .systemGreen, dotOnly: true), seconds: 4)
            Notifier.post(title: text, body: down ? "Your Mac can't reach the internet." : "Your connection changed.")
        }
    }
}

/// One tap, about 20 MB from Cloudflare's public speed test, shown as megabits per second.
@MainActor
final class SpeedTest: ObservableObject {
    static let shared = SpeedTest()
    @Published private(set) var result: String?
    @Published private(set) var running = false

    func run() async {
        guard !running else { return }
        running = true; result = "Testing…"
        defer { running = false }
        let size = 20_000_000
        guard let url = URL(string: "https://speed.cloudflare.com/__down?bytes=\(size)") else { return }
        let start = Date()
        do {
            let (data, _) = try await URLSession.shared.data(for: URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30))
            result = SystemWatchLogic.speedText(SystemWatchLogic.megabitsPerSecond(bytes: data.count, seconds: Date().timeIntervalSince(start)))
        } catch { result = "Couldn't run the test" }
    }
}
