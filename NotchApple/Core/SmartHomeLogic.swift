//
//  SmartHomeLogic.swift
//  Notch apple
//
//  The rules behind the Smart Home tab (Ultimate), which talks to your own Home Assistant over its REST API.
//  Home Assistant itself connects Philips Hue, IKEA, Zigbee, Matter and hundreds of other brands, so this one
//  tab covers them. No screens and no network here, so it can be tested.
//

import Foundation

struct HAEntity: Equatable, Identifiable {
    let id: String            // light.living_room
    let name: String
    let state: String         // on, off, unavailable, open, closed...
    let brightness: Int?      // 0...255, lights only

    var domain: String { String(id.prefix { $0 != "." }) }
    var isOn: Bool { ["on", "open", "playing"].contains(state) }
    var isAvailable: Bool { state != "unavailable" && state != "unknown" }
    /// Scenes and scripts are buttons; the rest switch on and off.
    var isButton: Bool { domain == "scene" || domain == "script" }
}

enum SmartHomeLogic {
    /// The kinds of device the tab shows, in the order they're listed.
    static let domains = ["light", "switch", "fan", "cover", "input_boolean", "scene", "script"]

    static func title(for domain: String) -> String {
        switch domain {
        case "light": "Lights"
        case "switch": "Switches"
        case "fan": "Fans"
        case "cover": "Covers"
        case "input_boolean": "Toggles"
        case "scene": "Scenes"
        case "script": "Scripts"
        default: domain.capitalized
        }
    }

    /// What people type → the address of the server. Adds http:// when missing, drops a trailing slash
    /// and a pasted "/api...", and refuses anything that isn't http or https.
    static func normalize(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if !s.contains("://") { s = "http://" + s }
        guard var c = URLComponents(string: s), let scheme = c.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = c.host, !host.isEmpty else { return nil }
        c.path = ""; c.query = nil; c.fragment = nil; c.user = nil; c.password = nil
        // A bare address like "homeassistant.local" means Home Assistant's own port.
        if c.port == nil, scheme == "http", !raw.lowercased().contains("://") { c.port = 8123 }
        return c.url
    }

    /// GET /api/states → the devices we can show, sorted by kind and then name.
    static func parse(_ data: Data) -> [HAEntity] {
        guard let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return [] }
        var out: [HAEntity] = []
        for item in list {
            guard let id = item["entity_id"] as? String, let state = item["state"] as? String else { continue }
            let domain = String(id.prefix { $0 != "." })
            guard domains.contains(domain) else { continue }
            let attrs = item["attributes"] as? [String: Any] ?? [:]
            if (attrs["hidden"] as? Bool) == true { continue }
            let name = (attrs["friendly_name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? id.split(separator: ".").last.map { $0.replacingOccurrences(of: "_", with: " ").capitalized } ?? id
            let b = (attrs["brightness"] as? Int) ?? (attrs["brightness"] as? Double).map(Int.init)
            out.append(HAEntity(id: id, name: name, state: state, brightness: b))
        }
        return out.sorted {
            let a = domains.firstIndex(of: $0.domain) ?? 99, b = domains.firstIndex(of: $1.domain) ?? 99
            return a != b ? a < b : $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    /// The Home Assistant service to call to press or flip a device.
    static func service(for e: HAEntity) -> (domain: String, service: String) {
        switch e.domain {
        case "scene": return ("scene", "turn_on")
        case "script": return ("script", "turn_on")
        case "cover": return ("cover", e.isOn ? "close_cover" : "open_cover")
        default: return ("homeassistant", "toggle")
        }
    }

    /// 0...100 for a light's slider, or nil when it can't dim.
    static func brightnessPercent(_ e: HAEntity) -> Int? {
        guard e.domain == "light", let b = e.brightness else { return nil }
        return Int((Double(b) / 255 * 100).rounded())
    }

    static func brightnessBody(entity: String, percent: Int) -> [String: Any] {
        ["entity_id": entity, "brightness_pct": min(100, max(1, percent))]
    }

    /// "3 lights on" for the header.
    static func summary(_ entities: [HAEntity]) -> String {
        let on = entities.filter { $0.isOn && !$0.isButton }.count
        return on == 0 ? "Everything is off" : "\(on) on"
    }
}
