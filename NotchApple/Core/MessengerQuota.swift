//
//  MessengerQuota.swift
//  Notch Apple
//
//  Messenger sends a limited number of text messages a month, and at most 5 in any 10 seconds: 500 on Free, 1,000 on Pro, 5,000 on Ultimate. Only messages you send
//  count (not ones you receive, not files, not game moves), in rooms, nearby chats, friend chats and groups together. The count
//  is kept on this Mac, resets on the first of each month, and nothing about it is sent anywhere. The same numbers are in
//  NotchWindows/src/js/services/messengerquotalogic.js.
//

import Foundation

@MainActor
final class MessengerQuota: ObservableObject {
    static let shared = MessengerQuota()
    private static let key = "messenger.quota"
    @Published private(set) var count: Count
    /// A sentence for the chat screens when a message was stopped, or nil.
    @Published var notice: String?
    /// True when the last message was stopped by a limit: the chat screens then keep the text in the box.
    private(set) var lastBlocked = false
    /// When the last few messages went out (in memory only): the burst limit looks at these.
    private var recentSends: [Date] = []
    typealias Count = MessengerQuotaLogic.Count

    init() {
        let stored = UserDefaults.standard.data(forKey: Self.key).flatMap { try? JSONDecoder().decode(Count.self, from: $0) }
        count = MessengerQuotaLogic.current(stored, now: Date())
    }

    var tier: Tier { Entitlements.shared.tier }
    var limit: Int { MessengerQuotaLogic.limit(for: tier) }
    var used: Int { MessengerQuotaLogic.current(count, now: Date()).used }
    var remaining: Int { max(0, limit - used) }

    /// "120 of 500 messages this month" (always shown short, so it fits in the chat header).
    var summary: String { "\(used) of \(limit) messages this month" }

    /// Counts one message you are about to send. Returns false (and sets `notice`) when this month's messages are used up.
    func consume() -> Bool {
        let now = Date()
        if let wait = MessengerQuotaLogic.burstWait(recent: recentSends, now: now) {
            lastBlocked = true
            notice = "Slow down: 5 messages every 10 seconds. Try again in \(wait) second\(wait == 1 ? "" : "s")."
            return false
        }
        var c = MessengerQuotaLogic.current(count, now: now)
        guard c.used < limit else {
            lastBlocked = true
            notice = MessengerQuotaLogic.limitMessage(tier: tier, limit: limit)
            return false
        }
        lastBlocked = false
        c.used += 1
        count = c
        recentSends = (recentSends + [now]).filter { now.timeIntervalSince($0) < MessengerQuotaLogic.burstWindow }
        if let data = try? JSONEncoder().encode(c) { UserDefaults.standard.set(data, forKey: Self.key) }
        notice = MessengerQuotaLogic.isNearLimit(c, limit: limit) ? "\(remaining) messages left this month." : nil
        return true
    }
}
