//
//  ForecastView.swift
//  Notch apple
//
//  Pro weather: the next 12 hours and 7 days, for your location and up to
//  five more cities, from Open-Meteo (free, no key). Only the cities'
//  coordinates are sent.
//

import SwiftUI

struct DayForecast: Identifiable {
    var id: Date { date }
    let date: Date
    let high: Double
    let low: Double
    let symbol: String
    let rain: Int   // % chance
}

struct HourForecast: Identifiable {
    var id: Date { date }
    let date: Date
    let temp: Double
    let symbol: String
}

enum Forecast {
    static func load(_ loc: WeatherLocation) async -> (days: [DayForecast], hours: [HourForecast])? {
        var c = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        c.queryItems = [
            .init(name: "latitude", value: String(loc.latitude)), .init(name: "longitude", value: String(loc.longitude)),
            .init(name: "daily", value: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"),
            .init(name: "hourly", value: "temperature_2m,weather_code,is_day"),
            .init(name: "forecast_days", value: "7"), .init(name: "timezone", value: "auto"),
        ]
        struct R: Decodable {
            struct D: Decodable { let time: [String]; let weather_code: [Int]; let temperature_2m_max: [Double]; let temperature_2m_min: [Double]; let precipitation_probability_max: [Int?] }
            struct H: Decodable { let time: [String]; let temperature_2m: [Double]; let weather_code: [Int]; let is_day: [Int] }
            let daily: D; let hourly: H; let utc_offset_seconds: Int
        }
        guard let (data, _) = try? await URLSession.shared.data(from: c.url!), let r = try? JSONDecoder().decode(R.self, from: data) else { return nil }
        let dayFmt = DateFormatter(); dayFmt.dateFormat = "yyyy-MM-dd"
        let hourFmt = DateFormatter(); hourFmt.dateFormat = "yyyy-MM-dd'T'HH:mm"
        for f in [dayFmt, hourFmt] { f.timeZone = TimeZone(secondsFromGMT: r.utc_offset_seconds); f.locale = Locale(identifier: "en_US_POSIX") }
        let days = r.daily.time.indices.compactMap { i -> DayForecast? in
            guard let d = dayFmt.date(from: r.daily.time[i]) else { return nil }
            return DayForecast(date: d, high: r.daily.temperature_2m_max[i], low: r.daily.temperature_2m_min[i],
                               symbol: WeatherService.describe(code: r.daily.weather_code[i], isDay: true).0, rain: r.daily.precipitation_probability_max[i] ?? 0)
        }
        let hours = r.hourly.time.indices.compactMap { i -> HourForecast? in
            guard let d = hourFmt.date(from: r.hourly.time[i]), d > .now.addingTimeInterval(-3600) else { return nil }
            return HourForecast(date: d, temp: r.hourly.temperature_2m[i], symbol: WeatherService.describe(code: r.hourly.weather_code[i], isDay: r.hourly.is_day[i] == 1).0)
        }.prefix(12)
        return (days, Array(hours))
    }
}

struct ForecastView: View {
    @AppStorage("weather.cities") private var citiesData = Data()
    @State private var selected = 0
    @State private var data: (days: [DayForecast], hours: [HourForecast])?
    @State private var newCity = ""
    @State private var problem: String?

    private var cities: [WeatherLocation] { [SharedStore.weatherLocation] + ((try? JSONDecoder().decode([WeatherLocation].self, from: citiesData)) ?? []) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Picker("", selection: $selected) {
                    ForEach(cities.indices, id: \.self) { Text(cities[$0].name).tag($0) }
                }.labelsHidden().fixedSize()
                Spacer()
                TextField("Add a city", text: $newCity).textFieldStyle(.roundedBorder).frame(width: 140).onSubmit(addCity)
                if selected > 0 {
                    Button { remove(selected) } label: { Image(systemName: "minus.circle") }.buttonStyle(.plain).help("Remove this city")
                }
            }
            if let problem { Text(problem).font(.caption).foregroundStyle(.orange) }
            if let data {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(data.hours) { h in
                            VStack(spacing: 4) {
                                Text(h.date.formatted(.dateTime.hour())).font(.caption2).foregroundStyle(.secondary)
                                Image(systemName: h.symbol).symbolRenderingMode(.multicolor)
                                Text("\(Int(h.temp.rounded()))°").font(.caption.weight(.semibold))
                            }
                        }
                    }
                }
                Divider()
                ForEach(data.days) { d in
                    HStack {
                        Text(Calendar.current.isDateInToday(d.date) ? "Today" : d.date.formatted(.dateTime.weekday(.wide))).frame(width: 90, alignment: .leading)
                        Image(systemName: d.symbol).symbolRenderingMode(.multicolor).frame(width: 24)
                        Text(d.rain > 0 ? "\(d.rain)%" : "").font(.caption).foregroundStyle(.cyan).frame(width: 36)
                        Spacer()
                        Text("\(Int(d.low.rounded()))°").foregroundStyle(.secondary).monospacedDigit()
                        Text("\(Int(d.high.rounded()))°").fontWeight(.semibold).monospacedDigit()
                    }
                    .font(.callout)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
            Text("Open-Meteo forecast").font(.caption2).foregroundStyle(.tertiary)
        }
        .padding(14).frame(width: 380)
        .task(id: selected) { data = nil; data = await Forecast.load(cities[min(selected, cities.count - 1)]) }
    }

    private func addCity() {
        let q = newCity.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, cities.count < 6 else { return }
        Task {
            if let loc = try? await WeatherService.geocode(q) {
                var list = Array(cities.dropFirst()); list.append(loc)
                citiesData = (try? JSONEncoder().encode(list)) ?? Data()
                selected = list.count
                newCity = ""; problem = nil
            } else { problem = "Couldn't find \(q)." }
        }
    }

    private func remove(_ i: Int) {
        var list = Array(cities.dropFirst())
        guard list.indices.contains(i - 1) else { return }
        list.remove(at: i - 1)
        citiesData = (try? JSONEncoder().encode(list)) ?? Data()
        selected = 0
    }
}
