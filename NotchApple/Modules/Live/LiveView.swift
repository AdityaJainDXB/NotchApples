//
//  LiveView.swift
//  Notch apple
//
//  The Live tab:
//   • Scores: today's games in a league (ESPN's free public scoreboard feed).
//     Follow a team and its live score shows beside the closed notch.
//   • Tracking: paste a parcel tracking number or a flight number; it's
//     recognised (UPS, FedEx, USPS, DHL, flights…) and opens the right page.
//

import AppKit
import SwiftUI

@MainActor
final class ScoresModel: ObservableObject {
    static let shared = ScoresModel()

    struct League: Hashable, Identifiable {
        let id: String      // "basketball/nba"
        let name: String
        let symbol: String
    }

    static let leagues: [League] = [
        League(id: "soccer/eng.1", name: "Premier League", symbol: "soccerball"),
        League(id: "soccer/uefa.champions", name: "Champions League", symbol: "soccerball"),
        League(id: "soccer/esp.1", name: "La Liga", symbol: "soccerball"),
        League(id: "soccer/usa.1", name: "MLS", symbol: "soccerball"),
        League(id: "basketball/nba", name: "NBA", symbol: "basketball.fill"),
        League(id: "football/nfl", name: "NFL", symbol: "football.fill"),
        League(id: "baseball/mlb", name: "MLB", symbol: "baseball.fill"),
        League(id: "hockey/nhl", name: "NHL", symbol: "hockey.puck.fill"),
    ]

    struct Game: Identifiable, Equatable {
        let id: String
        let home: String, away: String          // abbreviations
        let homeName: String, awayName: String
        let homeScore: String, awayScore: String
        let state: String                        // pre, in, post
        let detail: String                       // "Q3 4:12", "FT", "7:30 PM"
    }

    @AppStorage("live.league") var leagueID = "soccer/eng.1" { didSet { games = []; refresh() } }
    @AppStorage("live.team") var followedTeam = ""
    @Published private(set) var games: [Game] = []
    @Published private(set) var error: String?
    private var lastFetch = Date.distantPast

    var league: League { Self.leagues.first { $0.id == leagueID } ?? Self.leagues[0] }

    var followedGame: Game? {
        let team = followedTeam.trimmingCharacters(in: .whitespaces)
        guard !team.isEmpty else { return nil }
        return games.first { g in
            [g.home, g.away, g.homeName, g.awayName].contains { $0.localizedCaseInsensitiveContains(team) }
        }
    }

    var liveActivity: LiveActivity? {
        guard let g = followedGame, g.state == "in" else { return nil }
        return LiveActivity(symbol: league.symbol, label: "\(g.awayScore)-\(g.homeScore)", tint: .systemGreen)
    }

    /// Every 60 s while a followed game is live, otherwise every 10 minutes.
    func refreshIfDue() {
        let interval: TimeInterval = followedGame?.state == "in" ? 55 : 600
        if Date.now.timeIntervalSince(lastFetch) > interval { refresh() }
    }

    func refresh() {
        lastFetch = .now
        let id = leagueID
        Task {
            do {
                let url = URL(string: "https://site.api.espn.com/apis/site/v2/sports/\(id)/scoreboard")!
                let (data, _) = try await URLSession.shared.data(from: url)
                let parsed = Self.parse(data)
                if id == leagueID { games = parsed; error = nil }
                LiveActivityCenter.shared.recompute()
            } catch {
                self.error = "Couldn't load scores."
            }
        }
    }

