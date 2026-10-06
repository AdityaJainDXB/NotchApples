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
    let pid: Int32
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
            p.arguments = ["-Aceo", "pid=,pcpu=,rss=,comm=", "-r"]
            let pipe = Pipe(); p.standardOutput = pipe
            guard (try? p.run()) != nil else { return [] }
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            p.waitUntilExit()
            return String(decoding: data, as: UTF8.self).split(separator: "\n").prefix(limit).compactMap { line -> TopProcess? in
                let parts = line.split(separator: " ", maxSplits: 3, omittingEmptySubsequences: true)
                guard parts.count == 4, let pid = Int32(parts[0]), let cpu = Double(parts[1]), let rss = Double(parts[2]) else { return nil }
                return TopProcess(pid: pid, name: String(parts[3]), cpu: cpu, memMB: rss / 1024)
            }
        }.value
    }
}

struct TopProcessesView: View {
    @State private var list: [TopProcess] = []
    @State private var asking: TopProcess?
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
                    // Only real apps can be quit (asked politely, like ⌘Q); background processes just show.
                    if let app = Self.quittable(p) {
                        Button { asking = p } label: { Image(systemName: "xmark.circle") }.buttonStyle(.plain).foregroundStyle(.secondary)
                            .help("Quit \(app.localizedName ?? p.name)")
                    } else { Color.clear.frame(width: 14) }
                }
                .font(.callout)
            }
            Button("Open Activity Monitor") { NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Utilities/Activity Monitor.app")) }
                .buttonStyle(.link)
        }
        .padding(14).frame(width: 340)
        .confirmationDialog("Quit \(asking?.name ?? "this app")?", isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } })) {
            Button("Quit", role: .destructive) { if let p = asking { Self.quittable(p)?.terminate() }; asking = nil }
        } message: { Text("It will be asked to quit like ⌘Q. If it has unsaved work it will ask you first.") }
        .task { list = await TopProcesses.load() }
        .onReceive(timer) { _ in Task { list = await TopProcesses.load() } }
    }

    /// A normal app you can quit (never this app, Finder or the Dock), or nil.
    static func quittable(_ p: TopProcess) -> NSRunningApplication? {
        guard let app = NSRunningApplication(processIdentifier: p.pid), app.activationPolicy == .regular,
              app.bundleIdentifier != Bundle.main.bundleIdentifier, !["com.apple.finder", "com.apple.dock"].contains(app.bundleIdentifier ?? "") else { return nil }
        return app
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

/// Do Not Disturb on/off (Pro). macOS only lets Shortcuts change Focus, so this runs the two
/// shortcuts chosen in Settings → Focus ("Turn Do Not Disturb on/off"); without them it explains how.
@MainActor
enum DNDToggle {
    @AppStorage("dnd.on") static var isOn = false

    static func toggle() {
        guard Entitlements.shared.canUse(.dndToggle) else { return }
        let timer = FocusTimer.shared
        let name = isOn ? timer.dndOffShortcut : timer.dndOnShortcut
        guard !name.isEmpty else {
            Notifier.post(title: "Choose your Do Not Disturb shortcuts", body: "Settings → Focus: pick a shortcut that turns Do Not Disturb on and one that turns it off.")
            AppDelegate.openSettingsWindow(tab: .focus)
            return
        }
        ShortcutsModel.runQuietly(name)
        isOn.toggle()
        LiveActivityCenter.shared.flash(LiveActivity(symbol: isOn ? "moon.fill" : "moon", label: isOn ? "DND on" : "DND off", tint: .systemIndigo), seconds: 1.5)
    }
}
