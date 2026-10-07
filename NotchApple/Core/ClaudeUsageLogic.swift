//
//  ClaudeUsageLogic.swift
//  Notch apple
//
//  The maths behind the Claude Code usage tracker (Ultimate). Claude Code writes every conversation to
//  ~/.claude/projects/<project>/<session>.jsonl, and each assistant reply carries the tokens it used.
//  This file reads those lines and works out what you've used in the current 5-hour window, today and
//  this week. No screens and no file access here, so it can be tested. Everything stays on your Mac.
//

import Foundation

struct ClaudeUsageEntry: Equatable {
    let time: Date
    let model: String
    let input: Int
    let output: Int
    let cacheWrite: Int
    let cacheRead: Int

    /// What people usually mean by "tokens used": the words in and out.
    var tokens: Int { input + output }
    /// Everything, including the cache.
    var allTokens: Int { input + output + cacheWrite + cacheRead }
}

struct ClaudeTokens: Equatable {
    var input = 0, output = 0, cacheWrite = 0, cacheRead = 0, messages = 0
    var tokens: Int { input + output }
    var allTokens: Int { input + output + cacheWrite + cacheRead }

    mutating func add(_ e: ClaudeUsageEntry) {
        input += e.input; output += e.output; cacheWrite += e.cacheWrite; cacheRead += e.cacheRead; messages += 1
    }
}

struct ClaudeUsageBlock: Equatable {
    let start: Date
    var last: Date
    var totals = ClaudeTokens()
    var end: Date { start.addingTimeInterval(ClaudeUsageLogic.blockLength) }
}

struct ClaudeUsageSummary: Equatable {
    var block: ClaudeUsageBlock?     // the 5-hour window you're in right now, if any
    var today = ClaudeTokens()
    var week = ClaudeTokens()
    var byModel: [(model: String, tokens: Int)] = []
    var generated = Date()

    static func == (a: Self, b: Self) -> Bool {
        a.block == b.block && a.today == b.today && a.week == b.week && a.generated == b.generated
            && a.byModel.map(\.model) == b.byModel.map(\.model) && a.byModel.map(\.tokens) == b.byModel.map(\.tokens)
    }
}

enum ClaudeUsageLogic {
    /// Claude's usage limit resets in windows of 5 hours.
    static let blockLength: TimeInterval = 5 * 3600