    private static func parse(_ data: Data) -> [Game] {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let events = json["events"] as? [[String: Any]] else { return [] }
        return events.compactMap { e in
            guard let comp = (e["competitions"] as? [[String: Any]])?.first,
                  let teams = comp["competitors"] as? [[String: Any]] else { return nil }
            func side(_ where_: String) -> (String, String, String) {
                let c = teams.first { ($0["homeAway"] as? String) == where_ } ?? [:]
                let team = c["team"] as? [String: Any] ?? [:]
                return ((team["abbreviation"] as? String) ?? "?", (team["displayName"] as? String) ?? "?", (c["score"] as? String) ?? "0")
            }
            let h = side("home"), a = side("away")
            let type = ((e["status"] as? [String: Any])?["type"] as? [String: Any]) ?? [:]
            return Game(id: (e["id"] as? String) ?? UUID().uuidString, home: h.0, away: a.0, homeName: h.1, awayName: a.1,
                        homeScore: h.2, awayScore: a.2, state: (type["state"] as? String) ?? "pre",
                        detail: (type["shortDetail"] as? String) ?? "")
        }
    }
}

// MARK: - Tracking

struct TrackedItem: Codable, Identifiable, Equatable {
    var id = UUID()
    var code: String
    var label: String
}

enum TrackingLinks {
    /// Works out what a code is and where to track it.
    static func resolve(_ raw: String) -> (kind: String, url: URL) {
        let code = raw.uppercased().replacingOccurrences(of: " ", with: "")
        let enc = code.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? code
        func m(_ pattern: String) -> Bool { code.range(of: pattern, options: .regularExpression) != nil }
        if m("^1Z[0-9A-Z]{16}$") { return ("UPS", URL(string: "https://www.ups.com/track?tracknum=\(enc)")!) }
        if m("^[A-Z][A-Z0-9]{1,2}[0-9]{1,4}$") {
            return ("Flight", URL(string: "https://www.flightaware.com/live/flight/\(enc)")!)
        }
        if m("^(94|93|92|95)[0-9]{20}$") || m("^[A-Z]{2}[0-9]{9}US$") { return ("USPS", URL(string: "https://tools.usps.com/go/TrackConfirmAction?tLabels=\(enc)")!) }
        if m("^[0-9]{12}$") || m("^[0-9]{15}$") { return ("FedEx", URL(string: "https://www.fedex.com/fedextrack/?trknbr=\(enc)")!) }
        if m("^[0-9]{10}$") { return ("DHL", URL(string: "https://www.dhl.com/global-en/home/tracking/tracking-express.html?tracking-id=\(enc)")!) }
        return ("Parcel", URL(string: "https://parcelsapp.com/en/tracking/\(enc)")!)
    }
}

/// Live scores, shown inside the Sports tab (they used to be a tab of their own).
struct ScoresPanel: View {
    @StateObject private var scores = ScoresModel.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Picker("", selection: $scores.leagueID) {
                    ForEach(ScoresModel.leagues) { Text($0.name).tag($0.id) }
                }
                .labelsHidden().fixedSize()
                TextField("Follow a team", text: $scores.followedTeam)
                    .textFieldStyle(.roundedBorder).font(.system(size: 12))
                IconButton(systemImage: "arrow.clockwise", help: "Refresh") { scores.refresh() }
            }
            if let e = scores.error { Text(e).font(.system(size: 11)).foregroundStyle(.orange) }
            ScrollView {
                VStack(spacing: 6) {
                    if scores.games.isEmpty {
                        Text("No games today in \(scores.league.name).").font(.system(size: 12)).foregroundStyle(Theme.textSecondary).padding(.top, 16)
                    }
                    ForEach(scores.games) { g in gameRow(g) }
                }
            }
        }
        .onAppear { scores.refreshIfDue() }
    }

    private func gameRow(_ g: ScoresModel.Game) -> some View {
        let followed = scores.followedGame == g
        return HStack {
            Text(g.away).frame(width: 44, alignment: .leading)
            Text(g.state == "pre" ? "–" : g.awayScore).monospacedDigit().bold()
            Text("@").foregroundStyle(Theme.textSecondary)
            Text(g.state == "pre" ? "–" : g.homeScore).monospacedDigit().bold()
            Text(g.home).frame(width: 44, alignment: .trailing)
            Spacer()
            if g.state == "in" { Circle().fill(.red).frame(width: 6, height: 6) }
            Text(g.detail).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
        }
        .font(.system(size: 13)).foregroundStyle(.white)
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(followed ? Theme.accent.opacity(0.3) : Theme.surface, in: RoundedRectangle(cornerRadius: 10))
    }

}

