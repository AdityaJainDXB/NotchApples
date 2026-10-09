//
//  RadarLogic.swift
//  Notch apple
//
//  Flight Radar: the aircraft around you, from adsb.lol's free public ADS-B feed (no account or key). This file has
//  no screens in it so it can be tested: reading the feed, the distance and bearing from you, where an aircraft
//  sits on the radar, and the words and colours for altitude and aircraft type. NotchWindows/src/js/services/
//  radarlogic.js mirrors it and shares its test vectors.
//

import Foundation

struct RadarAircraft: Identifiable, Equatable {
    let id: String              // the ICAO hex code
    var callsign: String
    var type: String            // ICAO type code, e.g. "A320"
    var registration: String
    var altitudeFt: Int?        // nil on the ground
    var onGround: Bool
    var speedKt: Int
    var track: Double           // degrees, 0 = north
    var climbFpm: Int
    var lat: Double
    var lon: Double
    var distanceNM: Double
    var bearing: Double         // degrees from you to the aircraft
}

enum RadarLogic {
    static let earthRadiusNM = 3440.065
    static let ranges = [25, 50, 100, 200]

    /// Rounded to about a kilometre before it is sent, which is all the feed needs.
    static func roundedCoordinate(_ v: Double) -> Double { (v * 100).rounded() / 100 }

    static func url(lat: Double, lon: Double, rangeNM: Int) -> URL? {
        URL(string: "https://api.adsb.lol/v2/point/\(String(format: "%.2f", roundedCoordinate(lat)))/\(String(format: "%.2f", roundedCoordinate(lon)))/\(min(max(rangeNM, 1), 250))")
    }

    /// Great-circle distance in nautical miles.
    static func distanceNM(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let r = Double.pi / 180
        let dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r
        let a = sin(dLat / 2) * sin(dLat / 2) + cos(lat1 * r) * cos(lat2 * r) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * earthRadiusNM * asin(min(1, sqrt(a)))
    }

    /// Initial bearing from point 1 to point 2, 0…360 (0 = north).
    static func bearing(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let r = Double.pi / 180
        let dLon = (lon2 - lon1) * r
        let y = sin(dLon) * cos(lat2 * r)
        let x = cos(lat1 * r) * sin(lat2 * r) - sin(lat1 * r) * cos(lat2 * r) * cos(dLon)
        let deg = atan2(y, x) / r
        return (deg + 360).truncatingRemainder(dividingBy: 360)
    }

    /// Reads the feed's `ac` list. Aircraft without a position are skipped; the rest are sorted nearest first.
    static func parse(_ data: Data, lat: Double, lon: Double, limit: Int = 80) -> [RadarAircraft] {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = (root["ac"] as? [[String: Any]]) ?? (root["aircraft"] as? [[String: Any]]) else { return [] }
        var out: [RadarAircraft] = []
        for a in list {
            guard let alat = (a["lat"] as? NSNumber)?.doubleValue, let alon = (a["lon"] as? NSNumber)?.doubleValue,
                  let hex = a["hex"] as? String else { continue }
            var alt: Int?
            var ground = false
            if let s = a["alt_baro"] as? String { ground = s.lowercased() == "ground" }
            else if let n = a["alt_baro"] as? NSNumber { alt = n.intValue }
            let call = ((a["flight"] as? String) ?? "").trimmingCharacters(in: .whitespaces)
            out.append(RadarAircraft(
                id: hex, callsign: call.isEmpty ? ((a["r"] as? String) ?? hex.uppercased()) : call,
                type: ((a["t"] as? String) ?? "").uppercased(), registration: (a["r"] as? String) ?? "",
                altitudeFt: ground ? nil : alt, onGround: ground,
                speedKt: Int(((a["gs"] as? NSNumber)?.doubleValue ?? 0).rounded()),
                track: (a["track"] as? NSNumber)?.doubleValue ?? (a["true_heading"] as? NSNumber)?.doubleValue ?? 0,
                climbFpm: (a["baro_rate"] as? NSNumber)?.intValue ?? 0,
                lat: alat, lon: alon,
                distanceNM: distanceNM(lat1: lat, lon1: lon, lat2: alat, lon2: alon),
                bearing: bearing(lat1: lat, lon1: lon, lat2: alat, lon2: alon)))
        }
        return Array(out.sorted { $0.distanceNM < $1.distanceNM }.prefix(limit))
    }

