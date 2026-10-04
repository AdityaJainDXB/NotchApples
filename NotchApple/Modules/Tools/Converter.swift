//
//  Converter.swift
//  Notch apple
//
//  Pro: unit and currency conversion in the Tools calculator. Type
//  "5 km to mi", "72 f in c", "3 cups to ml" or "100 usd to eur".
//  Units use Foundation's Measurement; currency rates come from
//  open.er-api.com (free, no key, updated daily) and are cached for 12 hours.
//

import Foundation

enum Converter {
    struct Query: Equatable { let amount: Double; let from: String; let to: String }

    /// "5 km to mi" → Query(5, "km", "mi"). Units are lower-cased; currencies upper-cased later.
    static func parse(_ input: String) -> Query? {
        let s = input.lowercased().trimmingCharacters(in: .whitespaces)
        guard let re = try? NSRegularExpression(pattern: #"^([0-9]+(?:\.[0-9]+)?)\s*([a-z°$€£¥]+)\s+(?:to|in|as|=)\s+([a-z°$€£¥]+)$"#),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
              let a = Range(m.range(at: 1), in: s), let f = Range(m.range(at: 2), in: s), let t = Range(m.range(at: 3), in: s),
              let amount = Double(s[a]) else { return nil }
        return Query(amount: amount, from: String(s[f]), to: String(s[t]))
    }

    static let units: [String: Unit] = [
        // length
        "mm": UnitLength.millimeters, "cm": UnitLength.centimeters, "m": UnitLength.meters, "km": UnitLength.kilometers,
        "in": UnitLength.inches, "inch": UnitLength.inches, "inches": UnitLength.inches, "ft": UnitLength.feet, "feet": UnitLength.feet,
        "yd": UnitLength.yards, "mi": UnitLength.miles, "mile": UnitLength.miles, "miles": UnitLength.miles, "nmi": UnitLength.nauticalMiles,
        // mass
        "mg": UnitMass.milligrams, "g": UnitMass.grams, "kg": UnitMass.kilograms, "lb": UnitMass.pounds, "lbs": UnitMass.pounds,
        "oz": UnitMass.ounces, "st": UnitMass.stones, "t": UnitMass.metricTons,
        // temperature
        "c": UnitTemperature.celsius, "°c": UnitTemperature.celsius, "f": UnitTemperature.fahrenheit, "°f": UnitTemperature.fahrenheit, "k": UnitTemperature.kelvin,
        // volume
        "ml": UnitVolume.milliliters, "l": UnitVolume.liters, "cup": UnitVolume.cups, "cups": UnitVolume.cups,
        "tsp": UnitVolume.teaspoons, "tbsp": UnitVolume.tablespoons, "floz": UnitVolume.fluidOunces, "gal": UnitVolume.gallons, "pt": UnitVolume.pints,
        // speed
        "kmh": UnitSpeed.kilometersPerHour, "kph": UnitSpeed.kilometersPerHour, "mph": UnitSpeed.milesPerHour, "ms": UnitSpeed.metersPerSecond, "kn": UnitSpeed.knots,
        // data
        "kb": UnitInformationStorage.kilobytes, "mb": UnitInformationStorage.megabytes, "gb": UnitInformationStorage.gigabytes, "tb": UnitInformationStorage.terabytes,
        // time
        "s": UnitDuration.seconds, "sec": UnitDuration.seconds, "min": UnitDuration.minutes, "h": UnitDuration.hours, "hr": UnitDuration.hours,
        // area
        "sqm": UnitArea.squareMeters, "sqft": UnitArea.squareFeet, "acre": UnitArea.acres, "acres": UnitArea.acres, "ha": UnitArea.hectares,
    ]

    /// Converts physical units. nil if the units are unknown or don't match (km → kg).
    static func convertUnits(_ q: Query) -> Double? {
        guard let from = units[q.from] as? Dimension, let to = units[q.to] as? Dimension, type(of: from) == type(of: to) else { return nil }
        return Measurement(value: q.amount, unit: from).converted(to: to).value
    }

    static let currencySymbols = ["$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY"]
    static func currencyCode(_ s: String) -> String? {
        if let c = currencySymbols[s] { return c }
        return s.count == 3 && s.allSatisfy(\.isLetter) ? s.uppercased() : nil
    }

    /// `rates` are per 1 USD.
    static func convertCurrency(_ q: Query, rates: [String: Double]) -> Double? {
        guard let f = currencyCode(q.from), let t = currencyCode(q.to), let rf = rates[f], let rt = rates[t], rf > 0 else { return nil }
        return q.amount / rf * rt
    }
}
