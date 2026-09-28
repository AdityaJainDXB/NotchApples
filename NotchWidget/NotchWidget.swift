//
//  NotchWidget.swift
//  NotchWidget (WidgetKit extension)
//
//  A unified desktop / Lock Screen widget showing weather, now playing and
//  the next calendar events.
//
//   • Weather   — Open-Meteo (free) or WeatherKit when built with `WEATHERKIT`.
//   • Music     — snapshot written by the main app into the App Group.
//   • Calendar  — EventKit, read directly by the extension.
//

import WidgetKit
import SwiftUI
import EventKit
import CoreLocation

struct NotchEntry: TimelineEntry {
    let date: Date
    let weather: WeatherSnapshot?
    let nowPlaying: NowPlayingSnapshot?
    let events: [EventItem]
}

struct EventItem: Hashable {
    let title: String
    let start: Date
    let color: Color
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> NotchEntry {
        NotchEntry(date: .now,
                   weather: WeatherSnapshot(temperature: 21, symbol: "sun.max.fill", summary: "Clear", location: "Cupertino"),
                   nowPlaying: NowPlayingSnapshot(title: "Midnight City", artist: "M83", isPlaying: true, source: "Music"),
                   events: [EventItem(title: "Design review", start: .now.addingTimeInterval(3600), color: .purple)])
    }

    func getSnapshot(in context: Context, completion: @escaping (NotchEntry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        Task { completion(await makeEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NotchEntry>) -> Void) {
        Task {
            let entry = await makeEntry()
            // Refresh every 30 min; the app also forces reloads on track changes.
            completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(1800))))
        }
    }

    private func makeEntry() async -> NotchEntry {
        let weather = try? await WeatherService.current(for: await Self.weatherLocation())
        return NotchEntry(date: .now, weather: weather, nowPlaying: SharedStore.nowPlaying, events: await upcomingEvents())
    }

    /// Uses the Mac's current location when Notch apple has location permission
    /// (widgets share their app's permission), otherwise the saved city.
    private static func weatherLocation() async -> WeatherLocation {
        let manager = CLLocationManager()
        guard [.authorizedAlways, .authorized].contains(manager.authorizationStatus),
              let loc = manager.location else { return SharedStore.weatherLocation }
        let name = (try? await CLGeocoder().reverseGeocodeLocation(loc))?.first?.locality ?? "My location"
        return WeatherLocation(name: name, latitude: loc.coordinate.latitude, longitude: loc.coordinate.longitude)
    }

    private func upcomingEvents() async -> [EventItem] {
        let store = EKEventStore()
        var granted = EKEventStore.authorizationStatus(for: .event) == .fullAccess
        if !granted { granted = (try? await store.requestFullAccessToEvents()) ?? false }
        guard granted else { return [] }
        let predicate = store.predicateForEvents(withStart: .now, end: .now.addingTimeInterval(86_400 * 2), calendars: nil)
        return store.events(matching: predicate)
            .filter { !$0.isAllDay }
            .sorted { $0.startDate < $1.startDate }
            .prefix(5)
            .map { EventItem(title: $0.title ?? "Event", start: $0.startDate, color: Color(nsColor: $0.calendar.color)) }
    }
}

// MARK: Views

private let purple = Color(red: 0.62, green: 0.42, blue: 1.0)
private let widgetBackground = LinearGradient(
    colors: [Color(red: 0.05, green: 0.02, blue: 0.10), Color(red: 0.22, green: 0.09, blue: 0.42)],
    startPoint: .topLeading, endPoint: .bottomTrailing)

struct NotchWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NotchEntry

    var body: some View {
        switch family {
        case .systemSmall: small
        case .systemLarge: large
        default: medium
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 6) {
            weatherBlock
            Spacer(minLength: 0)
            musicBlock
        }
        .foregroundStyle(.white)
    }

    private var medium: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                weatherBlock
                Spacer(minLength: 0)
                musicBlock
            }
            Divider().overlay(Color.white.opacity(0.15))
            VStack(alignment: .leading, spacing: 6) {
                Text("UP NEXT").font(.system(size: 10, weight: .bold)).foregroundStyle(purple)
                if entry.events.isEmpty {
                    Text("No upcoming events").font(.caption).foregroundStyle(.white.opacity(0.6))
                }
                ForEach(entry.events, id: \.self) { e in
                    HStack(spacing: 6) {
                        Capsule().fill(e.color).frame(width: 3, height: 26)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(e.title).font(.caption.weight(.semibold)).lineLimit(1)
                            Text(e.start, style: .time).font(.caption2).foregroundStyle(.white.opacity(0.6))
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .foregroundStyle(.white)
    }

    private var large: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) { weatherBlock }
                Spacer()
                Text(entry.date, format: .dateTime.weekday(.wide).day().month())
                    .font(.caption.weight(.semibold)).foregroundStyle(.white.opacity(0.7))
            }
            Divider().overlay(Color.white.opacity(0.15))
            Text("UP NEXT").font(.system(size: 10, weight: .bold)).foregroundStyle(purple)
            if entry.events.isEmpty {
                Text("No upcoming events").font(.caption).foregroundStyle(.white.opacity(0.6))
            }
            ForEach(entry.events, id: \.self) { e in
                HStack(spacing: 8) {
                    Capsule().fill(e.color).frame(width: 4, height: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(e.title).font(.callout.weight(.semibold)).lineLimit(1)
                        Text(e.start, format: .dateTime.weekday(.abbreviated).hour().minute())
                            .font(.caption).foregroundStyle(.white.opacity(0.6))
                    }
                }
            }
            Spacer(minLength: 0)
            Divider().overlay(Color.white.opacity(0.15))
            musicBlock
        }
        .foregroundStyle(.white)
    }

    @ViewBuilder private var weatherBlock: some View {
        if let w = entry.weather {
            HStack(spacing: 6) {
                Image(systemName: w.symbol).symbolRenderingMode(.multicolor).font(.title2)
                Text("\(Int(w.temperature.rounded()))°").font(.system(size: 28, weight: .bold, design: .rounded))
            }
            Text("\(w.location) · \(w.summary)").font(.caption2).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
        } else {
            Label("Weather unavailable", systemImage: "cloud").font(.caption)
        }
    }

    @ViewBuilder private var musicBlock: some View {
        if let np = entry.nowPlaying, !np.title.isEmpty {
            HStack(spacing: 6) {
                Image(systemName: np.isPlaying ? "waveform" : "pause.fill").foregroundStyle(purple)
                VStack(alignment: .leading, spacing: 0) {
                    Text(np.title).font(.caption.weight(.semibold)).lineLimit(1)
                    Text(np.artist).font(.caption2).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
                }
            }
        } else {
            Label("Not playing", systemImage: "music.note").font(.caption2).foregroundStyle(.white.opacity(0.6))
        }
    }
}

@main
struct NotchAppleWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: SharedStore.widgetKind, provider: Provider()) { entry in
            NotchWidgetView(entry: entry)
                .containerBackground(for: .widget) { widgetBackground }
        }
        .configurationDisplayName("Notch apple")
        .description("Weather, now playing and your next events.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
