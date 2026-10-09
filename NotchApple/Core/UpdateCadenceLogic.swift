//
//  UpdateCadenceLogic.swift
//  Notch apple
//
//  "Update at most once a week": when the person turns it on, Notch apple stops announcing every release
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

    /// When the next announcement can happen with the switch on (for the line shown in Settings).
    static func nextOffer(lastOffer: Date?) -> Date? { lastOffer.map { $0.addingTimeInterval(interval) } }
}
