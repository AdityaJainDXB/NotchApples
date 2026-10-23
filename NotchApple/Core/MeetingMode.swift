//
//  MeetingMode.swift
//  Notch Apple
//
//  Meeting mode: while you are on a call (the camera is on, or the microphone has been in use for 20 seconds), the
//  notch goes quiet. Music, scores, notification flashes and the hello stay away; volume and brightness still show.
//  Beside the notch: the camera or microphone (crossed out when muted) and the minutes left in the calendar meeting
//  you are in, or how long the call has been going. It ends by itself when the camera and microphone stop.
//

import AppKit
import EventKit

@MainActor
final class MeetingMode: ObservableObject {
    static let shared = MeetingMode()
    static let key = "notch.meetingMode"

    @Published private(set) var active = false
    private(set) var since: Date?
    private var micSince: Date?
    private let store = EKEventStore()
    private var event: (title: String, end: Date)?

    var enabled: Bool { UserDefaults.standard.object(forKey: Self.key) as? Bool ?? true }

    /// Called whenever the microphone or camera changes, and on the regular heartbeat.
    func refresh() {
        let p = PrivacyMonitor.shared
        micSince = p.micInUse ? (micSince ?? .now) : nil
        let onCall = enabled && (p.cameraInUse || (micSince.map { Date.now.timeIntervalSince($0) > 20 } ?? false))
        if onCall != active {
            active = onCall
            since = onCall ? .now : nil
        }
        event = onCall ? currentEvent() : nil
        LiveActivityCenter.shared.recompute()
    }

    /// The calendar event happening right now (if the calendar is allowed), for "12m left".
    private func currentEvent() -> (title: String, end: Date)? {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { return nil }
        let now = Date.now
        return store.events(matching: store.predicateForEvents(withStart: now.addingTimeInterval(-6 * 3600), end: now.addingTimeInterval(60), calendars: nil))
            .filter { !$0.isAllDay && $0.startDate <= now && $0.endDate > now }
            .min { $0.endDate < $1.endDate }
            .map { ($0.title ?? "Meeting", $0.endDate) }
    }

    var liveActivity: LiveActivity? {
        guard active else { return nil }
        let p = PrivacyMonitor.shared
        let symbol = p.cameraInUse ? "video.fill" : (p.micMuted ? "mic.slash.fill" : "mic.fill")
        let tint: NSColor = p.micMuted ? .systemGray : (p.cameraInUse ? .systemGreen : .systemOrange)
        if let e = event {
            let left = max(0, Int(ceil(e.end.timeIntervalSinceNow / 60)))
            return LiveActivity(symbol: symbol, label: "\(left)m left", tint: tint, leftText: String(e.title.prefix(12)))
        }
        let mins = Int(Date.now.timeIntervalSince(since ?? .now) / 60)
        return LiveActivity(symbol: symbol, label: mins < 1 ? "On call" : "\(mins)m", tint: tint)
    }
}
