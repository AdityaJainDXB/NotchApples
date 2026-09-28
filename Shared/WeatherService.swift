//
//  WeatherService.swift
//  Shared weather fetching for the app and widget.
//
//  Zero-cost by default: uses Open-Meteo (free, no API key, no account).
//  Apple WeatherKit requires a paid Apple Developer membership plus the
//  `com.apple.developer.weatherkit` entitlement, so it is compiled in only when
//  the `WEATHERKIT` Swift flag is set (see README → "Enabling WeatherKit").
//

import Foundation
#if WEATHERKIT
import WeatherKit
import CoreLocation
#endif

public struct WeatherSnapshot: Codable, Equatable {
    public var temperature: Double   // °C
    public var symbol: String        // SF Symbol name
    public var summary: String
    public var location: String
}

public enum WeatherService {

    /// Fetches current conditions for a location.
    public static func current(for location: WeatherLocation) async throws -> WeatherSnapshot {
        #if WEATHERKIT
        let loc = CLLocation(latitude: location.latitude, longitude: location.longitude)
        let w = try await WeatherKit.WeatherService.shared.weather(for: loc, including: .current)
        return WeatherSnapshot(temperature: w.temperature.converted(to: .celsius).value,
                               symbol: w.symbolName,
                               summary: w.condition.description,
                               location: location.name)
        #else
        return try await openMeteo(location)
        #endif
    }

    /// Resolves a free-text city name to coordinates using Open-Meteo's geocoder.
    public static func geocode(_ query: String) async throws -> WeatherLocation? {
        var comps = URLComponents(string: "https://geocoding-api.open-meteo.com/v1/search")!
        comps.queryItems = [.init(name: "name", value: query), .init(name: "count", value: "1")]
        struct Resp: Decodable { struct R: Decodable { let name: String; let latitude: Double; let longitude: Double }; let results: [R]? }
        let (data, _) = try await URLSession.shared.data(from: comps.url!)
        guard let r = try JSONDecoder().decode(Resp.self, from: data).results?.first else { return nil }
        return WeatherLocation(name: r.name, latitude: r.latitude, longitude: r.longitude)
    }

    private static func openMeteo(_ location: WeatherLocation) async throws -> WeatherSnapshot {
        var comps = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        comps.queryItems = [
            .init(name: "latitude", value: String(location.latitude)),
            .init(name: "longitude", value: String(location.longitude)),
            .init(name: "current", value: "temperature_2m,weather_code,is_day"),
        ]
        struct Resp: Decodable {
            struct C: Decodable { let temperature_2m: Double; let weather_code: Int; let is_day: Int }
            let current: C
        }
        let (data, _) = try await URLSession.shared.data(from: comps.url!)
        let c = try JSONDecoder().decode(Resp.self, from: data).current
        let (symbol, summary) = describe(code: c.weather_code, isDay: c.is_day == 1)
        return WeatherSnapshot(temperature: c.temperature_2m, symbol: symbol, summary: summary, location: location.name)
    }

    /// Maps WMO weather codes to SF Symbols and a short description.
    static func describe(code: Int, isDay: Bool) -> (String, String) {
        switch code {
        case 0: return (isDay ? "sun.max.fill" : "moon.stars.fill", "Clear")
        case 1, 2: return (isDay ? "cloud.sun.fill" : "cloud.moon.fill", "Partly cloudy")
        case 3: return ("cloud.fill", "Overcast")
        case 45, 48: return ("cloud.fog.fill", "Fog")
        case 51...57: return ("cloud.drizzle.fill", "Drizzle")
        case 61...67, 80...82: return ("cloud.rain.fill", "Rain")
        case 71...77, 85, 86: return ("cloud.snow.fill", "Snow")
        case 95...99: return ("cloud.bolt.rain.fill", "Thunderstorm")
        default: return ("cloud.fill", "—")
        }
    }
}
