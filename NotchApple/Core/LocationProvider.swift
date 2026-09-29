//
//  LocationProvider.swift
//  Notch apple
//
//  Finds your approximate location (city-level) so weather is local instead
//  of the Cupertino default. Asks for permission once; the location is only
//  used for the weather request and to name your city.
//

import CoreLocation
import SwiftUI
import WidgetKit

@MainActor
final class LocationProvider: NSObject, ObservableObject {
    static let shared = LocationProvider()

    /// When on (the default), weather follows your current location.
    @AppStorage("weather.useCurrentLocation") var useCurrentLocation = true
    @Published private(set) var status: CLAuthorizationStatus
    @Published private(set) var cityName: String = SharedStore.weatherLocation.name

    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()
    private var lastUpdate = Date.distantPast

    override init() {
        status = manager.authorizationStatus
        super.init()
        manager.delegate = self
        // City-level accuracy is plenty for weather and uses less power.
        manager.desiredAccuracy = kCLLocationAccuracyReduced
    }

    var isAuthorized: Bool { status == .authorizedAlways || status == .authorized }

    /// Asks for permission if needed, then fetches the location once.
    func requestLocation() {
        guard useCurrentLocation else { return }
        switch status {
        case .notDetermined:
            // Menu-bar apps must be frontmost for the prompt to appear.
            NSApp.activate(ignoringOtherApps: true)
            manager.requestWhenInUseAuthorization()
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
                guard let self else { return }
                self.refreshStatus()
                if self.status == .notDetermined { self.openSystemSettings() }
            }
        case .authorizedAlways, .authorized: refreshIfStale(force: true)
        default: break
        }
    }

    /// Re-reads the permission (e.g. after it was changed in System Settings).
    func refreshStatus() { status = manager.authorizationStatus }

    /// Re-reads the location at most once an hour.
    func refreshIfStale(force: Bool = false) {
        guard useCurrentLocation, isAuthorized else { return }
        guard force || Date.now.timeIntervalSince(lastUpdate) > 3600 else { return }
        lastUpdate = .now
        manager.requestLocation()
    }

    func openSystemSettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices")!)
    }

    private func save(_ location: CLLocation) {
        Task {
            let placemark = try? await geocoder.reverseGeocodeLocation(location).first
            let name = placemark?.locality ?? placemark?.administrativeArea ?? "Current location"
            SharedStore.weatherLocation = WeatherLocation(name: name, latitude: location.coordinate.latitude,
                                                          longitude: location.coordinate.longitude)
            cityName = name
            TodayModel.shared.refresh(forceWeather: true)
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
}

extension LocationProvider: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let s = manager.authorizationStatus
        Task { @MainActor in
            self.status = s
            if self.isAuthorized { self.refreshIfStale(force: true) }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        Task { @MainActor in self.save(location) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
