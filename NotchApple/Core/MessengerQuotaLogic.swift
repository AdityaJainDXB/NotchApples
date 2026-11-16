//
//  MessengerQuotaLogic.swift
//  Notch Apple
//
//  The numbers and the rules behind Messenger's limits (the screen that applies them is MessengerQuota.swift): 500, 1,000 and 5,000
//  messages a month for Free, Pro and Ultimate, and at most 5 in any 10 seconds. Pure logic, no UI.
//

import Foundation

enum MessengerQuotaLogic {
    /// Messages a month for each tier.
    static func limit(for tier: Tier) -> Int {
        switch tier {
        case .free: 500
        case .pro: 1_000
        case .ultimate: 5_000
        }
    }

    /// "2026-11": the month a count belongs to.
    static func monthKey(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month], from: date)
        return String(format: "%04d-%02d", c.year ?? 0, c.month ?? 0)
    }

    /// The burst limit: at most 5 messages in any 10 seconds.
    static let burstMax = 5
    static let burstWindow: TimeInterval = 10

    /// How many seconds to wait before another message may go, or nil when one may go now. `recent` holds when the last messages were sent.
    static func burstWait(recent: [Date], now: Date) -> Int? {
        let inWindow = recent.filter { now.timeIntervalSince($0) < burstWindow }.sorted()
        guard inWindow.count >= burstMax else { return nil }
        let free = inWindow[inWindow.count - burstMax].addingTimeInterval(burstWindow)
        return max(1, Int(free.timeIntervalSince(now).rounded(.up)))
    }

    struct Count: Codable, Equatable { var month: String; var used: Int }

    /// The count for `now`: a count from an earlier month starts again at zero.
    static func current(_ stored: Count?, now: Date, calendar: Calendar = .current) -> Count {
        let key = monthKey(now, calendar: calendar)
        guard let stored, stored.month == key else { return Count(month: key, used: 0) }
        return stored
    }

    static func remaining(_ count: Count, limit: Int) -> Int { max(0, limit - count.used) }
    static func isNearLimit(_ count: Count, limit: Int) -> Bool { count.used >= Int(Double(limit) * 0.8) && count.used < limit }

    /// What to tell the person when they have used all of this month's messages.
    static func limitMessage(tier: Tier, limit: Int) -> String {
        switch tier {
        case .free: "You have used all \(limit) messages for this month. They start again on the 1st, or Pro gives you 1,000 a month."
        case .pro: "You have used all \(limit) messages for this month. They start again on the 1st, or Ultimate gives you 5,000 a month."
        case .ultimate: "You have used all \(limit) messages for this month. They start again on the 1st."
        }
    }
}
