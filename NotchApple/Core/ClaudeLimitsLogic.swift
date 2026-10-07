//
//  ClaudeLimitsLogic.swift
//  Notch apple
//
//  Your real Claude limits (the percentage of the 5-hour session and of the week that you have used, and when each
//  resets) as Claude reports them, instead of a guess from local token counts. This file only reads the data:
//  the usage reply, and the sign-in Claude Code keeps in the macOS keychain. No network and no keychain access
//  here, so it can be tested.
//

import Foundation
import CryptoKit

struct ClaudeLimit: Equatable {
    /// 0…1 of the limit used (can pass 1 if Claude says so).
    let fraction: Double
    let resetsAt: Date?
    var percent: Int { Int((fraction * 100).rounded()) }
}

struct ClaudeLimits: Equatable {
    var fiveHour: ClaudeLimit?
    var sevenDay: ClaudeLimit?
    var sevenDayOpus: ClaudeLimit?
    var sevenDaySonnet: ClaudeLimit?
    var isEmpty: Bool { fiveHour == nil && sevenDay == nil }
}

enum ClaudeLimitsLogic {
    static let fiveHourLength: TimeInterval = 5 * 3600
    static let sevenDayLength: TimeInterval = 7 * 86_400

    // MARK: The usage reply

    /// Reads the usage reply: `{"five_hour": {"utilization": 25.0, "resets_at": "…"}, "seven_day": {…}, …}`.
    /// Anything missing or odd is skipped rather than failing the whole read.
    static func parse(_ data: Data) -> ClaudeLimits? {
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        func limit(_ key: String) -> ClaudeLimit? {
            guard let o = obj[key] as? [String: Any] else { return nil }
            let raw = o["utilization"] ?? o["used_percentage"] ?? o["percent"]
            let percent: Double?
            if let d = raw as? Double { percent = d }
            else if let i = raw as? Int { percent = Double(i) }
            else if let s = raw as? String { percent = Double(s) }
            else { percent = nil }
            guard let p = percent, p.isFinite, p >= 0 else { return nil }
            return ClaudeLimit(fraction: p / 100, resetsAt: (o["resets_at"] as? String).flatMap(date(from:)))
        }
        let result = ClaudeLimits(fiveHour: limit("five_hour"), sevenDay: limit("seven_day"),
                                  sevenDayOpus: limit("seven_day_opus"), sevenDaySonnet: limit("seven_day_sonnet"))
        return result.isEmpty ? nil : result
    }

