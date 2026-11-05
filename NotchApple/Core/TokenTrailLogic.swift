//
//  TokenTrailLogic.swift
//  Notch Apple
//
//  The maths behind the Token Trail view of the Claude Usage tab (Ultimate): a profile of everything Claude Code has done on
//  this Mac, with lifetime tokens, streaks, a heatmap of every day, the 5-hour session, a monthly budget in API-equivalent
//  dollars, costliest sessions and when you work best. It is a port of the Token Trail app (its logs.js and pricing.js), so
//  the numbers match. Claude Code writes every conversation to ~/.claude/projects/<project>/<session>.jsonl and every reply
//  carries the tokens it used. No screens and no file access here, so it can be tested. Everything stays on your Mac.
//

import Foundation

// MARK: - What one log file boils down to

/// One reply from Claude, small enough to keep a few hundred thousand of them.
struct TrailRec: Codable, Equatable {
    var k: UInt64          // stable hash of "message id:request id" (0 when the line had none), so a replayed reply is counted once
    var t: Double          // seconds since 1970
    var m: Int             // index into the file's `models`
    var a = 0, b = 0, c = 0, d = 0   // input, output, cache write, cache read tokens
    var think = false, fast = false, has = false
    var sum: Int { a + b + c + d }
}

/// Everything the summary needs from one .jsonl file. Parsed once and remembered until the file changes.
struct TrailFile: Codable, Equatable {
    var proj: String
    var models: [String] = []
    var recs: [TrailRec] = []
    var skills: [String: Int] = [:]
    var longestMs: Double = 0
    var longestDay: String?
    var session = false          // a main conversation (not a sub-agent's)
    var tok = 0
}

// MARK: - Prices

enum TrailPricing {
    /// Rough API-equivalent prices in USD per million tokens: (input, output). Cache writes cost 1.25x the input price and reads
    /// 0.1x. Subscriptions are flat-rate, so the result is a scale of use and not a bill; unknown models return nil so they are
    /// left out instead of guessed.
    static func price(_ model: String) -> (Double, Double)? {
        let m = model.lowercased()
        if m == "claude chat" { return nil }
        if m.contains("haiku") { return (m.contains("3-5") || m.contains("3.5") || m.contains("3-haiku")) ? (0.8, 4) : (1, 5) }
        if m.contains("sonnet") { return (3, 15) }
        if m.contains("opus") { return (m.contains("opus-4-1") || m.contains("opus-4-2025") || m.contains("3-opus")) ? (15, 75) : (5, 25) }
        return nil
    }

    static func value(_ model: String, _ v: [Int]) -> Double? {
        guard let p = price(model), v.count == 4 else { return nil }
        return (Double(v[0]) * p.0 + Double(v[1]) * p.1 + Double(v[2]) * p.0 * 1.25 + Double(v[3]) * p.0 * 0.1) / 1e6
    }
}

// MARK: - The summary

struct TrailBlock: Equatable { var start: Double; var first: Double; var tokens: Int; var replies: Int }   // seconds since 1970

struct TrailTop: Equatable, Identifiable {
    var id = UUID()
    var project: String; var tokens: Int; var usd: Double; var replies: Int; var day: String
}

struct TrailSummary {
    /// "yyyy-MM-dd" (local) -> [input, output, cache write, cache read].
    var days: [String: [Int]] = [:]
    var models: [String: [Int]] = [:]
    var projects: [String: [Int]] = [:]
    var skills: [String: Int] = [:]
    var usd: [String: Double] = [:]           // per day
    var unpriced = 0
    var replies = 0, thinking = 0, fast = 0, sessions = 0, files = 0
    var longestMs: Double = 0
    var hours = [Int](repeating: 0, count: 24)     // tokens by hour of the day
    var weekdays = [Int](repeating: 0, count: 7)   // tokens by weekday, Sunday first
    var blocks: [TrailBlock] = []                   // the last 30 five-hour windows
    var peakBlock = 0
    var top: [TrailTop] = []
    var generated = Date()

    var isEmpty: Bool { days.isEmpty }
}

enum TokenTrailLogic {
    static let blockLength: Double = 5 * 3600

    // MARK: Reading a file

