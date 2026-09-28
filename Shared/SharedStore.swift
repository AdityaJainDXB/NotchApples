//
//  SharedStore.swift
//  Shared between the Notch apple app and its WidgetKit extension.
//
//  The widget runs in its own sandboxed process, so anything it needs from the
//  main app (now-playing info, chosen weather location) is written into an
//  App Group `UserDefaults` suite. When the App Group is unavailable (e.g. an
//  unsigned build on a newer macOS that rejects the group), we fall back to
//  `.standard` so neither process crashes — the widget simply shows less data.
//

import Foundation

/// A lightweight snapshot of the current track, written by the app and read by the widget.
public struct NowPlayingSnapshot: Codable, Equatable {
    public var title: String
    public var artist: String
    public var isPlaying: Bool
    public var source: String
    public var updated: Date

    public init(title: String, artist: String, isPlaying: Bool, source: String, updated: Date = .now) {
        self.title = title
        self.artist = artist
        self.isPlaying = isPlaying
        self.source = source
        self.updated = updated
    }
}

/// A saved weather location (resolved once via Open-Meteo geocoding).
public struct WeatherLocation: Codable, Equatable {
    public var name: String
    public var latitude: Double
    public var longitude: Double

    public init(name: String, latitude: Double, longitude: Double) {
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
    }

    /// Cupertino — a sensible default until the user picks a city.
    public static let fallback = WeatherLocation(name: "Cupertino", latitude: 37.323, longitude: -122.032)
}

public enum SharedStore {
    public static let appGroup = "group.com.notchapple.shared"
    public static let widgetKind = "NotchAppleWidget"

    private static let nowPlayingKey = "shared.nowPlaying"
    private static let locationKey = "shared.weatherLocation"

    /// App Group defaults, or `.standard` if the group container can't be opened.
    public static var defaults: UserDefaults {
        UserDefaults(suiteName: appGroup) ?? .standard
    }

    public static var nowPlaying: NowPlayingSnapshot? {
        get { decode(nowPlayingKey) }
        set { encode(newValue, nowPlayingKey) }
    }

    public static var weatherLocation: WeatherLocation {
        get { decode(locationKey) ?? .fallback }
        set { encode(newValue, locationKey) }
    }

    private static func decode<T: Decodable>(_ key: String) -> T? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private static func encode<T: Encodable>(_ value: T?, _ key: String) {
        guard let value, let data = try? JSONEncoder().encode(value) else {
            defaults.removeObject(forKey: key)
            return
        }
        defaults.set(data, forKey: key)
    }
}
