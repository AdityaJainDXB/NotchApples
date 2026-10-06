//
//  WellbeingLogic.swift
//  Notch apple
//
//  The rules behind break reminders (eyes, water, stretch, posture), the breathing exercise, the bedtime nudge,
//  the daily focus goal and date countdowns. Plain numbers and date keys only (no clocks or screens), so it can be
//  tested and behaves the same in any time zone. The Windows app has the same rules in services/wellbeing.js.
//

import Foundation

enum WellbeingLogic {
    // MARK: Break reminders

    enum Break: String, CaseIterable, Identifiable {
        case eyes, water, stretch, posture
        var id: String { rawValue }
        var title: String { ["eyes": "Rest your eyes", "water": "Drink some water", "stretch": "Stand up and stretch", "posture": "Check your posture"][rawValue]! }
        var message: String {
            ["eyes": "Look at something 20 feet (6 m) away for 20 seconds.", "water": "A glass of water keeps you sharp.",
             "stretch": "Roll your shoulders and stretch your neck and back.", "posture": "Sit tall, relax your shoulders, feet flat."][rawValue]!
        }
        var symbol: String { ["eyes": "eye", "water": "drop.fill", "stretch": "figure.cooldown", "posture": "figure.stand"][rawValue]! }
        var defaultMinutes: Int { ["eyes": 20, "water": 60, "stretch": 45, "posture": 30][rawValue]! }
    }

    struct BreakSetting: Equatable { var on: Bool; var everyMinutes: Int }

    /// Is `minuteOfDay` (0...1439) inside the hours you want reminders in? Handles ranges that run past midnight.
    static func isActive(minuteOfDay m: Int, from: Int, to: Int) -> Bool {
        from == to ? true : (from < to ? (m >= from && m < to) : (m >= from || m < to))
    }

    /// The one reminder to show now, or nil. `last` is when each was last shown (ms since 1970); a reminder that has
    /// never been shown starts its clock at `startedMs`, so you aren't nagged the moment you switch it on.
    static func nextDue(now nowMs: Int64, startedMs: Int64, last: [Break: Int64], settings: [Break: BreakSetting],
                        minuteOfDay: Int, from: Int, to: Int, snoozedUntilMs: Int64 = 0) -> Break? {
        guard nowMs >= snoozedUntilMs, isActive(minuteOfDay: minuteOfDay, from: from, to: to) else { return nil }
        var best: (kind: Break, overdue: Int64)?
        for kind in Break.allCases {
            guard let s = settings[kind], s.on, s.everyMinutes > 0 else { continue }
            let since = nowMs - (last[kind] ?? startedMs)
            let overdue = since - Int64(s.everyMinutes) * 60_000
            if overdue >= 0, best == nil || overdue > best!.overdue { best = (kind, overdue) }
        }
        return best?.kind
    }

    // MARK: Breathing

    struct Pattern: Equatable, Identifiable {
        let id: String
        let name: String
        let phases: [(label: String, seconds: Double)]
        var cycle: Double { phases.reduce(0) { $0 + $1.seconds } }
        static func == (a: Pattern, b: Pattern) -> Bool { a.id == b.id }

        static let box = Pattern(id: "box", name: "Box 4-4-4-4", phases: [("Breathe in", 4), ("Hold", 4), ("Breathe out", 4), ("Hold", 4)])
        static let calm = Pattern(id: "478", name: "Calm 4-7-8", phases: [("Breathe in", 4), ("Hold", 7), ("Breathe out", 8)])
        static let relax = Pattern(id: "55", name: "Relax 5-5", phases: [("Breathe in", 5), ("Breathe out", 5)])
        static let all = [box, calm, relax]
    }

    struct BreathState: Equatable { let label: String; let size: Double; let secondsLeft: Int; let cycles: Int }

    /// What the circle should show `elapsed` seconds in: the phase, how big the circle is (0 small ... 1 full), and a countdown.
    static func breath(_ p: Pattern, elapsed: Double) -> BreathState {
        let cycle = p.cycle, t = max(0, elapsed).truncatingRemainder(dividingBy: cycle)
        var start = 0.0, size = 0.0
        var current = p.phases[0], index = 0
        for (i, ph) in p.phases.enumerated() { if t < start + ph.seconds { current = ph; index = i; break }; start += ph.seconds }
        let within = (t - start) / current.seconds
        switch current.label {
        case "Breathe in": size = within
        case "Breathe out": size = 1 - within
        default: size = index > 0 && p.phases[index - 1].label == "Breathe in" ? 1 : 0   // a hold keeps the size it had
        }
        return BreathState(label: current.label, size: size, secondsLeft: Int((current.seconds - (t - start)).rounded(.up)), cycles: Int(max(0, elapsed) / cycle))
    }

    // MARK: Bedtime

    /// Time for the wind-down nudge? From `lead` minutes before bedtime until an hour after, once per day.
    static func bedtimeDue(minuteOfDay m: Int, bedtime: Int, lead: Int, lastDayKey: String, todayKey: String) -> Bool {
        guard lastDayKey != todayKey else { return false }
        let start = (bedtime - lead + 1440) % 1440
        return isActive(minuteOfDay: m, from: start, to: (bedtime + 60) % 1440)
    }

    // MARK: Goals and countdowns

    /// 0...1 of a daily goal done (nothing set means 0).
    static func goalFraction(minutes: Int, goal: Int) -> Double { goal > 0 ? min(1, Double(minutes) / Double(goal)) : 0 }

    /// Whole days from one "yyyy-MM-dd" to another (negative when it has passed). nil for bad dates.
    static func daysBetween(_ from: String, _ to: String) -> Int? {
        func day(_ s: String) -> Int? {
            let p = s.split(separator: "-").compactMap { Int($0) }
            guard p.count == 3, (1...12).contains(p[1]), (1...31).contains(p[2]) else { return nil }
            var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!
            guard let d = c.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) else { return nil }
            return Int((d.timeIntervalSince1970 / 86400).rounded())
        }
        guard let a = day(from), let b = day(to) else { return nil }
        return b - a
    }

    static func countdownLabel(days: Int) -> String {
        switch days {
        case 0: "Today"
        case 1: "Tomorrow"
        case -1: "Yesterday"
        case ..<0: "\(-days) days ago"
        default: "In \(days) days"
        }
    }
}
