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
    private var alertedBlock: Date?

    func refresh() async {
        loading = true
        let since = Date().addingTimeInterval(-8 * 86400)
        let result = await ClaudeUsageScanner.shared.scan(since: since)
        found = result.found
        let s = ClaudeUsageLogic.summary(result.entries)
        summary = s
        loading = false
        // A yellow dot (the same one Claude Code uses) when this window passes 90% of your budget.
        if alertAt90, blockBudget > 0, let b = s.block, alertedBlock != b.start,
           Double(b.totals.tokens) >= Double(blockBudget) * 0.9 {
            alertedBlock = b.start
            if SettingsManager.shared.claudeCodeDot { ClaudeCodeStatus.shared.show(.yellow) }
        }
    }
}

private struct UsageBar: View {
    let fraction: Double
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.surface)
                Capsule()
                    .fill(fraction >= 1 ? AnyShapeStyle(Color.red) : fraction >= 0.8 ? AnyShapeStyle(Color.orange) : AnyShapeStyle(Theme.accentGradient))
                    .frame(width: max(8, g.size.width * fraction))
            }
        }
        .frame(height: 8)
    }
}

struct ClaudeUsageView: View {
    @StateObject private var store = ClaudeUsageStore.shared

    var body: some View {
        HStack(spacing: 12) {
            GlassCard { windowCard }
            GlassCard { totalsCard }.frame(width: 270)
        }
        .task {
            while !Task.isCancelled {
                await store.refresh()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    // MARK: Current window

    private var windowCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Current 5-hour window").sectionTitle()
            if !store.found {
                Text("Claude Code hasn't been used on this Mac yet.")
                    .foregroundStyle(.white)
                Text("This tab reads the conversations Claude Code keeps in ~/.claude/projects. Use Claude Code once and the numbers appear here.")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            } else if store.summary == nil {
                ProgressView().controlSize(.small)
            } else if let b = store.summary?.block {
                let used = b.totals.tokens
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(ClaudeUsageLogic.format(used)).font(.system(size: 38, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(.white)
                    Text("tokens").foregroundStyle(Theme.textSecondary)
                }
                if let f = ClaudeUsageLogic.fraction(used, budget: store.blockBudget) {
                    UsageBar(fraction: f)
                    Text("\(Int(f * 100))% of your \(ClaudeUsageLogic.format(store.blockBudget)) budget")
                        .font(.system(size: 12)).foregroundStyle(f >= 0.8 ? Color.orange : Theme.textSecondary)
                }
                Text("Resets in \(ClaudeUsageLogic.remaining(until: b.end))")
                    .foregroundStyle(.white)
                Text("\(b.totals.messages) replies · \(ClaudeUsageLogic.format(b.totals.input)) in · \(ClaudeUsageLogic.format(b.totals.output)) out · \(ClaudeUsageLogic.format(b.totals.cacheRead + b.totals.cacheWrite)) cached")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            } else {
                Text("No active window").font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(.white)
                Text("A new 5-hour window starts with your next Claude Code message.")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 0)
            budgetRow(title: "Budget per window", value: $store.blockBudget)
            Toggle("Yellow dot at 90% of the window budget", isOn: $store.alertAt90)
                .font(.system(size: 12)).toggleStyle(.switch).foregroundStyle(Theme.textSecondary)
                .disabled(store.blockBudget == 0)
        }
    }

    // MARK: Today and the week

    private var totalsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Usage").sectionTitle()
            row("Today", tokens: store.summary?.today)
            row("Last 7 days", tokens: store.summary?.week)
            if let f = ClaudeUsageLogic.fraction(store.summary?.week.tokens ?? 0, budget: store.weekBudget) {
                UsageBar(fraction: f)
            }
            if let models = store.summary?.byModel, !models.isEmpty {
                Text("By model").sectionTitle().padding(.top, 4)
                ForEach(Array(models.prefix(4).enumerated()), id: \.offset) { _, m in
                    HStack {
                        Text(ClaudeUsageLogic.friendlyModel(m.model)).foregroundStyle(.white)
                        Spacer()
                        Text(ClaudeUsageLogic.format(m.tokens)).monospacedDigit().foregroundStyle(Theme.textSecondary)
                    }
                    .font(.system(size: 12))
                }
            }
            Spacer(minLength: 0)
            budgetRow(title: "Weekly budget", value: $store.weekBudget)
            Text("Read from ~/.claude on this Mac. Nothing is sent anywhere.")
                .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
        }
    }

    private func row(_ title: String, tokens: ClaudeTokens?) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(ClaudeUsageLogic.format(tokens?.tokens ?? 0)).font(.system(size: 18, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(.white)
            Text("\(tokens?.messages ?? 0) replies").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
        }
    }

    private func budgetRow(title: String, value: Binding<Int>) -> some View {
        HStack(spacing: 8) {
            Text(title).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            Spacer()
            TextField("None", value: value, format: .number)
                .textFieldStyle(.roundedBorder).frame(width: 96).multilineTextAlignment(.trailing)
            Text("tokens").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
        }
    }
}
