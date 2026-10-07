//
//  ClaudeUsageView.swift
//  Notch apple
//
//  The Claude Usage tab (Ultimate): how many tokens Claude Code has used in your current 5-hour window,
//  today and this week, read from the conversation files Claude Code keeps in ~/.claude/projects.
//  Claude doesn't publish your plan's limits to your Mac, so you can set your own budgets; the bars and
//  an optional yellow dot (at 90%) follow those. Everything is read here and never leaves your Mac.
//  The maths lives in ClaudeUsageLogic.swift.
//

import AppKit
import SwiftUI

/// Reads the transcript files off the main thread and remembers what it has already parsed.
actor ClaudeUsageScanner {
    static let shared = ClaudeUsageScanner()

    private struct Cached { let modified: Date; let size: Int; let entries: [(key: String?, entry: ClaudeUsageEntry)] }
    private var cache: [String: Cached] = [:]

    static var root: URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/projects") }

    /// Entries from files touched since `since` (older files can't hold recent messages), each reply counted once.
    func scan(since: Date) -> (entries: [ClaudeUsageEntry], found: Bool) {
        let fm = FileManager.default
        guard fm.fileExists(atPath: Self.root.path),
              let walker = fm.enumerator(at: Self.root, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey],
                                         options: [.skipsHiddenFiles]) else { return ([], false) }
        var seenPaths = Set<String>()
        var all: [(key: String?, entry: ClaudeUsageEntry)] = []
        for case let url as URL in walker where url.pathExtension == "jsonl" {
            guard let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey]),
                  values.isRegularFile == true, let modified = values.contentModificationDate, modified >= since else { continue }
            let size = values.fileSize ?? 0
            seenPaths.insert(url.path)
            if let c = cache[url.path], c.modified == modified, c.size == size { all += c.entries; continue }
            let entries = Self.read(url)
            cache[url.path] = Cached(modified: modified, size: size, entries: entries)
            all += entries
        }
        cache = cache.filter { seenPaths.contains($0.key) }
        var seen = Set<String>()
        var result: [ClaudeUsageEntry] = []
        for item in all {
            if let k = item.key { guard seen.insert(k).inserted else { continue } }
            result.append(item.entry)
        }
        return (result, true)
    }

    private static func read(_ url: URL) -> [(key: String?, entry: ClaudeUsageEntry)] {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return [] }
        let marker = Data("\"usage\"".utf8)
        var out: [(key: String?, entry: ClaudeUsageEntry)] = []
        for line in data.split(separator: 0x0A, omittingEmptySubsequences: true) {
            guard line.range(of: marker) != nil, let parsed = ClaudeUsageLogic.parse(line: Data(line)) else { continue }
            out.append((parsed.key, parsed.entry))
        }
        return out
    }
}

@MainActor
final class ClaudeUsageStore: ObservableObject {
    static let shared = ClaudeUsageStore()

    @Published private(set) var summary: ClaudeUsageSummary?
    @Published private(set) var found = true
    @Published private(set) var loading = false
    /// Your own budgets in tokens; 0 means none.
    @AppStorage("claudeUsage.blockBudget") var blockBudget = 0
    @AppStorage("claudeUsage.weekBudget") var weekBudget = 0
    @AppStorage("claudeUsage.alert") var alertAt90 = true
    @AppStorage("claudeUsage.weekAlert") var weekAlert = true
    @AppStorage("claudeUsage.summary") var dailySummary = false
    @AppStorage("claudeUsage.summaryAt") var summaryAt = 1080            // 18:00
    @AppStorage("claudeUsage.weekAlertKey") private var weekAlertKey = ""
    @AppStorage("claudeUsage.summaryDay") private var summaryDay = ""
    /// A 5-second badge in the closed notch when the colour changes, usage jumps, or the window or week resets.
    @AppStorage("claudeUsage.toasts") var toasts = true
    @Published private(set) var blockPace: UsagePace?
    @Published private(set) var weekPace: UsagePace?
    /// True when the pacing is measured against your busiest window and week because you set no budget.
    var usingOwnPeaks: Bool { blockBudget == 0 || weekBudget == 0 }
    private var lastPace: [String: (light: UsageLight, fraction: Double)] = [:]
    private var alertedBlock: Date?
    private var background: Timer?

    /// Alerts and the summary need a fresh look now and then even when the tab is closed (cheap: files are cached).
    var wantsBackground: Bool { toasts || (blockBudget > 0 && alertAt90) || (weekBudget > 0 && weekAlert) || dailySummary }

