//
//  StatusPulseLogic.swift
//  Notch Apple
//
//  The rules behind the status pulse, the coloured glow around the closed notch: green is done or good, amber needs you soon, red
//  failed or urgent. Which things can glow (sources, in sections), when each one fires, how long it stays, and how often. No clocks
//  or screens here, so it is tested on its own.
//

import Foundation

enum StatusPulseLogic {
    enum Color: String, Equatable { case green, amber, red }

    struct Section: Identifiable, Equatable {
        let id: String
        let name: String
        let note: String?
    }

    struct Source: Identifiable, Equatable {
        let id: String
        let section: String
        let name: String
        let detail: String
        let defaultOn: Bool
        /// False for sources that need an outside service (weather, prices, flights, scores). They are listed but not built.
        let available: Bool

        init(_ id: String, _ section: String, _ name: String, _ detail: String, on: Bool = false, available: Bool = true) {
            self.id = id; self.section = section; self.name = name; self.detail = detail; self.defaultOn = on; self.available = available
        }
    }

    static let sections: [Section] = [
        .init(id: "power", name: "Power and system", note: nil),
        .init(id: "downloads", name: "Downloads and transfers", note: nil),
        .init(id: "work", name: "Work and builds", note: nil),
        .init(id: "devices", name: "Devices and connections", note: nil),
        .init(id: "calendar", name: "Calendar and people", note: nil),
        .init(id: "security", name: "Security", note: nil),
        .init(id: "weather", name: "Weather and environment", note: "Needs an outside service. Not available yet."),
        .init(id: "money", name: "Money and markets", note: "Needs an outside service. Not available yet."),
        .init(id: "travel", name: "Travel and transit", note: "Needs an outside service. Not available yet."),
        .init(id: "sports", name: "Sports and live events", note: "Needs an outside service. Not available yet."),
        .init(id: "health", name: "Health and habits", note: nil),
        .init(id: "network", name: "Network", note: nil),
        .init(id: "files", name: "Files and storage", note: nil),
        .init(id: "clipboard", name: "Clipboard", note: nil),
        .init(id: "custom", name: "Custom", note: nil),
    ]

    static let sources: [Source] = [
        .init("battery", "power", "Battery", "Amber at 20%, red at 10%, green when fully charged", on: true),
        .init("disk", "power", "Disk almost full", "Red when free space runs low"),
        .init("update", "power", "Update waiting", "Amber when a Notch Apple update is waiting"),
        .init("download.done", "downloads", "Download finished", "Green when a file in Downloads finishes (asks to read your Downloads folder)"),
        .init("download.failed", "downloads", "Download failed", "Red when a download stops without finishing (asks to read your Downloads folder)"),
        .init("timer", "work", "Timer or focus done", "Green when a timer finishes"),
        .init("build", "work", "Build or test finished", "Green or red, sent by your own script through the live activities API"),
        .init("bluetooth", "devices", "Bluetooth battery low", "Amber when AirPods, a mouse or a keyboard run low", available: false),
        .init("event", "calendar", "Event starting soon", "Amber 5 minutes before an event (uses Calendar access you already gave)", on: true),
        .init("messages", "calendar", "New chat message", "Green when a Messenger message arrives"),
        .init("unlock", "security", "Failed unlock attempts", "Red after three wrong codes in a row"),
        .init("camera", "security", "Camera or microphone in use", "Amber when either turns on"),
        .init("rain", "weather", "Rain soon", "Amber 15 minutes before rain", available: false),
        .init("alert", "weather", "Severe weather alert", "Red", available: false),
        .init("price", "money", "Price alert hit", "Green or red by direction", available: false),
        .init("flight", "travel", "Flight status", "Amber delay, red cancelled, green boarding", available: false),
        .init("score", "sports", "Your team scores", "Green", available: false),
        .init("break", "health", "Break reminder", "Amber after 90 minutes of continuous work"),
        .init("wifi", "network", "Wi-Fi dropped or back", "Red when it drops, green when it returns, amber when slow"),
        .init("shelf", "files", "Shelf has old files", "Amber when files have sat on the Shelf for a week"),
        .init("secret", "clipboard", "Sensitive item copied", "Amber when a password or code is copied (turn on Protect secrets in Clipboard settings to clear it too)"),
        .init("custom", "custom", "Your own scripts and plugins", "Add pulse=green, amber or red to a live activity", on: true),
    ]

