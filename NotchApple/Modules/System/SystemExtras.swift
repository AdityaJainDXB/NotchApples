//
//  SystemExtras.swift
//  Notch apple
//
//  Pro system extras:
//   • Mic mute: one click sets your microphone's input level to zero (and back),
//     with a red mic beside the notch while it's muted.
//   • Top apps: what's using the most CPU and memory right now (from `ps`).
//

import AppKit
import SwiftUI

@MainActor
final class MicMute: ObservableObject {
    static let shared = MicMute()
    @Published private(set) var isMuted = false
    @AppStorage("mic.savedVolume") private var savedVolume = 75

    func toggle() {
        guard Entitlements.shared.canUse(.micMute) else { return }
        if isMuted {
            run("set volume input volume \(max(savedVolume, 10))")
            isMuted = false
        } else {
            if let v = run("input volume of (get volume settings)")?.int32Value, v > 0 { savedVolume = Int(v) }
            run("set volume input volume 0")
            isMuted = true
        }
        LiveActivityCenter.shared.recompute()
    }

    @discardableResult
    private func run(_ source: String) -> NSAppleEventDescriptor? {
        var error: NSDictionary?
        return NSAppleScript(source: source)?.executeAndReturnError(&error)
    }

    var liveActivity: LiveActivity? {
        isMuted ? LiveActivity(symbol: "mic.slash.fill", label: "Muted", tint: .systemRed) : nil
    }
}

struct TopProcess: Identifiable {
    var id: String { name + cpu.description }
    let name: String
    let cpu: Double
    let memMB: Double
}

enum TopProcesses {
    /// The busiest processes, read with `ps` (nothing is sent anywhere).
    static func load(limit: Int = 8) async -> [TopProcess] {
        await Task.detached {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/bin/ps")
            p.arguments = ["-Aceo", "pcpu=,rss=,comm=", "-r"]
            let pipe = Pipe(); p.standardOutput = pipe
            guard (try? p.run()) != nil else { return [] }
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            p.waitUntilExit()
            return String(decoding: data, as: UTF8.self).split(separator: "\n").prefix(limit).compactMap { line -> TopProcess? in
                let parts = line.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
                guard parts.count == 3, let cpu = Double(parts[0]), let rss = Double(parts[1]) else { return nil }
                return TopProcess(name: String(parts[2]), cpu: cpu, memMB: rss / 1024)
            }
        }.value
    }
}

struct TopProcessesView: View {
    @State private var list: [TopProcess] = []
    let timer = Timer.publish(every: 3, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Busiest right now").font(.headline)
            ForEach(list) { p in
                HStack {
                    Text(p.name).lineLimit(1)
                    Spacer()
                    Text(String(format: "%.0f%%", p.cpu)).monospacedDigit().foregroundStyle(p.cpu > 50 ? .orange : .primary).frame(width: 50, alignment: .trailing)
                    Text(String(format: "%.0f MB", p.memMB)).monospacedDigit().foregroundStyle(.secondary).frame(width: 70, alignment: .trailing)
                }
                .font(.callout)
            }
            Button("Open Activity Monitor") { NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Utilities/Activity Monitor.app")) }
                .buttonStyle(.link)
        }
        .padding(14).frame(width: 320)
        .task { list = await TopProcesses.load() }
        .onReceive(timer) { _ in Task { list = await TopProcesses.load() } }
    }
}

/// World clock → Plan a meeting (Pro): slide through your day and see the time in every city,
/// green in working hours, yellow early or late, red at night.
struct MeetingPlanner: View {
    let zones: [String]
    @State private var offset = 0.0

    var body: some View {
        let base = Calendar.current.date(bySetting: .minute, value: 0, of: .now) ?? .now
        let moment = base.addingTimeInterval(offset * 3600)
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Your time: \(moment.formatted(date: .omitted, time: .shortened))").font(.headline)
                Spacer()
                Button("Now") { offset = 0 }.buttonStyle(.link)
            }
            Slider(value: $offset, in: 0...47, step: 1)
            ForEach([TimeZone.current.identifier] + zones, id: \.self) { id in
                let zone = TimeZone(identifier: id) ?? .current
                var cal = Calendar.current
                let _ = cal.timeZone = zone
                let hour = cal.component(.hour, from: moment)
                HStack {
                    Circle().fill(Self.color(hour)).frame(width: 8, height: 8)
                    Text(id == TimeZone.current.identifier ? "You" : WorldClockView.city(id)).frame(width: 130, alignment: .leading)
                    Text(moment.formatted(Date.FormatStyle(date: .omitted, time: .shortened, timeZone: zone))).monospacedDigit()
                    Text(cal.isDate(moment, inSameDayAs: .now) ? "" : moment.formatted(Date.FormatStyle(timeZone: zone).weekday(.abbreviated)))
                        .font(.caption).foregroundStyle(.secondary)
                }
                .font(.callout)
            }
            Text("Green 9:00–18:00 · yellow 7:00–9:00 and 18:00–21:00 · red at night").font(.caption2).foregroundStyle(.secondary)
        }
        .padding(14).frame(width: 360)
    }

    static func color(_ hour: Int) -> Color {
        switch hour { case 9..<18: .green; case 7..<9, 18..<21: .yellow; default: .red }
    }
}
