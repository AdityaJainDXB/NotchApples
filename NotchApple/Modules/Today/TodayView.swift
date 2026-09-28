//
//  TodayView.swift
//  Notch apple
//
//  Today at a glance: the date, current weather (free Open-Meteo data, same
//  location as the widget), your next calendar events and battery.
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
                         end: $0.endDate, isAllDay: $0.isAllDay, color: Color(nsColor: $0.calendar.color)) }
    }
}

struct TodayView: View {
    @StateObject private var model = TodayModel.shared
    @StateObject private var location = LocationProvider.shared

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            GlassCard {
                VStack(alignment: .leading, spacing: 10) {
                    Text(Date.now.formatted(.dateTime.weekday(.wide))).sectionTitle()
                    Text(Date.now.formatted(.dateTime.day().month(.wide)))
                        .font(.system(size: 26, weight: .bold, design: .rounded)).foregroundStyle(.white)

                    if let w = model.weather {
                        HStack(spacing: 8) {
                            Image(systemName: w.symbol).symbolRenderingMode(.multicolor).font(.system(size: 28))
                            VStack(alignment: .leading, spacing: 0) {
                                Text("\(Int(w.temperature.rounded()))°").font(.system(size: 24, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.white)
                                Text("\(w.summary) · \(w.location)").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                            }
                        }
                    } else {
                        Label("Loading weather…", systemImage: "cloud").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    }
                    if location.useCurrentLocation && location.status == .notDetermined {
                        Button { location.requestLocation() } label: { Label("Use my location", systemImage: "location.fill") }
                            .buttonStyle(PurpleButtonStyle(prominent: false))
                    } else if location.useCurrentLocation && !location.isAuthorized {
                        Button("Allow location in Settings…", action: location.openSystemSettings)
                            .buttonStyle(PurpleButtonStyle(prominent: false))
                    }

                    Spacer(minLength: 0)
                    if let b = model.battery {
                        Label("\(b.percent)%\(b.charging ? " · charging" : b.pluggedIn ? " · plugged in" : "")",
                              systemImage: b.charging ? "battery.100percent.bolt" : LiveActivityCenter.batterySymbol(b.percent))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(b.percent <= 20 && !b.pluggedIn ? .red : Theme.textSecondary)
                    }
                }
            }
            .frame(width: 230)

            GlassCard {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Up next").sectionTitle()
                    switch model.calendarAccess {
                    case .fullAccess:
                        if model.events.isEmpty {
                            Text("Nothing else on your calendar today or tomorrow.")
                                .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                        }
                        ForEach(model.events) { event in
                            HStack(spacing: 10) {
                                Capsule().fill(event.color).frame(width: 4, height: 34)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(event.title).font(.system(size: 13, weight: .medium)).foregroundStyle(.white).lineLimit(1)
                                    Text(timeText(event)).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                if event.start <= .now && event.end > .now {
                                    Text("Now").font(.system(size: 10, weight: .bold)).padding(.horizontal, 6).padding(.vertical, 2)
                                        .background(Theme.accent.opacity(0.4), in: Capsule())
                                }
                            }
                        }
                    case .notDetermined:
                        Text("See your next events here.").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                        Button("Allow calendar access", action: model.requestCalendarAccess).buttonStyle(PurpleButtonStyle())
                    default:
                        Text("Calendar access is off. Turn it on in System Settings → Privacy & Security → Calendars.")
                            .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .onAppear {
            model.refresh()
            // First time: ask for location so weather is local, not Cupertino.
            if location.useCurrentLocation && location.status == .notDetermined { location.requestLocation() }
        }
    }

    private func timeText(_ e: TodayModel.Event) -> String {
        let day = Calendar.current.isDateInToday(e.start) ? "Today" : "Tomorrow"
        if e.isAllDay { return "\(day) · All day" }
        return "\(day) · \(e.start.formatted(date: .omitted, time: .shortened)) – \(e.end.formatted(date: .omitted, time: .shortened))"
    }
}