    func startBackground() {
        background?.invalidate()
        background = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, Entitlements.shared.canUse(Feature.claudeUsage), self.wantsBackground else { return }
                await self.refresh()
            }
        }
        background?.tolerance = 30
    }

    func refresh() async {
        loading = true
        let since = Date().addingTimeInterval(-30 * 86400)   // a month of history, to know your busiest window and week
        let result = await ClaudeUsageScanner.shared.scan(since: since)
        found = result.found
        let s = ClaudeUsageLogic.summary(result.entries)
        summary = s
        loading = false
        updatePaces(s)
        // A yellow dot (the same one Claude Code uses) when this window passes 90% of your budget.
        if alertAt90, blockBudget > 0, let b = s.block, alertedBlock != b.start,
           Double(b.totals.tokens) >= Double(blockBudget) * 0.9 {
            alertedBlock = b.start
            if SettingsManager.shared.claudeCodeDot { ClaudeCodeStatus.shared.show(.yellow) }
        }
        guard Entitlements.shared.canUse(Feature.claudeUsage) else { return }
        let cal = Calendar.current
        let weekKey = cal.dateInterval(of: .weekOfYear, for: Date()).map { $0.start.formatted(.iso8601.year().month().day()) } ?? ""
        if weekAlert, ClaudeUsageLogic.alertDue(used: s.week.tokens, budget: weekBudget, alertedKey: weekAlertKey, key: weekKey) {
            weekAlertKey = weekKey
            if SettingsManager.shared.claudeCodeDot { ClaudeCodeStatus.shared.show(.yellow) }
            Notifier.post(title: "Claude usage: 90% of your weekly budget", body: "\(ClaudeUsageLogic.format(s.week.tokens)) of \(ClaudeUsageLogic.format(weekBudget)) tokens in the last 7 days.")
        }
        let c = cal.dateComponents([.hour, .minute], from: Date()), today = Date().formatted(.iso8601.year().month().day())
        if dailySummary, ClaudeUsageLogic.summaryDue(minuteOfDay: (c.hour ?? 0) * 60 + (c.minute ?? 0), at: summaryAt, lastDayKey: summaryDay, todayKey: today) {
            summaryDay = today
            Notifier.post(title: "Claude Code today", body: ClaudeUsageLogic.summaryText(today: s.today, week: s.week, topModel: s.byModel.first?.model))
        }
    }
}

extension ClaudeUsageStore {
    /// The yardsticks: your own budgets, or your busiest window and week when none is set.
    var blockYardstick: Int { blockBudget > 0 ? blockBudget : max(summary?.peakBlock ?? 0, 1) }
    var weekYardstick: Int { weekBudget > 0 ? weekBudget : max(summary?.peakWeek ?? 0, 1) }

    /// Works out the green / yellow / red pace for the window and the week, and announces changes in the notch.
    fileprivate func updatePaces(_ s: ClaudeUsageSummary) {
        let now = Date()
        let b = s.block
        let blockUsed = b?.totals.tokens ?? 0
        let bp = ClaudeUsageLogic.pace(used: blockUsed, budget: blockYardstick, elapsed: b.map { now.timeIntervalSince($0.start) } ?? 0, length: ClaudeUsageLogic.blockLength)
        // The week is a rolling 7 days, so there is no "elapsed" share: the pace is simply how full it is.
        let wp = ClaudeUsageLogic.pace(used: s.week.tokens, budget: weekYardstick, elapsed: 7 * 86_400, length: 7 * 86_400)
        blockPace = bp; weekPace = wp
        guard toasts, Entitlements.shared.canUse(Feature.claudeUsage) else { return }
        for (key, label, pace) in [("block", "5h", bp), ("week", "Week", wp)] {
            guard let pace else { continue }
            let reason = ClaudeUsageLogic.toastReason(previous: lastPace[key], now: pace)
            lastPace[key] = (pace.light, pace.fraction)
            if reason != nil { announce(label: label, pace: pace, reset: reason == .reset) }
        }
    }

    private func announce(label: String, pace: UsagePace, reset: Bool) {
        let colour: NSColor = pace.light == .green ? .systemGreen : pace.light == .yellow ? .systemYellow : .systemRed
        let symbol = reset ? "arrow.counterclockwise" : "gauge.with.dots.needle.67percent"
        LiveActivityCenter.shared.flash(LiveActivity(symbol: symbol, label: "\(min(pace.percent, 999))%", tint: colour, leftText: reset ? "\(label) reset" : label), seconds: 5)
    }
}

