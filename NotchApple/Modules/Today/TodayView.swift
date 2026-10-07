//
//  TodayView.swift
//  Notch apple
//
//  The data behind the Home page: the date, current weather (free Open-Meteo data, same
//  location as the widget), your next calendar events and battery. (The screen itself is HomeScreenView.)
//

import SwiftUI
import EventKit

@MainActor
final class TodayModel: ObservableObject {
    static let shared = TodayModel()

    struct Event: Identifiable {
        let id: String
        let title: String
        let start: Date
        let end: Date
        let isAllDay: Bool
        let color: Color
        var joinURL: URL? = nil
    }

    @Published private(set) var weather: WeatherSnapshot?
    @Published private(set) var events: [Event] = []
    @Published private(set) var calendarAccess: EKAuthorizationStatus = EKEventStore.authorizationStatus(for: .event)
    @Published private(set) var battery = LiveActivityCenter.battery()

    private let store = EKEventStore()
    private var lastWeatherFetch = Date.distantPast

    func refresh(forceWeather: Bool = false) {
        battery = LiveActivityCenter.battery()
        loadEvents()
        LocationProvider.shared.refreshIfStale()
        // Weather changes slowly; refresh at most every 15 minutes.
        if forceWeather || Date.now.timeIntervalSince(lastWeatherFetch) > 900 {
            lastWeatherFetch = .now
            Task { weather = try? await WeatherService.current(for: SharedStore.weatherLocation) }
        }
    }

    func requestCalendarAccess() {
        NSApp.activate(ignoringOtherApps: true)   // menu-bar apps must be frontmost to show the prompt
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
            if EKEventStore.authorizationStatus(for: .event) != .fullAccess { PermissionsModel.openPrivacy("Privacy_Calendars") }
            self.refresh()
        }
        Task {
            _ = try? await store.requestFullAccessToEvents()
            calendarAccess = EKEventStore.authorizationStatus(for: .event)
            loadEvents()
        }
    }

    private func loadEvents() {
        calendarAccess = EKEventStore.authorizationStatus(for: .event)
        guard calendarAccess == .fullAccess else { events = []; return }
        let startOfDay = Calendar.current.startOfDay(for: .now)
        let predicate = store.predicateForEvents(withStart: startOfDay, end: .now.addingTimeInterval(86_400 * 2), calendars: nil)
        events = store.events(matching: predicate)
            .filter { $0.endDate > .now }
            .sorted { $0.startDate < $1.startDate }
            .prefix(5)
            .map { Event(id: $0.eventIdentifier ?? UUID().uuidString, title: $0.title ?? "Event", start: $0.startDate,
                         end: $0.endDate, isAllDay: $0.isAllDay, color: Color(nsColor: $0.calendar.color),
                         joinURL: MeetingLinks.find(in: $0)) }
    }
}

/// "Week" next to today's weather (Pro).
struct ForecastButton: View {
    @State private var showing = false
    var body: some View {
        Button { if Entitlements.shared.canUse(.forecast) { showing = true } } label: {
            HStack(spacing: 3) {
                Text("Week").font(.system(size: 11, weight: .semibold))
                if !Entitlements.shared.canUse(.forecast) { Image(systemName: "lock.fill").font(.system(size: 8)) }
            }
            .foregroundStyle(Theme.accentBright)
        }
        .buttonStyle(.plain)
        .help(Entitlements.shared.canUse(.forecast) ? "Hourly and 7-day forecast" : "Pro: \(Feature.forecast.benefit)")
        .popover(isPresented: $showing, arrowEdge: .bottom) { ForecastView() }
    }
}