/// Parcels & Flights: paste a tracking or flight number and it opens the right page.
struct LiveView: View {
    @AppStorage("live.tracked") private var trackedData = Data()
    @StateObject private var flights = FlightWatcher.shared
    @ObservedObject private var entitlements = Entitlements.shared
    @State private var newCode = ""
    @State private var newLabel = ""

    private var tracked: [TrackedItem] { (try? JSONDecoder().decode([TrackedItem].self, from: trackedData)) ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            GlassCard {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Track a parcel or flight").sectionTitle()
                    TextField("Tracking or flight number", text: $newCode).textFieldStyle(.roundedBorder).onSubmit(add)
                    HStack {
                        TextField("Label (optional)", text: $newLabel).textFieldStyle(.roundedBorder).onSubmit(add)
                        Button("Add", action: add).buttonStyle(PurpleButtonStyle()).disabled(newCode.isEmpty)
                    }
                    ScrollView {
                        VStack(spacing: 6) {
                            ForEach(tracked) { item in
                                let link = TrackingLinks.resolve(item.code)
                                HStack(spacing: 6) {
                                    Image(systemName: link.kind == "Flight" ? "airplane" : "shippingbox.fill").foregroundStyle(Theme.accentBright)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(item.label.isEmpty ? item.code : item.label).font(.system(size: 12, weight: .medium)).foregroundStyle(.white).lineLimit(1)
                                        Text("\(link.kind) · \(item.code)").font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                                        if link.kind == "Flight", let s = flights.describe(item.code) {
                                            Text(s).font(.system(size: 10, weight: .semibold)).foregroundStyle(.cyan).lineLimit(1)
                                        }
                                    }
                                    Spacer()
                                    if link.kind == "Flight" {
                                        if entitlements.canUse(.flightStatus) {
                                            IconButton(systemImage: flights.pinned.uppercased() == item.code.uppercased() ? "pin.fill" : "pin",
                                                       help: "Show this flight beside the notch while it's in the air") {
                                                flights.pinned = flights.pinned.uppercased() == item.code.uppercased() ? "" : item.code
                                                flights.check(item.code, force: true)
                                            }
                                        } else {
                                            TierBadge(tier: .pro).help(Feature.flightStatus.benefit)
                                        }
                                    }
                                    IconButton(systemImage: "arrow.up.right.square", help: "Open tracking page") {
                                        NSWorkspace.shared.open(link.url)
                                        AppDelegate.current?.notch?.closeNotch()
                                    }
                                    IconButton(systemImage: "xmark", help: "Remove") { save(tracked.filter { $0.id != item.id }) }
                                }
                            }
                        }
                    }
                }
            }
        }
        .onAppear {
            for item in tracked where TrackingLinks.resolve(item.code).kind == "Flight" { flights.check(item.code) }
        }
    }

    private func add() {
        let code = newCode.trimmingCharacters(in: .whitespaces)
        guard !code.isEmpty else { return }
        save([TrackedItem(code: code, label: newLabel)] + tracked)
        newCode = ""
        newLabel = ""
    }

    private func save(_ items: [TrackedItem]) { trackedData = (try? JSONEncoder().encode(items)) ?? Data() }
}

// MARK: - Live flight status (Pro)

/// Where a flight is right now, from ADSB.lol's free public feed of aircraft
/// transponders (no key). Only the flight's call sign is sent. Pin a flight to
/// see its altitude and speed beside the notch while it's in the air.
@MainActor
final class FlightWatcher: ObservableObject {
    static let shared = FlightWatcher()

    struct Status: Equatable {
        let airborne: Bool
        let altitude: Int?      // feet
        let speed: Int?         // knots
        let checked: Date
    }