    /// ISO-8601 with or without fractional seconds, including six-digit microseconds and a +00:00 offset.
    static func date(from iso: String) -> Date? {
        let trimmed = iso.replacingOccurrences(of: #"\.(\d{3})\d+"#, with: ".$1", options: .regularExpression)
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: trimmed) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: trimmed.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression))
    }

    // MARK: Claude Code's saved sign-in

    struct Credential: Equatable {
        let token: String
        let expiresAt: Date?
        func isExpired(now: Date = Date()) -> Bool { (expiresAt ?? .distantFuture) <= now.addingTimeInterval(30) }
    }

    /// The keychain item is `{"claudeAiOauth": {"accessToken": "…", "expiresAt": <milliseconds>, …}}`.
    static func credential(from data: Data) -> Credential? {
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let oauth = root["claudeAiOauth"] as? [String: Any],
              let token = oauth["accessToken"] as? String, !token.isEmpty else { return nil }
        var expires: Date?
        if let ms = oauth["expiresAt"] as? Double { expires = Date(timeIntervalSince1970: ms / 1000) }
        else if let ms = oauth["expiresAt"] as? Int { expires = Date(timeIntervalSince1970: Double(ms) / 1000) }
        return Credential(token: token, expiresAt: expires)
    }

    // MARK: The usage headers (when the usage endpoint is unavailable)

    /// Every Claude reply carries the account's limits as headers: `anthropic-ratelimit-unified-5h-utilization`
    /// (0…1) and `-5h-reset` (Unix seconds), and the same for `7d`. Names are matched ignoring case.
    static func parse(headers: [String: String]) -> ClaudeLimits? {
        let lower = Dictionary(headers.map { ($0.key.lowercased(), $0.value) }, uniquingKeysWith: { a, _ in a })
        func limit(_ window: String) -> ClaudeLimit? {
            guard let raw = lower["anthropic-ratelimit-unified-\(window)-utilization"], let u = Double(raw), u.isFinite, u >= 0 else { return nil }
            var reset: Date?
            if let r = lower["anthropic-ratelimit-unified-\(window)-reset"], let t = Double(r), t > 0 {
                reset = Date(timeIntervalSince1970: t > 1e11 ? t / 1000 : t)
            }
            return ClaudeLimit(fraction: u, resetsAt: reset)
        }
        let result = ClaudeLimits(fiveHour: limit("5h"), sevenDay: limit("7d"), sevenDayOpus: limit("7d_opus"), sevenDaySonnet: limit("7d_sonnet"))
        return result.isEmpty ? nil : result
    }

    // MARK: Where Claude Code keeps its sign-in

    static let keychainService = "Claude Code-credentials"

    /// Claude Code 2.1.52+ may store the sign-in as `Claude Code-credentials-<hash>`. Reads the service names out of
    /// `security dump-keychain` output (names only, no secrets), the plain name first.
    static func credentialServices(fromDump dump: String) -> [String] {
        var found: [String] = []
        for line in dump.split(separator: "\n") where line.contains("\"svce\"") {
            guard let open = line.range(of: "=\""), let close = line.range(of: "\"", range: open.upperBound..<line.endIndex) else { continue }
            let name = String(line[open.upperBound..<close.lowerBound])
            if name.hasPrefix(keychainService), !found.contains(name) { found.append(name) }
        }
        return found.sorted { ($0 == keychainService ? 0 : 1, $0) < ($1 == keychainService ? 0 : 1, $1) }
    }

    // MARK: Alerts and projection

    /// Percent levels that raise an alert, lowest first.
    static let alertLevels = [80, 95]

    /// How many alert levels `fraction` has reached (0, 1 or 2).
    static func alertLevel(_ fraction: Double) -> Int {
        alertLevels.filter { fraction * 100 >= Double($0) }.count
    }

    /// Alert only when the level rose, and start again from zero once the window has reset (a new reset time).
    static func alertDue(level: Int, lastLevel: Int, lastReset: Date?, reset: Date?) -> Bool {
        let sameWindow = lastReset == nil || reset == nil || abs(lastReset!.timeIntervalSince(reset!)) < 120
        return level > (sameWindow ? lastLevel : 0)
    }

    /// Seconds until the limit is full at the pace so far, only if that happens before the reset.
    static func timeToLimit(_ limit: ClaudeLimit, length: TimeInterval, now: Date = Date()) -> TimeInterval? {
        guard let reset = limit.resetsAt, limit.fraction > 0.02, limit.fraction < 1 else { return nil }
        let untilReset = reset.timeIntervalSince(now)
        let elapsed = length - untilReset
        guard untilReset > 0, elapsed > 60 else { return nil }
        let left = (1 - limit.fraction) / (limit.fraction / elapsed)
        return left < untilReset ? left : nil
    }

    /// "1h 20m", "45m".
    static func duration(_ seconds: TimeInterval) -> String {
        let m = max(1, Int((seconds / 60).rounded()))
        if m >= 1440 { return "\(m / 1440)d \((m % 1440) / 60)h" }
        return m >= 60 ? "\(m / 60)h \(m % 60)m" : "\(m)m"
    }

    // MARK: Pace and wording

    /// Green / yellow / red for a real limit, using how far through its period you are.
    static func pace(_ limit: ClaudeLimit, length: TimeInterval, now: Date = Date()) -> UsagePace {
        let elapsed = limit.resetsAt.map { length - max(0, min(length, $0.timeIntervalSince(now))) } ?? length
        // Claude's percentage is already "used of the limit", so the budget is 100.
        return ClaudeUsageLogic.pace(used: Int((limit.fraction * 1000).rounded()), budget: 1000, elapsed: elapsed, length: length)
            ?? UsagePace(light: .green, fraction: limit.fraction, projected: nil)
    }

    /// "Today 7:50 PM", "Tomorrow 5:00 AM", "Oct 9, 5:00 AM".
    static func resetText(_ date: Date?, now: Date = Date(), calendar: Calendar = .current) -> String {
        guard let date else { return "Reset time unknown" }
        let time = date.formatted(date: .omitted, time: .shortened)
        if calendar.isDate(date, inSameDayAs: now) { return "Today \(time)" }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(date, inSameDayAs: tomorrow) { return "Tomorrow \(time)" }
        return date.formatted(.dateTime.month(.abbreviated).day()) + ", " + time
    }
}


