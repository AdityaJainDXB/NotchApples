//
//  ScreenTimeView.swift
//  Notch apple
//
//  Pro: Screen Time and the Focus Blocker.
//   • Screen Time: how long each app was in front today and this week. It
//     listens for app switches (no polling) and doesn't count time while the
//     display sleeps or you're switched out. Set a daily limit for any app
//     and get a nudge when you pass it.
//   • Focus Blocker: pick distracting apps; while a Focus session runs they
//     are hidden the moment they come to the front.
//  Everything stays on this Mac.
//

import AppKit
import SwiftUI

@MainActor
final class ScreenTimeModel: ObservableObject {
    static let shared = ScreenTimeModel()

    /// "yyyy-MM-dd" → bundle ID → seconds.
    @Published private(set) var days: [String: [String: Double]] = [:]
    /// Bundle ID → minutes per day.
    @Published var limits: [String: Int] = [:] { didSet { UserDefaults.standard.set(limits, forKey: "screenTime.limits") } }
    @Published var blocked: [String] = [] { didSet { UserDefaults.standard.set(blocked, forKey: "blocker.apps") } }
    @AppStorage("blocker.enabled") var blockerEnabled = true
    @Published private(set) var blockedCount = 0

    private var currentApp: String?
    private var since = Date()
    private var observers: [NSObjectProtocol] = []
    private var saver: Timer?
    private var warned: Set<String> = []

    private static var fileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Notch apple", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("screen-time.json")
    }

    private static func key(_ d: Date) -> String { d.formatted(.iso8601.year().month().day()) }

    init() {
        days = (try? JSONDecoder().decode([String: [String: Double]].self, from: Data(contentsOf: Self.fileURL))) ?? [:]
        limits = UserDefaults.standard.dictionary(forKey: "screenTime.limits") as? [String: Int] ?? [:]
        blocked = UserDefaults.standard.stringArray(forKey: "blocker.apps") ?? []
    }

    /// Starts counting. Only runs while unlocked with an access code (it's a Pro feature).
    func start() {
        guard observers.isEmpty else { return }
        let ws = NSWorkspace.shared.notificationCenter
        observers.append(ws.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { note in
            let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            MainActor.assumeIsolated { ScreenTimeModel.shared.switched(to: app) }
        })
        if !powerHooked {
            powerHooked = true
            Power.onChange.append { [weak self] in
            guard let self, !self.observers.isEmpty else { return }
            if Power.isIdle { self.flush(); self.currentApp = nil } else { self.switched(to: NSWorkspace.shared.frontmostApplication) }
            }
        }
        switched(to: NSWorkspace.shared.frontmostApplication)
        saver = Power.timer(60) { [weak self] in self?.flush(); self?.checkLimits() }
    }

    private var powerHooked = false

    func stop() {
        guard !observers.isEmpty else { return }
        flush()
        observers.forEach { NSWorkspace.shared.notificationCenter.removeObserver($0) }
        observers = []
        saver?.invalidate()
        saver = nil
        currentApp = nil
    }

    private func switched(to app: NSRunningApplication?) {
        flush()
        currentApp = Power.isIdle ? nil : app?.bundleIdentifier
        since = .now
        if let app, let id = app.bundleIdentifier { enforceBlocker(app, id) }
    }

    /// Adds the time since the last switch to the current app.
    private func flush() {
        defer { since = .now }
        guard let app = currentApp, app != Bundle.main.bundleIdentifier else { return }
        let seconds = Date.now.timeIntervalSince(since)
        guard seconds > 0.5, seconds < 6 * 3600 else { return }
        days[Self.key(.now), default: [:]][app, default: 0] += seconds
        // Keep 30 days.
        if days.count > 30 { for k in days.keys.sorted().prefix(days.count - 30) { days[k] = nil } }
        try? JSONEncoder().encode(days).write(to: Self.fileURL, options: .atomic)
    }

    private func checkLimits() {
        let today = days[Self.key(.now)] ?? [:]
        for (app, minutes) in limits where minutes > 0 {
            let used = Int((today[app] ?? 0) / 60)
            let key = Self.key(.now) + app
            if used >= minutes, !warned.contains(key) {
                warned.insert(key)
                let name = Self.name(app)
                Notifier.post(title: "Time's up for \(name)", body: "You've used \(name) for \(used) minutes today (limit \(minutes)).")
                LiveActivityCenter.shared.flash(LiveActivity(symbol: "hourglass", label: "Limit", tint: .systemOrange), seconds: 6)
            }
        }
    }

    // MARK: Focus Blocker

    private func enforceBlocker(_ app: NSRunningApplication, _ id: String) {
        guard blockerEnabled, blocked.contains(id), FocusTimer.shared.isRunning, FocusTimer.shared.phase == .focus else { return }
        app.hide()
        blockedCount += 1
        LiveActivityCenter.shared.flash(LiveActivity(symbol: "hand.raised.fill", label: "Focus", tint: .systemRed), seconds: 3)
    }

    // MARK: Reading

    func today() -> [(app: String, seconds: Double)] {
        (days[Self.key(.now)] ?? [:]).sorted { $0.value > $1.value }.map { ($0.key, $0.value) }
    }

    func week() -> [(day: Date, seconds: Double)] {
        (0..<7).reversed().map { back in
            let d = Calendar.current.date(byAdding: .day, value: -back, to: .now)!
            return (d, (days[Self.key(d)] ?? [:]).values.reduce(0, +))
        }
    }

    static func name(_ bundle: String) -> String {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle)
            .map { FileManager.default.displayName(atPath: $0.path).replacingOccurrences(of: ".app", with: "") } ?? bundle
    }

    static func icon(_ bundle: String) -> NSImage {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle).map { NSWorkspace.shared.icon(forFile: $0.path) }
            ?? NSImage(systemSymbolName: "app", accessibilityDescription: nil)!
    }

    static func format(_ s: Double) -> String {
        let m = Int(s / 60)
        return m >= 60 ? "\(m / 60)h \(m % 60)m" : "\(m)m"
    }
}