    @AppStorage("live.pinnedFlight") var pinned = ""
    @Published private(set) var status: [String: Status] = [:]
    private var lastFetch: [String: Date] = [:]

    /// IATA airline code → ICAO, because transponders broadcast ICAO call signs (EK202 → UAE202).
    static let airlines: [String: String] = [
        "EK": "UAE", "QR": "QTR", "EY": "ETD", "FZ": "FDB", "G9": "ABY", "BA": "BAW", "VS": "VIR", "AA": "AAL", "UA": "UAL",
        "DL": "DAL", "WN": "SWA", "B6": "JBU", "AS": "ASA", "AC": "ACA", "LH": "DLH", "AF": "AFR", "KL": "KLM", "TK": "THY",
        "SQ": "SIA", "CX": "CPA", "QF": "QFA", "NH": "ANA", "JL": "JAL", "AI": "AIC", "6E": "IGO", "UK": "VTI", "SV": "SVA",
        "MS": "MSR", "FR": "RYR", "U2": "EZY", "W6": "WZZ", "IB": "IBE", "LX": "SWR", "OS": "AUA", "SK": "SAS", "AY": "FIN",
        "EI": "EIN", "KE": "KAL", "OZ": "AAR", "CA": "CCA", "MU": "CES", "CZ": "CSN", "ET": "ETH", "KQ": "KQA", "WY": "OMA",
        "GF": "GFA", "PK": "PIA", "TG": "THA", "MH": "MAS", "GA": "GIA", "VN": "HVN", "NZ": "ANZ", "LA": "LAN", "AV": "AVA",
    ]

    static func callsign(_ flight: String) -> String {
        let f = flight.uppercased().replacingOccurrences(of: " ", with: "")
        guard f.count >= 3 else { return f }
        let prefix = String(f.prefix(2)), rest = f.dropFirst(2)
        if let icao = airlines[prefix], rest.allSatisfy(\.isNumber) { return icao + rest }
        return f
    }

    func check(_ flight: String, force: Bool = false) {
        guard Entitlements.shared.canUse(.flightStatus) else { return }
        let key = flight.uppercased()
        guard force || Date.now.timeIntervalSince(lastFetch[key] ?? .distantPast) > 90 else { return }
        lastFetch[key] = .now
        let cs = Self.callsign(flight)
        Task {
            guard let url = URL(string: "https://api.adsb.lol/v2/callsign/\(cs)"),
                  let (data, r) = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 15)),
                  (r as? HTTPURLResponse)?.statusCode == 200,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            let ac = (json["ac"] as? [[String: Any]])?.first
            let alt = ac?["alt_baro"] as? Int ?? (ac?["alt_baro"] as? Double).map { Int($0) }
            let gs = (ac?["gs"] as? Double).map { Int($0) }
            status[key] = Status(airborne: ac != nil && (alt ?? 0) > 0, altitude: alt, speed: gs, checked: .now)
            LiveActivityCenter.shared.recompute()
        }
    }

    /// Heartbeat: keep the pinned flight fresh (every 90 s).
    func refreshIfDue() { if !pinned.isEmpty { check(pinned) } }

    var liveActivity: LiveActivity? {
        guard Entitlements.shared.canUse(.flightStatus), !pinned.isEmpty,
              let s = status[pinned.uppercased()], s.airborne else { return nil }
        let alt = s.altitude.map { $0 >= 1000 ? "\($0 / 1000)k ft" : "\($0) ft" } ?? ""
        return LiveActivity(symbol: "airplane", label: "\(pinned.uppercased()) \(alt)", tint: .systemCyan)
    }

    func describe(_ flight: String) -> String? {
        guard let s = status[flight.uppercased()] else { return nil }
        guard s.airborne else { return "Not in the air right now" }
        return ["In the air", s.altitude.map { "\($0.formatted()) ft" }, s.speed.map { "\($0) kt" }].compactMap { $0 }.joined(separator: " · ")
    }
}
