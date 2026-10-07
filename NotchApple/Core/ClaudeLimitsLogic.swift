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
