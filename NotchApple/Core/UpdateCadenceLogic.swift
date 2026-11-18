//
//  UpdateCadenceLogic.swift
//  Notch Apple
//
//  "Update at most once a week": when the person turns it on, Notch Apple stops announcing every release
//  (the notification, the Update button and the reminders in the notch) and offers the newest one once a week
//  instead. Off by default. A release marked as required (security) is always announced, and the version
//  already offered stays visible until it is installed or skipped. Pure rules, so they are tested without the app.
//

import Foundation

enum UpdateCadenceLogic {
    static let interval: TimeInterval = 7 * 86_400

    /// May this release be announced now?
    /// - weekly: the person's switch.
    /// - lastOffer: when something was last announced (nil = never).
    /// - offeredVersion: the version that announcement was about.
    static func mayAnnounce(weekly: Bool, lastOffer: Date?, offeredVersion: String, version: String, now: Date, required: Bool) -> Bool {
        if required || !weekly { return true }
        if version == offeredVersion { return true }          // already on offer: keep showing it
        guard let lastOffer else { return true }               // nothing announced yet: the first one comes through
        return now.timeIntervalSince(lastOffer) >= interval
    }

    /// The "every 4th or 5th time the notch opens" reminder counter. The count is saved between launches, so it has to start
    /// again whenever a reminder is shown (otherwise quitting instead of tapping "Skip for now" left it at 4 or more and the
    /// reminder came straight back on the next launch) and whenever no update is waiting.
    struct ReminderStep: Equatable { var opens: Int; var fire: Bool }
    static func reminderStep(opens: Int, every: Int, updateWaiting: Bool, mayAnnounce: Bool, alreadyShowing: Bool) -> ReminderStep {
        guard updateWaiting else { return ReminderStep(opens: 0, fire: false) }
        guard !alreadyShowing, mayAnnounce else { return ReminderStep(opens: opens, fire: false) }
        let n = opens + 1
        return n >= max(4, every) ? ReminderStep(opens: 0, fire: true) : ReminderStep(opens: n, fire: false)
    }

    /// When the next announcement can happen with the switch on (for the line shown in Settings).
    static func nextOffer(lastOffer: Date?) -> Date? { lastOffer.map { $0.addingTimeInterval(interval) } }
}