extension UsageLight {
    var colour: Color { self == .green ? .green : self == .yellow ? .yellow : .red }
    var word: String { self == .green ? "On pace" : self == .yellow ? "Nearing the limit" : "Limit reached or burning fast" }
}

private struct UsageBar: View {
    let fraction: Double
    var colour: Color? = nil
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.surface)
                Capsule()
                    .fill(colour.map { AnyShapeStyle($0) } ?? (fraction >= 1 ? AnyShapeStyle(Color.red) : fraction >= 0.8 ? AnyShapeStyle(Color.orange) : AnyShapeStyle(Theme.accentGradient)))
                    .frame(width: max(8, g.size.width * fraction))
            }
        }
        .frame(height: 8)
    }
}

struct ClaudeUsageView: View {
    @StateObject private var store = ClaudeUsageStore.shared
    @ObservedObject private var layout = ModuleLayout.shared
    @State private var showDetails = false

    var body: some View {
        HStack(spacing: 12) {
            GlassCard { overviewCard }
            GlassCard { settingsCard }.frame(width: 290)
        }
        .task {
            while !Task.isCancelled {
                await store.refresh()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    // MARK: The simple view: two lights, optional details

    private var overviewCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Claude usage").sectionTitle()
                Spacer()
                Button { withAnimation(.snappy) { showDetails.toggle() } } label: {
                    Label(showDetails ? "Hide details" : "Details", systemImage: "chevron.right")
                        .labelStyle(.titleAndIcon).font(.system(size: 11, weight: .semibold))
                        .rotationEffect(.zero)
                }
                .buttonStyle(.plain).foregroundStyle(Theme.accentBright)
                .help("Percentages, token counts and when each limit resets")
            }
            if !store.found {
                Text("Claude Code hasn't been used on this Mac yet.").foregroundStyle(.white)
                Text("This tab reads the conversations Claude Code keeps in ~/.claude/projects. Use Claude Code once and the lights appear here.")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            } else if store.summary == nil {
                ProgressView().controlSize(.small)
            } else {
                PaceRow(title: "5-hour window", pace: store.blockPace, resets: store.summary?.block.map { "Resets in \(ClaudeUsageLogic.remaining(until: $0.end))" } ?? "Starts with your next message")
                PaceRow(title: "Weekly (last 7 days)", pace: store.weekPace, resets: "Rolling 7 days")
                if store.usingOwnPeaks {
                    Text("No budget set for one of these, so it is measured against your busiest window and week. Set your own on the right.")
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                if showDetails { details }
            }
            Spacer(minLength: 0)
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 6) {
            Divider().overlay(Theme.separator)
            if let b = store.summary?.block {
                detailLine("5-hour window", "\(ClaudeUsageLogic.format(b.totals.tokens)) of \(ClaudeUsageLogic.format(store.blockYardstick)) tokens · \(store.blockPace?.percent ?? 0)%")
                detailLine("   in / out / cached", "\(ClaudeUsageLogic.format(b.totals.input)) / \(ClaudeUsageLogic.format(b.totals.output)) / \(ClaudeUsageLogic.format(b.totals.cacheRead + b.totals.cacheWrite))")
                detailLine("   started · resets", "\(b.start.formatted(date: .omitted, time: .shortened)) · \(b.end.formatted(date: .omitted, time: .shortened))")
            } else {
                detailLine("5-hour window", "No active window")
            }
            detailLine("Last 7 days", "\(ClaudeUsageLogic.format(store.summary?.week.tokens ?? 0)) of \(ClaudeUsageLogic.format(store.weekYardstick)) tokens · \(store.weekPace?.percent ?? 0)%")
            detailLine("Today", "\(ClaudeUsageLogic.format(store.summary?.today.tokens ?? 0)) tokens · \(store.summary?.today.messages ?? 0) replies")
            if let top = store.summary?.byModel.first {
                detailLine("Most used model", "\(ClaudeUsageLogic.friendlyModel(top.model)) · \(ClaudeUsageLogic.format(top.tokens))")
            }
            Text("Read from ~/.claude on this Mac. Nothing is sent anywhere.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
        }
        .transition(.opacity)
    }

    private func detailLine(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(value).font(.system(size: 11, weight: .medium)).monospacedDigit().foregroundStyle(.white)
        }
    }

    // MARK: Settings

    private var settingsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Limits and alerts").sectionTitle()
            budgetRow(title: "Budget per window", value: $store.blockBudget)
            budgetRow(title: "Weekly budget", value: $store.weekBudget)
            Toggle("Pin to Home", isOn: Binding(
                get: { layout.choice(.claudeUsage).onHome },
                set: { layout.set($0 ? .homeExpanded : .standalone, for: .claudeUsage) }))
                .font(.system(size: 12)).toggleStyle(.switch).foregroundStyle(Theme.textSecondary)
            Toggle("Badge in the notch when it changes", isOn: $store.toasts)
                .font(.system(size: 12)).toggleStyle(.switch).foregroundStyle(Theme.textSecondary)
                .help("Five seconds, in the closed notch: the colour and percentage after a colour change, a jump of 10 points, or a reset")
            Toggle("Yellow dot at 90% of the window budget", isOn: $store.alertAt90)
                .font(.system(size: 12)).toggleStyle(.switch).foregroundStyle(Theme.textSecondary)
                .disabled(store.blockBudget == 0)
            Toggle("Alert at 90% of the weekly budget", isOn: $store.weekAlert)
                .font(.system(size: 12)).toggleStyle(.switch).foregroundStyle(Theme.textSecondary)
                .disabled(store.weekBudget == 0)
            HStack {
                Toggle("Daily summary at", isOn: $store.dailySummary).font(.system(size: 12)).toggleStyle(.switch).foregroundStyle(Theme.textSecondary)
                DatePicker("", selection: Binding(
                    get: { Calendar.current.date(bySettingHour: store.summaryAt / 60, minute: store.summaryAt % 60, second: 0, of: Date()) ?? Date() },
                    set: { let c = Calendar.current.dateComponents([.hour, .minute], from: $0); store.summaryAt = (c.hour ?? 18) * 60 + (c.minute ?? 0) }),
                           displayedComponents: .hourAndMinute).labelsHidden().disabled(!store.dailySummary)
            }
            Spacer(minLength: 0)
        }
    }

    private func budgetRow(title: String, value: Binding<Int>) -> some View {
        HStack(spacing: 8) {
            Text(title).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            Spacer()
            TextField("Auto", value: value, format: .number)
                .textFieldStyle(.roundedBorder).frame(width: 90).multilineTextAlignment(.trailing)
            Text("tokens").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
        }
    }
}