    /// Where an aircraft sits on the radar: x right, y down, each -1…1 with north up and the edge at `rangeNM`.
    static func position(distanceNM: Double, bearing: Double, rangeNM: Int) -> (x: Double, y: Double) {
        let d = min(distanceNM / Double(max(rangeNM, 1)), 1.05), b = bearing * Double.pi / 180
        return (sin(b) * d, -cos(b) * d)
    }

    /// "FL350" up high, "4,500 ft" lower, "ground" on the ground.
    static func altitudeLabel(_ ft: Int?, onGround: Bool) -> String {
        if onGround { return "ground" }
        guard let ft else { return "—" }
        if ft >= 18_000 { return "FL\(ft / 100)" }
        let f = NumberFormatter(); f.numberStyle = .decimal; f.groupingSeparator = ","
        return "\(f.string(from: NSNumber(value: ft)) ?? "\(ft)") ft"
    }

    enum Band { case ground, low, mid, high }
    static func band(_ ft: Int?, onGround: Bool) -> Band {
        if onGround { return .ground }
        guard let ft else { return .low }
        return ft < 5_000 ? .low : ft < 18_000 ? .mid : .high
    }

    /// Readable names for common ICAO type codes; anything else shows its code.
    static let typeNames: [String: String] = [
        "A318": "Airbus A318", "A319": "Airbus A319", "A320": "Airbus A320", "A321": "Airbus A321", "A20N": "Airbus A320neo", "A21N": "Airbus A321neo",
        "A332": "Airbus A330-200", "A333": "Airbus A330-300", "A338": "Airbus A330-800", "A339": "Airbus A330-900", "A342": "Airbus A340-200", "A343": "Airbus A340-300", "A346": "Airbus A340-600",
        "A359": "Airbus A350-900", "A35K": "Airbus A350-1000", "A388": "Airbus A380-800",
        "B737": "Boeing 737", "B738": "Boeing 737-800", "B739": "Boeing 737-900", "B38M": "Boeing 737 MAX 8", "B39M": "Boeing 737 MAX 9", "B734": "Boeing 737-400",
        "B744": "Boeing 747-400", "B748": "Boeing 747-8", "B752": "Boeing 757-200", "B763": "Boeing 767-300", "B772": "Boeing 777-200", "B77L": "Boeing 777-200LR",
        "B77W": "Boeing 777-300ER", "B788": "Boeing 787-8", "B789": "Boeing 787-9", "B78X": "Boeing 787-10",
        "E170": "Embraer 170", "E190": "Embraer 190", "E195": "Embraer 195", "E75L": "Embraer 175", "CRJ9": "CRJ-900", "AT76": "ATR 72", "DH8D": "Dash 8 Q400",
        "C172": "Cessna 172", "C182": "Cessna 182", "C208": "Cessna Caravan", "PA28": "Piper Cherokee", "SR22": "Cirrus SR22", "BE20": "King Air 200",
        "GLF5": "Gulfstream V", "GLEX": "Bombardier Global Express", "C56X": "Citation Excel", "H25B": "Hawker 800", "R44": "Robinson R44", "EC35": "Airbus H135",
    ]

    static func typeName(_ code: String) -> String {
        let c = code.uppercased()
        return typeNames[c] ?? (c.isEmpty ? "Unknown type" : c)
    }

    /// "NNE", "SW"… for a bearing in degrees.
    static func compass(_ degrees: Double) -> String {
        let names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
        let i = Int(((degrees.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) + 11.25) / 22.5) % 16
        return names[i]
    }
}
