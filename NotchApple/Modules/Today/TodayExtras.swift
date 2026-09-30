//
//  TodayExtras.swift
//  Notch apple
//
//  Background helpers for the Today tab:
//   • MeetingWatcher: finds the Zoom / Meet / Teams / Webex link in upcoming
//     calendar events and, from 2 minutes before, shows "Join" beside the
//     notch. Clicking the notch then opens Today with a Join button.
//   • RainWatcher: checks Open-Meteo's 15-minute precipitation forecast and
//     warns "rain in 15 min" beside the notch before it starts.
//

import AppKit
import EventKit
import SwiftUI

enum MeetingLinks {
    private static let pattern = #"https://[^\s<>"']*(zoom\.us/j/|zoom\.us/my/|meet\.google\.com/|teams\.microsoft\.com/l/meetup-join|teams\.live\.com/meet|webex\.com/|whereby\.com/|facetime\.apple\.com/join)[^\s<>"']*"#

    /// The first video-call link in an event's URL, location or notes.
    static func find(in event: EKEvent) -> URL? {
        let fields = [event.url?.absoluteString, event.location, event.notes].compactMap { $0 }
        for field in fields {
            if let range = field.range(of: pattern, options: .regularExpression), let url = URL(string: String(field[range])) { return url }
        }
        return nil
    }
}

@MainActor
final class MeetingWatcher: ObservableObject {
    static let shared = MeetingWatcher()

    struct Meeting: Equatable {
        let title: String
        let start: Date
        let url: URL
    }

    @Published private(set) var imminent: Meeting?
    private let store = EKEventStore()
    private var notified: Set<String> = []

    var liveActivity: LiveActivity? {
        guard let m = imminent else { return nil }
        return LiveActivity(symbol: "video.fill", label: m.start > .now ? "Join" : "Now", tint: .systemGreen)
    }

    func check() {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { imminent = nil; return }
        let events = store.events(matching: store.predicateForEvents(withStart: .now.addingTimeInterval(-600), end: .now.addingTimeInterval(180), calendars: nil))
        // From 2 minutes before until 5 minutes after the start.
        let next = events
            .filter { !$0.isAllDay && $0.startDate.timeIntervalSinceNow < 125 && $0.startDate.timeIntervalSinceNow > -300 }
            .sorted { $0.startDate < $1.startDate }
            .lazy.compactMap { e in MeetingLinks.find(in: e).map { Meeting(title: e.title ?? "Meeting", start: e.startDate, url: $0) } }
            .first
        if next != imminent {
            imminent = next
            LiveActivityCenter.shared.recompute()
        }
        if let next, !notified.contains(next.url.absoluteString + "\(next.start)") {
            notified.insert(next.url.absoluteString + "\(next.start)")
            NSSound(named: "Ping")?.play()
        }
    }

    func join() {
        guard let m = imminent else { return }
        NSWorkspace.shared.open(m.url)
        AppDelegate.current?.notch?.closeNotch()
    }
}

@MainActor
final class RainWatcher: ObservableObject {
    static let shared = RainWatcher()

    /// e.g. "Rain in 15 min", or nil when it's dry for the next two hours.
    @Published private(set) var summary: String?
    private var lastCheck = Date.distantPast
    private var alertedFor: Date?

    func checkIfDue() {
        guard Date.now.timeIntervalSince(lastCheck) > 900 else { return }
        lastCheck = .now
        let loc = SharedStore.weatherLocation
        Task {
            var comps = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
            comps.queryItems = [
                .init(name: "latitude", value: String(loc.latitude)), .init(name: "longitude", value: String(loc.longitude)),
                .init(name: "minutely_15", value: "precipitation"), .init(name: "forecast_minutely_15", value: "9"),
                .init(name: "timezone", value: "GMT"),
            ]
            struct Resp: Decodable {
                struct M: Decodable { let time: [String]; let precipitation: [Double?] }
                let minutely_15: M
            }
            guard let (data, _) = try? await URLSession.shared.data(from: comps.url!),
                  let r = try? JSONDecoder().decode(Resp.self, from: data) else { return }
            let f = DateFormatter()
            f.dateFormat = "yyyy-MM-dd'T'HH:mm"
            f.timeZone = TimeZone(identifier: "GMT")
            let slots = zip(r.minutely_15.time, r.minutely_15.precipitation).compactMap { t, p -> (Date, Double)? in
                guard let d = f.date(from: t) else { return nil }
                return (d, p ?? 0)
            }
            .filter { $0.0.addingTimeInterval(900) > .now }
            apply(slots)
        }
    }

    private func apply(_ slots: [(Date, Double)]) {
        let wet = { (p: Double) in p >= 0.1 }
        guard let first = slots.first else { summary = nil; return }
        if wet(first.1) { summary = "Raining now"; return }
        guard let rain = slots.first(where: { wet($0.1) }) else { summary = nil; return }
        let minutes = max(15, Int((rain.0.timeIntervalSinceNow / 60 / 15).rounded()) * 15)
        summary = "Rain in \(minutes) min"
        // One alert per rain spell.
        if alertedFor == nil || abs(alertedFor!.timeIntervalSince(rain.0)) > 3600 {
            alertedFor = rain.0
            LiveActivityCenter.shared.flash(LiveActivity(symbol: "cloud.rain.fill", label: "\(minutes)m", tint: .systemCyan), seconds: 8)
            Notifier.post(title: "Rain in about \(minutes) minutes", body: "Take an umbrella if you're heading out.")
        }
    }
}