    /// A fixed-width timestamp like 2026-11-05T14:19:59.123Z as seconds since 1970, without the cost of a date formatter.
    static func seconds(fromISO s: String) -> Double? {
        let u = Array(s.utf8)
        guard u.count >= 19, u[4] == 45, u[7] == 45, u[10] == 84 || u[10] == 32, u[13] == 58, u[16] == 58 else { return slowSeconds(s) }
        func n(_ from: Int, _ len: Int) -> Int? {
            var v = 0
            for i in from..<from + len { guard u[i] >= 48, u[i] <= 57 else { return nil }; v = v * 10 + Int(u[i] - 48) }
            return v
        }
        guard let y = n(0, 4), let mo = n(5, 2), let d = n(8, 2), let h = n(11, 2), let mi = n(14, 2), let sec = n(17, 2) else { return slowSeconds(s) }
        var frac = 0.0
        var i = 19
        if i < u.count, u[i] == 46 {
            var scale = 0.1
            i += 1
            while i < u.count, u[i] >= 48, u[i] <= 57 { frac += Double(u[i] - 48) * scale; scale /= 10; i += 1 }
        }
        var offset = 0
        if i < u.count, u[i] == 43 || u[i] == 45 {            // +04:00 / -0500
            guard let oh = n(i + 1, 2) else { return slowSeconds(s) }
            let om = (i + 6 <= u.count && u[i + 3] == 58) ? (n(i + 4, 2) ?? 0) : (i + 5 <= u.count ? (n(i + 3, 2) ?? 0) : 0)
            offset = (oh * 3600 + om * 60) * (u[i] == 45 ? -1 : 1)
        } else if i < u.count, u[i] != 90 { return slowSeconds(s) }
        return Double(daysFromCivil(y, mo, d) * 86400 + h * 3600 + mi * 60 + sec - offset) + frac
    }
    private static func slowSeconds(_ s: String) -> Double? { ClaudeUsageLogic.date(from: s)?.timeIntervalSince1970 }

    /// Days since 1970-01-01 for a calendar date (proleptic Gregorian).
    static func daysFromCivil(_ y0: Int, _ m: Int, _ d: Int) -> Int {
        let y = m <= 2 ? y0 - 1 : y0
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }

    /// "2026-11-05" -> days since 1970 (for counting the days between two keys).
    static func dayNumber(_ key: String) -> Int? {
        let p = key.split(separator: "-").compactMap { Int($0) }
        return p.count == 3 ? daysFromCivil(p[0], p[1], p[2]) : nil
    }

    static func fnv64(_ s: String) -> UInt64 {
        var h: UInt64 = 0xcbf29ce484222325
        for b in s.utf8 { h = (h ^ UInt64(b)) &* 0x100000001b3 }
        return h == 0 ? 1 : h
    }

    /// Local calendar facts for a moment, cached per quarter hour because a big history has hundreds of thousands of replies.
    struct DayClock {
        private var cache: [Int: (day: String, hour: Int, weekday: Int)] = [:]
        private let cal: Calendar
        init(_ cal: Calendar = .current) { self.cal = cal }
        mutating func at(_ t: Double) -> (day: String, hour: Int, weekday: Int) {
            let bucket = Int(t / 900)
            if let c = cache[bucket] { return c }
            let c = cal.dateComponents([.year, .month, .day, .hour, .weekday], from: Date(timeIntervalSince1970: t))
            let key = String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
            let v = (key, c.hour ?? 0, (c.weekday ?? 1) - 1)
            cache[bucket] = v
            return v
        }
    }