    /// One transcript line → an entry, or nil when it isn't an assistant reply with usage.
    /// Returns a key too (message id + request id) so the same reply written twice is counted once.
    static func parse(line: Data) -> (key: String?, entry: ClaudeUsageEntry)? {
        guard let obj = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any],
              (obj["type"] as? String) == "assistant",
              let message = obj["message"] as? [String: Any],
              let usage = message["usage"] as? [String: Any],
              let stamp = obj["timestamp"] as? String, let time = date(from: stamp) else { return nil }
        func n(_ k: String) -> Int { (usage[k] as? Int) ?? Int((usage[k] as? Double) ?? 0) }
        let entry = ClaudeUsageEntry(time: time, model: (message["model"] as? String) ?? "unknown",
                                     input: n("input_tokens"), output: n("output_tokens"),
                                     cacheWrite: n("cache_creation_input_tokens"), cacheRead: n("cache_read_input_tokens"))
        guard entry.allTokens > 0, entry.model != "<synthetic>" else { return nil }
        var key: String?
        if let id = message["id"] as? String, let req = obj["requestId"] as? String { key = "\(id):\(req)" }
        return (key, entry)
    }

    static func date(from iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)
    }

    /// A window starts at the hour of its first message (like Claude Code's own accounting).
    static func blockStart(for t: Date) -> Date {
        Date(timeIntervalSince1970: (t.timeIntervalSince1970 / 3600).rounded(.down) * 3600)
    }

    /// Splits entries (in any order) into 5-hour windows: a new one starts when a message arrives after
    /// the current one has ended, or after 5 quiet hours.
    static func blocks(_ entries: [ClaudeUsageEntry]) -> [ClaudeUsageBlock] {
        var result: [ClaudeUsageBlock] = []
        for e in entries.sorted(by: { $0.time < $1.time }) {
            if var b = result.last, e.time < b.end, e.time.timeIntervalSince(b.last) < blockLength {
                b.last = e.time; b.totals.add(e); result[result.count - 1] = b
            } else {
                var b = ClaudeUsageBlock(start: blockStart(for: e.time), last: e.time)
                b.totals.add(e); result.append(b)
            }
        }
        return result
    }

    /// The window you're in now: it must not have ended, and you must have used Claude within the last 5 hours.
    static func currentBlock(_ entries: [ClaudeUsageEntry], now: Date) -> ClaudeUsageBlock? {
        guard let b = blocks(entries).last, now < b.end, now.timeIntervalSince(b.last) < blockLength else { return nil }
        return b
    }

    static func summary(_ entries: [ClaudeUsageEntry], now: Date = Date(), calendar: Calendar = .current) -> ClaudeUsageSummary {
        var s = ClaudeUsageSummary(generated: now)
        s.block = currentBlock(entries, now: now)
        let dayStart = calendar.startOfDay(for: now)
        let weekStart = calendar.date(byAdding: .day, value: -6, to: dayStart) ?? dayStart
        var perModel: [String: Int] = [:]
        for e in entries where e.time <= now {
            if e.time >= dayStart { s.today.add(e) }
            if e.time >= weekStart { s.week.add(e); perModel[e.model, default: 0] += e.tokens }
        }
        s.byModel = perModel.map { (model: $0.key, tokens: $0.value) }.sorted { $0.tokens > $1.tokens }
        return s
    }

    /// 1,234 · 12.3K · 4.56M
    static func format(_ n: Int) -> String {
        switch n {
        case ..<10_000: return n.formatted()
        case ..<1_000_000: return String(format: "%.1fK", Double(n) / 1_000)
        default: return String(format: "%.2fM", Double(n) / 1_000_000)
        }
    }

    /// "claude-opus-4-5-20251101" → "Opus 4.5". Unknown names are shown as they are.
    static func friendlyModel(_ id: String) -> String {
        let lower = id.lowercased()
        guard let family = ["opus", "sonnet", "haiku", "fable"].first(where: { lower.contains($0) }) else { return id }
        let parts = lower.components(separatedBy: CharacterSet(charactersIn: "-_ "))
        guard let i = parts.firstIndex(of: family) else { return family.capitalized }
        // Version digits can come before the name ("claude-3-5-sonnet") or after it ("claude-opus-4-5-2025…").
        func isVersion(_ s: String) -> Bool { s.count <= 2 && Int(s) != nil }
        let after = parts[(i + 1)...].prefix { isVersion($0) }
        let before = parts[..<i].reversed().prefix { isVersion($0) }.reversed()
        let digits = after.isEmpty ? Array(before) : Array(after)
        return digits.isEmpty ? family.capitalized : "\(family.capitalized) \(digits.joined(separator: "."))"
    }

    /// Time to warn about a budget? True once per period (`key` names the window or week) when `used` reaches `threshold` of it.
    static func alertDue(used: Int, budget: Int, threshold: Double = 0.9, alertedKey: String, key: String) -> Bool {
        budget > 0 && alertedKey != key && Double(used) >= Double(budget) * threshold
    }

    /// The daily summary is due from `at` (minutes since midnight) until the end of the day, once per day.
    static func summaryDue(minuteOfDay: Int, at: Int, lastDayKey: String, todayKey: String) -> Bool {
        lastDayKey != todayKey && minuteOfDay >= at
    }

    /// "108K tokens in 107 replies today · 1.64M this week · mostly Opus 5.5"
    static func summaryText(today: ClaudeTokens, week: ClaudeTokens, topModel: String?) -> String {
        guard today.messages > 0 else { return "No Claude Code use today. This week: \(format(week.tokens)) tokens." }
        var text = "\(format(today.tokens)) tokens in \(today.messages) repl\(today.messages == 1 ? "y" : "ies") today · \(format(week.tokens)) this week"
        if let m = topModel { text += " · mostly \(friendlyModel(m))" }
        return text
    }

    /// 0…1 of a budget used, or nil when no budget is set.
    static func fraction(_ used: Int, budget: Int) -> Double? { budget > 0 ? min(1, Double(used) / Double(budget)) : nil }

    /// "2h 14m", "45m", "now"
    static func remaining(until end: Date, now: Date = Date()) -> String {
        let s = max(0, Int(end.timeIntervalSince(now)))
        if s < 60 { return "now" }
        let h = s / 3600, m = (s % 3600) / 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }
}

// MARK: - Pacing (green / yellow / red) and notch toasts

enum UsageLight: String, Equatable { case green, yellow, red }

struct UsagePace: Equatable {
    let light: UsageLight
    /// Share of the budget used so far, 0…1+ (can pass 1).
    let fraction: Double
    /// Where the current speed would end the period, as a share of the budget (nil until enough time has passed).
    let projected: Double?
    var percent: Int { Int((fraction * 100).rounded()) }
}

extension ClaudeUsageLogic {
    /// How you're doing against a budget. Red: the limit is reached, or you're on course to pass it well before the
    /// period ends. Yellow: close to the limit, or on course to reach it. Green: comfortably inside the pace.
    /// Nil when no budget is set.
    static func pace(used: Int, budget: Int, elapsed: TimeInterval, length: TimeInterval) -> UsagePace? {
        guard budget > 0, length > 0 else { return nil }
        let fraction = Double(used) / Double(budget)
        // Projecting from the first minutes of a period gives nonsense, so wait until a tenth has passed.
        let share = min(1, max(0, elapsed / length))
        let projected: Double? = share >= 0.1 ? fraction / share : nil
        let light: UsageLight
        if fraction >= 1 || (projected ?? 0) >= 1.5 && fraction >= 0.5 { light = .red }
        else if fraction >= 0.75 || (projected ?? 0) >= 1.0 && fraction >= 0.3 { light = .yellow }
        else { light = .green }
        return UsagePace(light: light, fraction: fraction, projected: projected)
    }

    /// What the notch should announce, if anything: a colour change, a jump of 10 points or more, or a new period
    /// (the window or week reset, so usage fell back).
    enum ToastReason: Equatable { case colour, spike, reset }

    static func toastReason(previous: (light: UsageLight, fraction: Double)?, now: UsagePace) -> ToastReason? {
        guard let p = previous else { return nil }          // first reading: nothing changed yet
        if now.fraction + 0.2 < p.fraction { return .reset }
        if now.light != p.light { return .colour }
        if now.fraction - p.fraction >= 0.10 { return .spike }
        return nil
    }
}
