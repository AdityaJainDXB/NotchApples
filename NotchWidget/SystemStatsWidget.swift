//
//  SystemStatsWidget.swift
//  Notch apple widget extension
//
//  "MacBook Center": RAM, CPU, network speed, battery and disk space for
//  Notification Center and the desktop, in Small and Medium sizes.
//
//  WidgetKit decides when a widget may refresh. The timeline asks for a new
//  reading every 5 seconds, but macOS normally allows far fewer refreshes
//  than that, so for a live view use the "Mac Stats" tab in the notch.
//

import WidgetKit
import SwiftUI

struct SystemStatsEntry: TimelineEntry {
    let date: Date
    let stats: SystemStats
}

struct SystemStatsProvider: TimelineProvider {
    func placeholder(in context: Context) -> SystemStatsEntry {
        var s = SystemStats()
        s.ramTotal = 16 << 30; s.ramUsed = 9 << 30; s.cpuPercent = 23; s.downloadRate = 1.2 * 1_048_576; s.uploadRate = 90 * 1024
        s.batteryPercent = 82; s.diskTotal = 500_000_000_000; s.diskAvailable = 210_000_000_000
        return SystemStatsEntry(date: .now, stats: s)
    }

    func getSnapshot(in context: Context, completion: @escaping (SystemStatsEntry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        Task { completion(SystemStatsEntry(date: .now, stats: await SystemStatsReader().sample(interval: 0.5))) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SystemStatsEntry>) -> Void) {
        Task {
            // CPU and network are rates, so measure over one second.
            let stats = await SystemStatsReader().sample(interval: 1)
            let entry = SystemStatsEntry(date: .now, stats: stats)
            completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(5))))
        }
    }
}

private extension Color {
    static let statPurple = Color(red: 0.62, green: 0.42, blue: 1.0)
    static let statBright = Color(red: 0.78, green: 0.62, blue: 1.0)
}

private struct StatBar: View {
    let title: String
    let symbol: String
    let value: String
    let fraction: Double
    var tint: Color = .statPurple

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Image(systemName: symbol).font(.system(size: 10, weight: .semibold)).foregroundStyle(tint)
                Text(title).font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
                Spacer(minLength: 2)
                Text(value).font(.system(size: 11, weight: .semibold, design: .rounded)).monospacedDigit().lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.quaternary)
                    Capsule().fill(tint.gradient).frame(width: max(4, geo.size.width * min(max(fraction, 0), 1)))
                }
            }
            .frame(height: 5)
        }
    }
}

struct SystemStatsWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SystemStatsEntry
    /// Lets previews and tests render a specific size outside a real widget.
    var familyOverride: WidgetFamily?

    private var s: SystemStats { entry.stats }

    var body: some View {
        switch familyOverride ?? family {
        case .systemSmall: small
        default: medium
        }
    }

    private var batteryText: String { s.batteryPercent.map { "\($0)%" } ?? "AC" }
    private var batterySymbol: String { s.batteryCharging ? "battery.100percent.bolt" : "battery.75percent" }

    private var small: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("MacBook", systemImage: "laptopcomputer").font(.system(size: 11, weight: .bold)).foregroundStyle(Color.statBright)
                Spacer()
                Label(batteryText, systemImage: batterySymbol).font(.system(size: 10, weight: .medium)).labelStyle(.titleAndIcon)
                    .foregroundStyle(.secondary)
            }
            StatBar(title: "RAM", symbol: "memorychip", value: "\(Int(s.ramFraction * 100))%", fraction: s.ramFraction)
            StatBar(title: "CPU", symbol: "cpu", value: "\(Int(s.cpuPercent))%", fraction: s.cpuPercent / 100, tint: .orange)
            VStack(alignment: .leading, spacing: 1) {
                Label(SystemStats.speed(s.downloadRate), systemImage: "arrow.down").font(.system(size: 10, weight: .medium)).monospacedDigit()
                Label(SystemStats.speed(s.uploadRate), systemImage: "arrow.up").font(.system(size: 10, weight: .medium)).monospacedDigit()
            }
            .foregroundStyle(.secondary)
        }
    }

    private var medium: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 9) {
                Label("MacBook Center", systemImage: "laptopcomputer").font(.system(size: 12, weight: .bold)).foregroundStyle(Color.statBright)
                StatBar(title: "RAM", symbol: "memorychip", value: "\(SystemStats.bytes(s.ramUsed)) / \(SystemStats.bytes(s.ramTotal))",
                        fraction: s.ramFraction)
                StatBar(title: "CPU", symbol: "cpu", value: "\(Int(s.cpuPercent))%", fraction: s.cpuPercent / 100, tint: .orange)
                StatBar(title: "Disk", symbol: "internaldrive", value: "\(SystemStats.diskBytes(s.diskAvailable)) free",
                        fraction: s.diskFraction, tint: .teal)
            }
            VStack(alignment: .leading, spacing: 9) {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Network", systemImage: "wifi").font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
                    Label(SystemStats.speed(s.downloadRate), systemImage: "arrow.down.circle.fill")
                        .font(.system(size: 12, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(.green)
                    Label(SystemStats.speed(s.uploadRate), systemImage: "arrow.up.circle.fill")
                        .font(.system(size: 12, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(.pink)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Label("Battery", systemImage: batterySymbol).font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
                    Text(batteryText).font(.system(size: 18, weight: .bold, design: .rounded))
                    Text([s.batteryCharging ? "Charging" : (s.batteryPluggedIn ? "Plugged in" : nil), s.batteryHealth]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .frame(width: 118, alignment: .leading)
        }
    }
}

struct SystemStatsWidget: Widget {
    let kind = "SystemStatsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SystemStatsProvider()) { entry in
            SystemStatsWidgetEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    LinearGradient(colors: [Color(red: 0.12, green: 0.05, blue: 0.24), Color(red: 0.05, green: 0.02, blue: 0.10)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                }
                .environment(\.colorScheme, .dark)
        }
        .configurationDisplayName("MacBook Center")
        .description("RAM, CPU, network speed, battery and disk space at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
