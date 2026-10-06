//
//  HabitLogic.swift
//  Notch apple
//
//  Streaks for the habit tracker: how many days in a row you've done something, your best run, and the last few days
//  as ticks. Days are "yyyy-MM-dd" keys and the arithmetic is done on dates alone (no clocks or time zones), so it
//  behaves the same everywhere. The Windows app has the same rules in services/habits.js and the same test cases.
//

import Foundation

enum HabitLogic {
    private static var utc: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }

    /// A day key moved by `n` days (negative goes back).
    static func addDays(_ key: String, _ n: Int) -> String? {
        let p = key.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3, let d = utc.date(from: DateComponents(year: p[0], month: p[1], day: p[2])),
              let moved = utc.date(byAdding: .day, value: n, to: d) else { return nil }
        let c = utc.dateComponents([.year, .month, .day], from: moved)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// The last `count` days ending today, oldest first.
    static func lastDays(_ count: Int, today: String) -> [String] { (0..<count).reversed().compactMap { addDays(today, -$0) } }

    /// Days in a row up to today. If today isn't done yet the run still counts through yesterday, so a streak isn't
    /// shown as broken until a whole day has been missed.
    static func currentStreak(_ done: Set<String>, today: String) -> Int {
        var day = done.contains(today) ? today : (addDays(today, -1) ?? today)
        var n = 0
        while done.contains(day) { n += 1; guard let prev = addDays(day, -1) else { break }; day = prev }
        return n
    }

    /// The longest run of consecutive days ever.
    static func bestStreak(_ done: Set<String>) -> Int {
        var best = 0
        for start in done where !done.contains(addDays(start, -1) ?? "") {
            var n = 0, day = start
            while done.contains(day) { n += 1; guard let next = addDays(day, 1) else { break }; day = next }
            best = max(best, n)
        }
        return best
    }

    /// How many of the last 7 days (including today) are done.
    static func thisWeek(_ done: Set<String>, today: String) -> Int { lastDays(7, today: today).filter(done.contains).count }
}