    static func source(_ id: String) -> Source? { sources.first { $0.id == id } }
    static func sources(in section: String) -> [Source] { sources.filter { $0.section == section } }

    // MARK: When each source fires

    struct Pulse: Equatable {
        let color: Color
        let message: String
    }

    /// Battery: nil means nothing to say. Red at 10% or less, amber at 20% or less (both only off the charger), green when full on the charger.
    static func battery(percent: Int, pluggedIn: Bool) -> Pulse? {
        if pluggedIn { return percent >= 100 ? Pulse(color: .green, message: "Battery is fully charged") : nil }
        if percent <= 10 { return Pulse(color: .red, message: "Battery at \(percent)%. Plug in now") }
        if percent <= 20 { return Pulse(color: .amber, message: "Battery at \(percent)%. Plug in soon") }
        return nil
    }

    /// An event is "starting soon" from five minutes before until it starts.
    static func eventSoon(minutesUntil: Double) -> Bool { minutesUntil > 0 && minutesUntil <= 5 }

    /// Three wrong codes in a row.
    static func unlockFailed(wrongInARow: Int) -> Bool { wrongInARow >= 3 }

    /// Amber after 90 minutes of continuous work.
    static func breakDue(minutesWorking: Double) -> Bool { minutesWorking >= 90 }

    /// Files left on the Shelf for a week.
    static func shelfIsOld(addedDaysAgo: [Double]) -> Bool { addedDaysAgo.contains { $0 >= 7 } }

    /// Connection changes from SystemWatch: green when it comes back, red when it drops, amber when slow. nil for no change.
    static func wifi(from old: String, to new: String) -> Pulse? {
        guard old != new else { return nil }
        switch (old, new) {
        case (_, "down"): return Pulse(color: .red, message: "Internet is down")
        case ("down", "online"): return Pulse(color: .green, message: "Internet is back")
        case (_, "slow"): return Pulse(color: .amber, message: "Internet is slow")
        case ("slow", "online"): return Pulse(color: .green, message: "Internet is back to normal")
        default: return nil
        }
    }

    /// A colour from a script or plugin ("green", "amber" or "red"; "yellow" and "orange" mean amber).
    static func color(named raw: String?) -> Color? {
        switch raw?.lowercased() {
        case "green", "ok", "good": .green
        case "amber", "yellow", "orange", "warn", "warning": .amber
        case "red", "bad", "error", "fail": .red
        default: nil
        }
    }

    // MARK: How long, and how often

    /// Seconds a glow stays on. Red can stay lit until you look at it (nil), if you chose that.
    static func duration(_ color: Color, redStays: Bool) -> TimeInterval? { color == .red && redStays ? nil : 10 }

    /// A source may glow at most once in this many seconds, so nothing nags.
    static let minGap: TimeInterval = 180

    static func allowed(lastFired: Date?, now: Date, minGap: TimeInterval = StatusPulseLogic.minGap) -> Bool {
        guard let lastFired else { return true }
        return now.timeIntervalSince(lastFired) >= minGap
    }

    /// Quiet hours: `from` to `to` on a 24-hour clock, and it may cross midnight (22 to 7). Equal hours mean never quiet.
    static func isQuiet(hour: Int, from: Int, to: Int) -> Bool {
        if from == to { return false }
        return from < to ? (hour >= from && hour < to) : (hour >= from || hour < to)
    }
}
