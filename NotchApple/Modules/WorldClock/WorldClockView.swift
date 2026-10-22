//
//  WorldClockView.swift
//  Notch Apple
//
//  World clocks in the notch: the time in the cities you care about, with
//  day/night and the difference from your time. Add-on, off by default.
//

import SwiftUI

struct WorldClockView: View {
    @AppStorage("worldClock.zones") private var zonesData = "Europe/London\nAmerica/New_York\nAsia/Tokyo"
    @State private var adding = false
    @State private var search = ""
    @State private var planning = false

    /// Saved as "Zone" or "Zone#Place name" (a city, state or country that shares that zone).
    private var zones: [String] { zonesData.split(separator: "\n").map(String.init).filter { TimeZone(identifier: Self.zoneID($0)) != nil } }

    /// Every country, region with its own time and well-known city, then any zone the list doesn't name.
    private static let options: [(name: String, zone: String, detail: String)] = {
        let named = Set(TimeZonePlaces.all.map(\.zone))
        return TimeZonePlaces.all + TimeZone.knownTimeZoneIdentifiers.filter { !named.contains($0) }.map { (city($0), $0, $0) }
    }()

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("World clock").sectionTitle()
                    Spacer()
                    Button { if Entitlements.shared.canUse(.meetingPlanner) { planning = true } } label: {
                        Label("Plan a meeting", systemImage: Entitlements.shared.canUse(.meetingPlanner) ? "calendar.badge.clock" : "lock.fill")
                    }
                    .buttonStyle(.plain).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.accentBright)
                    .help(Entitlements.shared.canUse(.meetingPlanner) ? Feature.meetingPlanner.benefit : "Pro: \(Feature.meetingPlanner.benefit)")
                    .popover(isPresented: $planning, arrowEdge: .bottom) { MeetingPlanner(zones: zones) }
                    IconButton(systemImage: adding ? "xmark" : "plus", help: adding ? "Done" : "Add a city") { adding.toggle(); search = "" }
                }
                if adding { picker } else { ScrollView { clocks(now: context.date) } }
            }
            .padding(4)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
    }

    private func clocks(now: Date) -> some View {
        // Three flexible columns always fit the notch; more cities scroll.
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(minimum: 0), spacing: 10), count: 3), spacing: 10) {
            ForEach(zones, id: \.self) { id in
                let zone = TimeZone(identifier: Self.zoneID(id))!
                var cal = Calendar.current
                let _ = cal.timeZone = zone
                let hour = cal.component(.hour, from: now)
                GlassCard {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Image(systemName: (7..<19).contains(hour) ? "sun.max.fill" : "moon.stars.fill")
                                .foregroundStyle((7..<19).contains(hour) ? .yellow : Theme.accent)
                            Text(Self.city(id)).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                            Spacer()
                            Button { remove(id) } label: { Image(systemName: "minus.circle").foregroundStyle(Theme.textSecondary) }
                                .buttonStyle(.plain).help("Remove")
                        }
                        Text(now.formatted(Date.FormatStyle(date: .omitted, time: .shortened, timeZone: zone)))
                            .font(.system(size: 26, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(.white)
                            .lineLimit(1).minimumScaleFactor(0.6)
                        Text(Self.offset(zone, now: now)).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    }
                }
            }
        }
    }

    private var picker: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Search a city, state or country", text: $search)
                .textFieldStyle(.plain).padding(8)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(Self.options.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || $0.detail.localizedCaseInsensitiveContains(search) || $0.zone.localizedCaseInsensitiveContains(search) }.prefix(80).enumerated()), id: \.offset) { _, place in
                        Button {
                            let id = place.name == Self.city(place.zone) ? place.zone : "\(place.zone)#\(place.name)"
                            if !zones.contains(id) { zonesData = (zones + [id]).joined(separator: "\n") }
                            adding = false
                        } label: {
                            HStack {
                                Text(place.name).foregroundStyle(.white)
                                Text(place.detail).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                                Spacer()
                            }
                            .padding(.vertical, 4).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func remove(_ id: String) { zonesData = zones.filter { $0 != id }.joined(separator: "\n") }

    static func zoneID(_ id: String) -> String { id.split(separator: "#").first.map(String.init) ?? id }

    static func city(_ id: String) -> String {
        if let hash = id.firstIndex(of: "#") { return String(id[id.index(after: hash)...]) }
        return (id.split(separator: "/").last.map(String.init) ?? id).replacingOccurrences(of: "_", with: " ")
    }

    static func offset(_ zone: TimeZone, now: Date) -> String {
        let diff = zone.secondsFromGMT(for: now) - TimeZone.current.secondsFromGMT(for: now)
        if diff == 0 { return "Same time as you" }
        let h = Double(abs(diff)) / 3600
        let amount = h == h.rounded() ? "\(Int(h)) h" : String(format: "%.1f h", h)
        return diff > 0 ? "\(amount) ahead" : "\(amount) behind"
    }
}
