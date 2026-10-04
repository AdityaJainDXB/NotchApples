//
//  PeekView.swift
//  Notch apple
//
//  The "peek" state between closed and open: resting the pointer on the notch
//  shows a one-line glance just below it (what's playing, your next event today,
//  or the weather, plus the time). It never takes clicks; clicking the notch opens it.
//

import EventKit
import SwiftUI

struct PeekView: View {
    let symbol: String
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol).foregroundStyle(Theme.accentBright)
            Text(text).lineLimit(1).foregroundStyle(.white)
            Text(Date.now.formatted(date: .omitted, time: .shortened)).foregroundStyle(Theme.textSecondary).monospacedDigit()
        }
        .font(.system(size: 12, weight: .semibold))
        .fontDesign(StylePrefs.fontDesign)
        .padding(.horizontal, 14).padding(.vertical, 7)
        .background(Capsule().fill(.black))
        .overlay(Capsule().strokeBorder(Theme.separator))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .combine)
    }

    /// The most useful single line right now.
    @MainActor static func current() -> (symbol: String, text: String) {
        // The screenshot build never shows what's playing on this Mac.
        if !DemoHooks.isDemo, let t = NowPlayingMonitor.shared.current, t.isPlaying, !t.title.isEmpty {
            return ("music.note", t.artist.isEmpty ? t.title : "\(t.title) · \(t.artist)")
        }
        if EKEventStore.authorizationStatus(for: .event) == .fullAccess {
            let store = EKEventStore()
            let end = Calendar.current.startOfDay(for: .now).addingTimeInterval(86_400)
            if let e = store.events(matching: store.predicateForEvents(withStart: .now, end: end, calendars: nil))
                .filter({ !$0.isAllDay }).min(by: { $0.startDate < $1.startDate }) {
                return ("calendar", "\(e.title ?? "Event") at \(e.startDate.formatted(date: .omitted, time: .shortened))")
            }
        }
        if let w = TodayModel.shared.weather { return (w.symbol, "\(Int(w.temperature.rounded()))° \(w.summary)") }
        return ("calendar", Date.now.formatted(.dateTime.weekday(.wide).day().month()))
    }
}
