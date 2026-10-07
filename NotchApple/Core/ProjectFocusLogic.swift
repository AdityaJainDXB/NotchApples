//
//  ProjectFocusLogic.swift
//  Notch apple
//
//  Focus minutes by project (Pro). The log is "2026-10-07|Website" → minutes, so a day's total stays in the
//  ordinary focus history and the project split is extra. Pure rules, no storage, so they can be tested
//  and the Windows app (projectfocus.js) can run the same vectors.
//

import Foundation

enum ProjectFocusLogic {
    static let maxName = 24

    /// Trimmed, single-spaced, at most 24 characters. Empty means "no project".
    static func clean(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).joined(separator: " ")
        return String(words.prefix(maxName)).trimmingCharacters(in: .whitespaces)
    }

    static func key(day: String, project: String) -> String { "\(day)|\(clean(project))" }

    /// Adds minutes to a project's day. Nothing is logged when there is no project or no minutes.
    static func add(_ log: [String: Int], day: String, project: String, minutes: Int) -> [String: Int] {
        let p = clean(project)
        guard !p.isEmpty, minutes > 0 else { return log }
        var out = log
        out[key(day: day, project: p), default: 0] += minutes
        return out
    }

    /// Totals per project over the given days (ISO date strings), biggest first, ties by name.
    static func totals(_ log: [String: Int], days: [String]) -> [(project: String, minutes: Int)] {
        let wanted = Set(days)
        var sums: [String: Int] = [:]
        for (k, v) in log {
            guard let bar = k.firstIndex(of: "|") else { continue }
            if wanted.contains(String(k[..<bar])) { sums[String(k[k.index(after: bar)...]), default: 0] += v }
        }
        return sums.map { (project: $0.key, minutes: $0.value) }
            .sorted { $0.minutes != $1.minutes ? $0.minutes > $1.minutes : $0.project < $1.project }
    }

    /// Drops entries older than `cutoff` (an ISO date; those sort the same as dates).
    static func prune(_ log: [String: Int], before cutoff: String) -> [String: Int] {
        log.filter { k, _ in (k.split(separator: "|", maxSplits: 1).first.map(String.init) ?? "") >= cutoff }
    }

    /// Every project name used, most recent first isn't tracked; alphabetical keeps the picker steady.
    static func names(_ log: [String: Int]) -> [String] {
        Array(Set(log.keys.compactMap { k in k.firstIndex(of: "|").map { String(k[k.index(after: $0)...]) } })).sorted()
    }
}