    /// Reads one .jsonl file. `rel` is its path below ~/.claude/projects (the first part is the project folder).
    static func parseFile(_ data: Data, rel: [String]) -> TrailFile {
        let folder = rel.count > 1 ? rel[0] : "unknown"
        let segs = folder.split(separator: "-").map(String.init)
        var file = TrailFile(proj: segs.last ?? folder)
        let sub = rel.contains("subagents")
        var clock = DayClock()
        var modelIndex: [String: Int] = [:]
        var byKey: [String: Int] = [:]
        var timeline: [(Double, Bool)] = []

        for line in data.split(separator: 0x0A, omittingEmptySubsequences: true) where line.count > 2 {
            guard let o = (try? JSONSerialization.jsonObject(with: Data(line))) as? [String: Any],
                  let stamp = o["timestamp"] as? String, let ts = seconds(fromISO: stamp) else { continue }
            let type = o["type"] as? String
            let sidechain = (o["isSidechain"] as? Bool) == true
            if type == "assistant", let msg = o["message"] as? [String: Any] {
                var think = false
                if let content = msg["content"] as? [[String: Any]] {
                    for c in content {
                        let kind = c["type"] as? String
                        if kind == "thinking" { think = true }
                        if kind == "tool_use", (c["name"] as? String) == "Skill", let input = c["input"] as? [String: Any], let skill = input["skill"] as? String, !skill.isEmpty {
                            file.skills[skill, default: 0] += 1
                        }
                    }
                }
                if !sub && !sidechain { timeline.append((ts, false)) }
                let usage = msg["usage"] as? [String: Any]
                let model = msg["model"] as? String
                if model == "<synthetic>" || (usage == nil && !think) { continue }
                let key = (msg["id"] as? String).map { "\($0):\((o["requestId"] as? String) ?? "")" }
                var index = key.flatMap { byKey[$0] }
                if index == nil {
                    let name = model ?? "unknown"
                    if modelIndex[name] == nil { modelIndex[name] = file.models.count; file.models.append(name) }
                    file.recs.append(TrailRec(k: key.map(fnv64) ?? 0, t: ts, m: modelIndex[name]!))
                    index = file.recs.count - 1
                    if let key { byKey[key] = index }
                }
                let i = index!
                if think { file.recs[i].think = true }
                if let u = usage, !file.recs[i].has {
                    func n(_ k: String) -> Int { (u[k] as? Int) ?? Int((u[k] as? Double) ?? 0) }
                    file.recs[i].a = n("input_tokens"); file.recs[i].b = n("output_tokens")
                    file.recs[i].c = n("cache_creation_input_tokens"); file.recs[i].d = n("cache_read_input_tokens")
                    file.recs[i].fast = (u["speed"] as? String) == "fast"
                    file.recs[i].has = true
                    file.tok += file.recs[i].sum
                }
            } else if type == "user" {
                if sub || sidechain { continue }
                var prompt = false
                let content = (o["message"] as? [String: Any])?["content"]
                if content is String { prompt = true }
                else if let blocks = content as? [[String: Any]] { prompt = !blocks.contains { ($0["type"] as? String) == "tool_result" } }
                if (o["isMeta"] as? Bool) == true { prompt = false }
                timeline.append((ts, prompt))
            }
        }
        if !sub && !timeline.isEmpty {
            file.session = true
            let best = longestTask(timeline)
            file.longestMs = best.ms
            file.longestDay = best.start.map { clock.at($0).day }
        }
        return file
    }

    /// The longest "task": one prompt and everything Claude did until the next prompt, with waits over 15 minutes trimmed.
    static func longestTask(_ events: [(Double, Bool)]) -> (ms: Double, start: Double?) {
        var best: (ms: Double, start: Double?) = (0, nil)
        var cur: (start: Double, last: Double, dur: Double)?
        func close() { if let c = cur, c.dur * 1000 > best.ms { best = (c.dur * 1000, c.start) } }
        for e in events.sorted(by: { $0.0 < $1.0 }) {
            if e.1 { close(); cur = (e.0, e.0, 0) }
            else if var c = cur { c.dur += min(e.0 - c.last, 15 * 60); c.last = e.0; cur = c }
        }
        close()
        return best
    }

    // MARK: Building the summary