// MARK: - History (the last 30 days of your limits)

struct ClaudeUsageSample: Codable, Equatable {
    var account: String
    var time: Date
    var fiveHour: Double?      // 0…1
    var sevenDay: Double?
}

struct ClaudeUsageDay: Equatable, Identifiable {
    var id: Date { day }
    let day: Date
    let fiveHourPeak: Double?
    let sevenDayPeak: Double?
}

enum ClaudeHistoryLogic {
    static let keepDays = 30
    static let minGap: TimeInterval = 10 * 60

    /// Adds a sample at most every 10 minutes per account and drops anything older than 30 days.
    static func appended(_ samples: [ClaudeUsageSample], _ new: ClaudeUsageSample, now: Date = Date()) -> [ClaudeUsageSample] {
        var list = samples.filter { now.timeIntervalSince($0.time) < Double(keepDays) * 86_400 }
        if let last = list.last(where: { $0.account == new.account }), new.time.timeIntervalSince(last.time) < minGap { return list }
        list.append(new)
        return list
    }

    /// One entry per calendar day, oldest first, for the last `days` days (days with no samples are nil peaks).
    static func dailyPeaks(_ samples: [ClaudeUsageSample], account: String, days: Int = keepDays, now: Date = Date(), calendar: Calendar = .current) -> [ClaudeUsageDay] {
        let today = calendar.startOfDay(for: now)
        let mine = samples.filter { $0.account == account }
        return (0..<days).reversed().compactMap { back in
            guard let day = calendar.date(byAdding: .day, value: -back, to: today) else { return nil }
            let of = mine.filter { calendar.isDate($0.time, inSameDayAs: day) }
            return ClaudeUsageDay(day: day, fiveHourPeak: of.compactMap(\.fiveHour).max(), sevenDayPeak: of.compactMap(\.sevenDay).max())
        }
    }
}

// MARK: - Several Claude accounts

struct ClaudeAccount: Identifiable, Equatable {
    /// The keychain service name that holds this account's sign-in.
    let service: String
    var label: String
    var id: String { service }
}

enum ClaudeAccountLogic {
    /// Claude Code keeps the default `~/.claude` sign-in under the plain name and any other config folder under
    /// `Claude Code-credentials-<first 8 hex of SHA-256 of the folder path>`.
    static func service(forConfigDir path: String, home: String) -> String {
        if path == home + "/.claude" { return ClaudeLimitsLogic.keychainService }
        let hex = SHA256.hash(data: Data(path.utf8)).map { String(format: "%02x", $0) }.joined()
        return ClaudeLimitsLogic.keychainService + "-" + String(hex.prefix(8))
    }

    /// A name for each service: the email Claude Code recorded for it, else "Account 2", "Account 3"…
    static func accounts(services: [String], emails: [String: String]) -> [ClaudeAccount] {
        services.enumerated().map { i, svc in
            ClaudeAccount(service: svc, label: emails[svc] ?? (services.count == 1 ? "Claude account" : "Account \(i + 1)"))
        }
    }

    /// The account to show: your pick if it still exists, else the first.
    static func active(_ accounts: [ClaudeAccount], picked: String) -> ClaudeAccount? {
        accounts.first { $0.service == picked } ?? accounts.first
    }
}
