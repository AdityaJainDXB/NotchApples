//
//  NotchStatsView.swift
//  Notch apple
//
//  The "Mac Stats" tab: the same numbers as the MacBook Center widget, updated
//  live every second while the tab is showing. Nothing is read while it's closed.
//

import SwiftUI

@MainActor
final class SystemStatsMonitor: ObservableObject {
    @Published private(set) var stats = SystemStats()
    private let reader = SystemStatsReader()
    private var timer: Timer?
    /// Recent CPU and download readings for the sparklines.
    @Published private(set) var cpuHistory: [Double] = []
    @Published private(set) var downloadHistory: [Double] = []

    func start() {
        guard timer == nil else { return }
        _ = reader.read()   // baseline for CPU and network rates
        let t = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.tick() }
    }

    func stop() { timer?.invalidate(); timer = nil }

    private func tick() {
        stats = reader.read()
        cpuHistory = Array((cpuHistory + [stats.cpuPercent]).suffix(40))
        downloadHistory = Array((downloadHistory + [stats.downloadRate]).suffix(40))
    }
}

struct NotchStatsView: View {
    @StateObject private var monitor = SystemStatsMonitor()

    var body: some View {
        let s = monitor.stats
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                card("Memory", "memorychip") {
                    gauge(fraction: s.ramFraction, big: "\(Int(s.ramFraction * 100))%",
                          small: "\(SystemStats.bytes(s.ramUsed)) of \(SystemStats.bytes(s.ramTotal))")
                    Text("Active \(SystemStats.bytes(s.ramActive)) · Wired \(SystemStats.bytes(s.ramWired)) · Compressed \(SystemStats.bytes(s.ramCompressed))")
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(2)
                }
                card("CPU", "cpu") {
                    gauge(fraction: s.cpuPercent / 100, big: "\(Int(s.cpuPercent))%", small: "Overall load")
                    Sparkline(values: monitor.cpuHistory, maxValue: 100).frame(height: 22)
                }
            }
            HStack(spacing: 10) {
                card("Network", "wifi") {
                    Label(SystemStats.speed(s.downloadRate), systemImage: "arrow.down.circle.fill")
                        .font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(.green)
                    Label(SystemStats.speed(s.uploadRate), systemImage: "arrow.up.circle.fill")
                        .font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(.pink)
                    Sparkline(values: monitor.downloadHistory, maxValue: max(monitor.downloadHistory.max() ?? 1, 1)).frame(height: 18)
                }
                card("Battery", s.batteryCharging ? "battery.100percent.bolt" : "battery.75percent") {
                    if let percent = s.batteryPercent {
                        gauge(fraction: Double(percent) / 100, big: "\(percent)%",
                              small: [s.batteryCharging ? "Charging" : (s.batteryPluggedIn ? "Plugged in" : "On battery"), s.batteryHealth]
                                  .compactMap { $0 }.joined(separator: " · "))
                        if let m = s.batteryMinutesRemaining {
                            Text("\(m / 60) h \(m % 60) min \(s.batteryCharging ? "to full" : "left")")
                                .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                        }
                    } else {
                        Text("No battery").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    }
                }
                card("Storage", "internaldrive") {
                    gauge(fraction: s.diskFraction, big: SystemStats.diskBytes(s.diskAvailable), small: "free of \(SystemStats.diskBytes(s.diskTotal))")
                }
            }
        }
        .onAppear { monitor.start() }
        .onDisappear { monitor.stop() }
    }

    private func card<Content: View>(_ title: String, _ symbol: String, @ViewBuilder content: () -> Content) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 6) {
                Label(title, systemImage: symbol).sectionTitle()
                content()
                Spacer(minLength: 0)
            }
        }
    }

    private func gauge(fraction: Double, big: String, small: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(big).font(.system(size: 22, weight: .bold, design: .rounded)).foregroundStyle(.white).monospacedDigit()
            ProgressView(value: min(max(fraction, 0), 1)).tint(Theme.accent)
            Text(small).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
        }
    }
}

private struct Sparkline: View {
    let values: [Double]
    let maxValue: Double

    var body: some View {
        GeometryReader { geo in
            Path { path in
                guard values.count > 1 else { return }
                for (i, v) in values.enumerated() {
                    let x = geo.size.width * CGFloat(i) / CGFloat(max(values.count - 1, 1))
                    let y = geo.size.height * (1 - CGFloat(min(v / maxValue, 1)))
                    i == 0 ? path.move(to: CGPoint(x: x, y: y)) : path.addLine(to: CGPoint(x: x, y: y))
                }
            }
            .stroke(Theme.accentBright, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
        }
    }
}