    /// `files` in a stable order. Replies are de-duplicated across files, because a resumed session replays earlier history into a new file.
    static func build(_ files: [TrailFile], now: Date = Date()) -> TrailSummary {
        var s = TrailSummary()
        var seen = Set<UInt64>()
        var clock = DayClock()
        var events: [(Double, Int)] = []
        var tops: [TrailTop] = []
        func add(_ map: inout [String: [Int]], _ key: String, _ v: [Int]) {
            var a = map[key] ?? [0, 0, 0, 0]
            for i in 0..<4 { a[i] += v[i] }
            map[key] = a
        }
        for f in files {
            s.files += 1
            if f.session { s.sessions += 1 }
            s.longestMs = max(s.longestMs, f.longestMs)
            for (k, v) in f.skills { s.skills[k, default: 0] += v }
            var eTok = 0, eUsd = 0.0, eMsgs = 0, eFirst = Double.infinity
            for r in f.recs {
                if r.k != 0 { guard seen.insert(r.k).inserted else { continue } }
                if r.think { s.thinking += 1 }
                guard r.has else { continue }
                let v = [r.a, r.b, r.c, r.d]
                let when = clock.at(r.t)
                s.hours[when.hour] += r.sum
                s.weekdays[when.weekday] += r.sum
                let model = f.models[r.m]
                add(&s.days, when.day, v); add(&s.models, model, v); add(&s.projects, f.proj, v)
                s.replies += 1
                if r.fast { s.fast += 1 }
                if let usd = TrailPricing.value(model, v) { s.usd[when.day, default: 0] += usd; eUsd += usd } else { s.unpriced += r.sum }
                eTok += r.sum; eMsgs += 1
                eFirst = min(eFirst, r.t)
                events.append((r.t, r.sum))
            }
            if eMsgs > 0 { tops.append(TrailTop(project: f.proj, tokens: eTok, usd: (eUsd * 100).rounded() / 100, replies: eMsgs, day: clock.at(eFirst).day)) }
        }
        s.top = Array(tops.sorted { $0.usd != $1.usd ? $0.usd > $1.usd : $0.tokens > $1.tokens }.prefix(8))

        // 5-hour windows: a new one starts with the first reply after the last one ended, rounded down to the hour.
        events.sort { $0.0 < $1.0 }
        var blocks: [TrailBlock] = []
        for (t, n) in events {
            if blocks.isEmpty || t >= blocks[blocks.count - 1].start + blockLength {
                blocks.append(TrailBlock(start: (t / 3600).rounded(.down) * 3600, first: t, tokens: 0, replies: 0))
            }
            blocks[blocks.count - 1].tokens += n; blocks[blocks.count - 1].replies += 1
        }
        s.peakBlock = blocks.map(\.tokens).max() ?? 0
        s.blocks = Array(blocks.suffix(30))
        s.generated = now
        return s
    }
}

// MARK: - Numbers for the screen

extension TrailSummary {
    func dayTokens(_ key: String, cache: Bool) -> Int {
        guard let v = days[key] else { return 0 }
        return cache ? v.reduce(0, +) : v[0] + v[1]
    }
    func tokens(_ v: [Int], cache: Bool) -> Int { cache ? v.reduce(0, +) : v[0] + v[1] }