struct ScreenTimeView: View {
    @StateObject private var model = ScreenTimeModel.shared
    @StateObject private var focus = FocusTimer.shared
    @State private var tab = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("", selection: $tab) {
                Text("Screen Time").tag(0)
                Text("Focus Blocker").tag(1)
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            if tab == 0 { screenTime } else { blocker }
        }
        .onAppear { model.start() }
    }

    private var screenTime: some View {
        let today = model.today()
        let total = today.map(\.seconds).reduce(0, +)
        return HStack(alignment: .top, spacing: 12) {
            GlassCard {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Today").sectionTitle()
                    Text(ScreenTimeModel.format(total)).font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(.white)
                    let week = model.week()
                    let top = max(week.map(\.seconds).max() ?? 1, 1)
                    HStack(alignment: .bottom, spacing: 6) {
                        ForEach(week, id: \.day) { d in
                            VStack(spacing: 3) {
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(Calendar.current.isDateInToday(d.day) ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Theme.surfaceHover))
                                    .frame(width: 14, height: max(3, 70 * CGFloat(d.seconds / top)))
                                    .help(ScreenTimeModel.format(d.seconds))
                                Text(d.day.formatted(.dateTime.weekday(.narrow))).font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
                            }
                        }
                    }
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    Text("Weekly average \(ScreenTimeModel.format(week.map(\.seconds).reduce(0, +) / 7))")
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
            }
            .frame(width: 200)

            ScrollView {
                VStack(spacing: 6) {
                    if today.isEmpty {
                        Text("Counting starts now. Switch between a few apps and check back.").font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary).padding(.top, 20)
                    }
                    ForEach(today.prefix(12), id: \.app) { entry in appRow(entry.app, entry.seconds, total: max(today.first?.seconds ?? 1, 1)) }
                }
            }
        }
    }

    private func appRow(_ app: String, _ seconds: Double, total: Double) -> some View {
        let limit = model.limits[app] ?? 0
        return HStack(spacing: 8) {
            Image(nsImage: ScreenTimeModel.icon(app)).resizable().frame(width: 22, height: 22)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(ScreenTimeModel.name(app)).font(.system(size: 12, weight: .medium)).foregroundStyle(.white).lineLimit(1)
                    Spacer()
                    Text(ScreenTimeModel.format(seconds)).font(.system(size: 11).monospacedDigit()).foregroundStyle(Theme.textSecondary)
                }
                ProgressView(value: min(seconds / total, 1)).tint(limit > 0 && seconds / 60 >= Double(limit) ? .orange : Theme.accentBright)
            }
            Menu {
                ForEach([0, 15, 30, 60, 90, 120, 180], id: \.self) { m in
                    Button(m == 0 ? "No limit" : "\(m) min a day") { model.limits[app] = m == 0 ? nil : m }
                }
            } label: {
                Image(systemName: limit > 0 ? "hourglass.bottomhalf.filled" : "hourglass")
            }
            .menuStyle(.borderlessButton).fixedSize()
            .help(limit > 0 ? "Daily limit: \(limit) min" : "Set a daily limit")
        }
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
    }

    private var blocker: some View {
        HStack(alignment: .top, spacing: 12) {
            GlassCard {
                VStack(alignment: .leading, spacing: 8) {
                    Toggle("Block distractions during Focus", isOn: $model.blockerEnabled).toggleStyle(.switch)
                    Text("While a Focus session runs, the apps on the right are hidden the moment they come to the front.")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                    Label(focus.isRunning && focus.phase == .focus ? "Focus is on: blocking" : "Focus is off",
                          systemImage: focus.isRunning && focus.phase == .focus ? "shield.lefthalf.filled" : "shield")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(focus.isRunning && focus.phase == .focus ? .green : Theme.textSecondary)
                    if model.blockedCount > 0 {
                        Text("Blocked \(model.blockedCount) time\(model.blockedCount == 1 ? "" : "s") this session")
                            .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                    Button { focus.isRunning ? focus.pause() : focus.start() } label: {
                        Label(focus.isRunning ? "Pause Focus" : "Start Focus", systemImage: focus.isRunning ? "pause.fill" : "play.fill")
                    }
                    .buttonStyle(PurpleButtonStyle())
                }
            }
            .frame(width: 230)

            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Blocked apps").sectionTitle()
                    Spacer()
                    Menu {
                        ForEach(suggestions, id: \.self) { id in
                            Button(ScreenTimeModel.name(id)) { if !model.blocked.contains(id) { model.blocked.append(id) } }
                        }
                    } label: { Label("Add app", systemImage: "plus") }
                    .menuStyle(.borderlessButton).fixedSize()
                }
                ScrollView {
                    VStack(spacing: 6) {
                        if model.blocked.isEmpty {
                            Text("Add apps that pull you away, like Messages, Discord or games.").font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary).padding(.top, 16)
                        }
                        ForEach(model.blocked, id: \.self) { id in
                            HStack(spacing: 8) {
                                Image(nsImage: ScreenTimeModel.icon(id)).resizable().frame(width: 20, height: 20)
                                Text(ScreenTimeModel.name(id)).font(.system(size: 12)).foregroundStyle(.white)
                                Spacer()
                                IconButton(systemImage: "xmark", help: "Remove") { model.blocked.removeAll { $0 == id } }
                            }
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                        }
                    }
                }
            }
        }
    }

    /// Running apps plus the ones you use most, minus what's already blocked.
    private var suggestions: [String] {
        let running = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.compactMap(\.bundleIdentifier)
        let used = model.today().map(\.app)
        var seen = Set<String>()
        return (used + running).filter { $0 != Bundle.main.bundleIdentifier && !model.blocked.contains($0) && seen.insert($0).inserted }
            .sorted { ScreenTimeModel.name($0) < ScreenTimeModel.name($1) }
    }
}
