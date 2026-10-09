//
//  RadarModel.swift
//  Notch apple
//
//  Flight Radar's data: the aircraft within a range of where you are (the same place as your weather: your current
//  location if you allowed it, otherwise the city you chose), from adsb.lol's free public feed. It asks only while
//  the tab is open, every 10 seconds, and sends your position rounded to about a kilometre. Nothing is stored.
//

import AppKit
import SwiftUI

@MainActor
final class RadarModel: ObservableObject {
    static let shared = RadarModel()

    @Published private(set) var aircraft: [RadarAircraft] = []
    @Published private(set) var loading = false
    @Published private(set) var error: String?
    @Published private(set) var updated: Date?
    @Published var selected: String?
    @Published var viewing = false { didSet { if viewing { refresh() }; schedule() } }

    @AppStorage("radar.range") var range = 100 { didSet { refresh() } }
    @AppStorage("radar.ground") var showGround = false { didSet { objectWillChange.send() } }

    private var timer: Timer?
    private var task: Task<Void, Never>?

    var place: WeatherLocation { SharedStore.weatherLocation }

    /// What the radar shows: airborne aircraft, plus the ones on the ground if you asked for them.
    var visible: [RadarAircraft] { aircraft.filter { showGround || !$0.onGround } }

    private func schedule() {
        timer?.invalidate(); timer = nil
        guard viewing else { task?.cancel(); return }
        timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { _ in
            MainActor.assumeIsolated { RadarModel.shared.refresh() }
        }
    }

    func refresh() {
        guard viewing || !aircraft.isEmpty else { return }
        let p = place
        guard let url = RadarLogic.url(lat: p.latitude, lon: p.longitude, rangeNM: range) else { return }
        task?.cancel()
        loading = true
        task = Task {
            var req = URLRequest(url: url, timeoutInterval: 12)
            req.setValue("NotchApple", forHTTPHeaderField: "User-Agent")
            do {
                let (data, response) = try await URLSession.shared.data(for: req)
                guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false else { throw URLError(.badServerResponse) }
                if Task.isCancelled { return }
                aircraft = RadarLogic.parse(data, lat: p.latitude, lon: p.longitude)
                if let s = selected, !aircraft.contains(where: { $0.id == s }) { selected = nil }
                error = nil
                updated = .now
            } catch {
                if Task.isCancelled { return }
                self.error = "Couldn't reach the flight feed. Trying again in a few seconds."
            }
            loading = false
        }
    }
}