/// One limit as a coloured light, a percentage and a thin bar.
struct PaceRow: View {
    let title: String
    let pace: UsagePace?
    let resets: String

    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(pace?.light.colour ?? Theme.textSecondary).frame(width: 14, height: 14)
                .shadow(color: (pace?.light.colour ?? .clear).opacity(0.6), radius: 4)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    Spacer()
                    Text(pace.map { "\($0.percent)%" } ?? "–").font(.system(size: 18, weight: .bold, design: .rounded)).monospacedDigit()
                        .foregroundStyle(pace?.light.colour ?? Theme.textSecondary)
                }
                UsageBar(fraction: min(1, pace?.fraction ?? 0), colour: pace?.light.colour)
                Text("\(pace?.light.word ?? "Not enough to measure yet") · \(resets)").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
        }
    }
}

/// The compact version for the Home page: two lights side by side, tap the arrow for the full tab.
struct ClaudePaceCard: View {
    @StateObject private var store = ClaudeUsageStore.shared
    @EnvironmentObject private var state: NotchState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Claude usage").sectionTitle()
                Spacer()
                Button { state.selected = .claudeUsage } label: { Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)) }
                    .buttonStyle(.plain).foregroundStyle(Theme.accentBright)
                    .help("Details")
            }
            if !store.found {
                Text("Use Claude Code once to see your usage.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            } else {
                HStack(spacing: 12) {
                    mini("5h", store.blockPace)
                    mini("Week", store.weekPace)
                }
            }
        }
        .task {
            while !Task.isCancelled {
                await store.refresh()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    private func mini(_ title: String, _ pace: UsagePace?) -> some View {
        HStack(spacing: 6) {
            Circle().fill(pace?.light.colour ?? Theme.textSecondary).frame(width: 12, height: 12)
            VStack(alignment: .leading, spacing: 0) {
                Text(pace.map { "\($0.percent)%" } ?? "–").font(.system(size: 17, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(.white)
                Text(title).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