    static func key(_ date: Date, _ cal: Calendar = .current) -> String {
        let c = cal.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    func total(cache: Bool) -> Int { days.values.reduce(0) { $0 + tokens($1, cache: cache) } }
    func peakDay(cache: Bool) -> (key: String, tokens: Int)? {
        days.map { ($0.key, tokens($0.value, cache: cache)) }.max { $0.1 < $1.1 }.map { (key: $0.0, tokens: $0.1) }
    }
    func activeDays(cache: Bool) -> Int { days.values.filter { tokens($0, cache: cache) > 0 }.count }

    func lastDays(_ n: Int, cache: Bool, now: Date = Date(), cal: Calendar = .current) -> Int {
        var t = 0
        for i in 0..<n { if let d = cal.date(byAdding: .day, value: -i, to: now) { t += dayTokens(Self.key(d, cal), cache: cache) } }
        return t
    }

    /// Longest run of days in a row with any use, and the run that is still alive today (or yesterday).
    func streaks(now: Date = Date(), cal: Calendar = .current) -> (best: Int, current: Int) {
        let nums = days.filter { $0.value.reduce(0, +) > 0 }.compactMap { TokenTrailLogic.dayNumber($0.key) }.sorted()
        var best = 0, run = 0
        var prev: Int?
        for n in nums {
            run = (prev != nil && n - prev! == 1) ? run + 1 : 1
            best = max(best, run)
            prev = n
        }
        let today = TokenTrailLogic.dayNumber(Self.key(now, cal)) ?? 0
        return (best, (prev != nil && today - prev! <= 1) ? run : 0)
    }

    /// What this usage would cost at public API prices this month (a scale, not a bill).
    func monthSpend(now: Date = Date(), cal: Calendar = .current) -> Double {
        let prefix = String(Self.key(now, cal).prefix(7))
        return usd.filter { $0.key.hasPrefix(prefix) }.values.reduce(0, +)
    }
    var totalUSD: Double { usd.values.reduce(0, +) }

    func cacheRate() -> Int? {
        var fresh = 0, written = 0, read = 0
        for v in models.values { fresh += v[0]; written += v[2]; read += v[3] }
        let all = fresh + written + read
        return all > 0 ? Int((Double(read) / Double(all) * 100).rounded()) : nil
    }

    /// The window you are in now (nil once it has ended).
    func currentBlock(now: Date = Date()) -> TrailBlock? {
        guard let b = blocks.last, now.timeIntervalSince1970 < b.start + TokenTrailLogic.blockLength else { return nil }
        return b
    }

    /// The 53-week grid, Sunday first: `cells[week * 7 + weekday]`, -1 for days that have not happened yet. Levels 1...4 are quartiles of the days that had any use.
    struct Heat {
        var keys: [String] = []
        var values: [Int] = []
        var levels: [Int] = []
        var cuts: (Int, Int, Int) = (0, 0, 0)
        var columns = 53
    }
    func heat(cache: Bool, now: Date = Date(), cal: Calendar = .current) -> Heat {
        var h = Heat()
        let today = cal.startOfDay(for: now)
        let weekday = cal.component(.weekday, from: today) - 1
        guard let start = cal.date(byAdding: .day, value: -(weekday + 52 * 7), to: today) else { return h }
        var positive: [Int] = []
        for i in 0..<(53 * 7) {
            guard let d = cal.date(byAdding: .day, value: i, to: start) else { h.keys.append(""); h.values.append(-1); continue }
            let key = Self.key(d, cal)
            h.keys.append(key)
            if d > today { h.values.append(-1); continue }
            let v = dayTokens(key, cache: cache)
            h.values.append(v)
            if v > 0 { positive.append(v) }
        }
        positive.sort()
        func q(_ p: Double) -> Int { positive.isEmpty ? 0 : positive[min(positive.count - 1, Int(Double(positive.count) * p))] }
        h.cuts = (q(0.25), q(0.5), q(0.75))
        h.levels = h.values.map { v in v < 0 ? -1 : v == 0 ? 0 : v <= h.cuts.0 ? 1 : v <= h.cuts.1 ? 2 : v <= h.cuts.2 ? 3 : 4 }
        return h
    }

    /// 0 under 80% of the budget, 80 from 80%, 100 once it is spent (for the notifications).
    static func budgetStage(spent: Double, budget: Double) -> Int {
        guard budget > 0 else { return 0 }
        return spent >= budget ? 100 : (spent >= budget * 0.8 ? 80 : 0)
    }

    /// The month's spend projected to the end of the month at the pace so far.
    func monthPace(now: Date = Date(), cal: Calendar = .current) -> Double {
        let day = max(1, cal.component(.day, from: now))
        let days = cal.range(of: .day, in: .month, for: now)?.count ?? 30
        return monthSpend(now: now, cal: cal) / Double(day) * Double(days)
    }
}

enum TrailFormat {
    static func tokens(_ n: Int) -> String {
        let v = Double(n)
        func trim(_ x: Double) -> String { x >= 100 ? String(format: "%.0f", x) : (x >= 10 ? String(format: "%.1f", x) : String(format: "%.2f", x)) }
        if v >= 1e9 { return trim(v / 1e9) + "B" }
        if v >= 1e6 { return trim(v / 1e6) + "M" }
        if v >= 1e3 { return trim(v / 1e3) + "K" }
        return String(n)
    }
    static func money(_ v: Double) -> String {
        if v < 100 { return String(format: "$%.2f", v) }
        let f = NumberFormatter()
        f.numberStyle = .decimal; f.maximumFractionDigits = 0
        return "$" + (f.string(from: NSNumber(value: v.rounded())) ?? String(Int(v)))
    }
    static func duration(_ ms: Double) -> String {
        let m = Int((ms / 60000).rounded())
        if m >= 60 { return "\(m / 60)h \(String(format: "%02d", m % 60))m" }
        return m > 0 ? "\(m)m" : (ms > 0 ? "<1m" : "None")
    }
    static func model(_ raw: String) -> String {
        var s = raw.replacingOccurrences(of: "claude-", with: "")
        if let r = s.range(of: #"-\d{8}$"#, options: .regularExpression) { s.removeSubrange(r) }
        return s
    }
}
