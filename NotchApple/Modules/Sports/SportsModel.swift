//
//  SportsModel.swift
//  Notch apple
//
//  Sports in the notch (ESPN's free public feed, no account or key):
//   • Your team, Barcelona unless you change it: the next match with a countdown,
//     every competition it plays in (league, Champions League, cups), recent results.
//   • A league view: upcoming fixtures and scores for a league you pick
//     (the big football leagues, plus NBA, NFL, MLB and NHL).
//   • While your team's match is live, the score shows beside the closed notch.
//
//  It only polls while the Sports tab is open, or while your team is playing, so it
//  costs nothing the rest of the time.
//

import AppKit
import SwiftUI

@MainActor
final class SportsModel: ObservableObject {
    static let shared = SportsModel()

    /// Everyone tracks Barcelona until they pick another team.
    static let defaultTeam = (id: "83", name: "Barcelona", path: "soccer/all")

    // MARK: Data

    struct League: Hashable, Identifiable {
        let id: String          // ESPN path, e.g. "soccer/esp.1"
        let name: String
        let sport: String       // the group it's listed under
        let symbol: String
    }

    static let leagues: [League] = [
        League(id: "soccer/esp.1", name: "La Liga", sport: "Football", symbol: "soccerball"),
        League(id: "soccer/eng.1", name: "Premier League", sport: "Football", symbol: "soccerball"),
        League(id: "soccer/ita.1", name: "Serie A", sport: "Football", symbol: "soccerball"),
        League(id: "soccer/ger.1", name: "Bundesliga", sport: "Football", symbol: "soccerball"),
        League(id: "soccer/fra.1", name: "Ligue 1", sport: "Football", symbol: "soccerball"),
        League(id: "soccer/uefa.champions", name: "Champions League", sport: "Football", symbol: "soccerball"),
        League(id: "soccer/uefa.europa", name: "Europa League", sport: "Football", symbol: "soccerball"),
        League(id: "soccer/por.1", name: "Liga Portugal", sport: "Football", symbol: "soccerball"),
        League(id: "soccer/ned.1", name: "Eredivisie", sport: "Football", symbol: "soccerball"),
        League(id: "soccer/usa.1", name: "MLS", sport: "Football", symbol: "soccerball"),
        League(id: "basketball/nba", name: "NBA", sport: "Basketball", symbol: "basketball.fill"),
        League(id: "football/nfl", name: "NFL", sport: "American football", symbol: "football.fill"),
        League(id: "baseball/mlb", name: "MLB", sport: "Baseball", symbol: "baseball.fill"),
        League(id: "hockey/nhl", name: "NHL", sport: "Hockey", symbol: "hockey.puck.fill"),
    ]

    struct Team: Identifiable, Hashable {
        let id: String
        let name: String
        let abbr: String
    }

    struct Side: Equatable {
        let id: String
        let name: String
        let abbr: String
        let logo: String
        let score: String
        let winner: Bool
    }

    struct Match: Identifiable, Equatable {
        let id: String
        let date: Date
        let state: String          // pre, in, post
        let detail: String         // "34'", "Q3 4:12", "FT"
        let competition: String
        let leaguePath: String     // where to look it up again, e.g. "soccer/uefa.champions"
        let venue: String
        let home: Side
        let away: Side
        var isLive: Bool { state == "in" }
    }

    // MARK: State

    @AppStorage("sports.league") var leagueID = "soccer/esp.1" {
        didSet {
            guard leagueID != oldValue else { return }
            leagueMatches = []; teams = []
            Task { await loadLeague(); await loadTeams() }
        }
    }
    @AppStorage("sports.teamID") private(set) var teamID = SportsModel.defaultTeam.id
    @AppStorage("sports.teamName") private(set) var teamName = SportsModel.defaultTeam.name
    @AppStorage("sports.teamPath") private(set) var teamPath = SportsModel.defaultTeam.path
    @AppStorage("sports.activity") var showActivity = true

    @Published private(set) var upcoming: [Match] = []
    @Published private(set) var results: [Match] = []
    @Published private(set) var leagueMatches: [Match] = []
    @Published private(set) var teams: [Team] = []
    @Published private(set) var teamError: String?
    @Published private(set) var loadingLeague = false
    var viewing = false { didSet { if viewing && !oldValue { opened() } } }

    private var lastFetch = Date.distantPast

    var league: League { Self.leagues.first { $0.id == leagueID } ?? Self.leagues[0] }
    var isDefaultTeam: Bool { teamID == Self.defaultTeam.id && teamPath == Self.defaultTeam.path }

    /// The team's match that is on right now.
    var liveMatch: Match? { upcoming.first { $0.isLive } }

    /// Next match that hasn't kicked off yet.
    var nextMatch: Match? { upcoming.first { !$0.isLive && $0.date > .now } ?? upcoming.first { !$0.isLive } }

    private var symbol: String {
        Self.leagues.first { teamPath.hasPrefix($0.id.split(separator: "/")[0]) }?.symbol ?? "sportscourt.fill"
    }

    // MARK: Refreshing

    /// Called by the heartbeat (every 30 s): about every minute while live, otherwise every 15.
    func refreshIfDue() {
        let interval: TimeInterval = (liveMatch != nil || kickedOff) ? 40 : 900
        if Date.now.timeIntervalSince(lastFetch) > interval { refreshAll() }
    }

    func refreshAll() {
        lastFetch = .now
        Task {
            await loadTeam()
            await refreshOngoing()
            LiveActivityCenter.shared.recompute()
            if viewing { await loadLeague() }
        }
    }

    private func opened() {
        if Date.now.timeIntervalSince(lastFetch) > 120 || upcoming.isEmpty { refreshAll() }
        Task {
            if leagueMatches.isEmpty { await loadLeague() }
            if teams.isEmpty { await loadTeams() }
        }
    }

    /// Kick-off has passed but the schedule hasn't caught up yet.
    private var kickedOff: Bool {
        guard let m = upcoming.first else { return false }
        return m.state == "pre" && m.date <= .now && Date.now.timeIntervalSince(m.date) < 4 * 3600
    }

    // MARK: Choosing a team

    /// Track a team from a league's team list. Football teams use ESPN's all-competitions
    /// schedule so Champions League and cup matches show up too.
    func track(_ team: Team) { track(id: team.id, name: team.name, fromLeague: leagueID) }

    func track(id: String, name: String, fromLeague league: String) {
        objectWillChange.send()
        teamID = id
        teamName = name
        teamPath = league.hasPrefix("soccer/") ? "soccer/all" : league
        upcoming = []; results = []; teamError = nil
        refreshAll()
    }

    func resetToDefaultTeam() {
        track(id: Self.defaultTeam.id, name: Self.defaultTeam.name, fromLeague: "soccer/esp.1")
    }

    // MARK: Your team

    private func loadTeam() async {
        let path = teamPath, id = teamID
        async let up = Self.json("\(path)/teams/\(id)/schedule?fixture=true")
        async let past = Self.json("\(path)/teams/\(id)/schedule")
        let (u, r) = await (up, past)
        guard id == teamID, path == teamPath else { return }
        if u == nil && r == nil {
            teamError = upcoming.isEmpty && results.isEmpty ? "Couldn't load matches. Check your connection." : nil
            return
        }
        teamError = nil
        let fallback = path == "soccer/all" ? "soccer/esp.1" : path
        let ups = Self.matches(u, fallback: fallback)
        let past_ = Self.matches(r, fallback: fallback)
        // Everything that isn't finished is "upcoming" (this includes a match in progress).
        let all = Dictionary((ups + past_).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }).values
        upcoming = all.filter { $0.state != "post" }.sorted { $0.date < $1.date }
        results = all.filter { $0.state == "post" }.sorted { $0.date > $1.date }
    }

    /// The schedule can lag behind a live match, so ask the league's scoreboard directly.
    private func refreshOngoing() async {
        guard let m = upcoming.first, m.date <= .now,
              m.isLive || Date.now.timeIntervalSince(m.date) < 4 * 3600 else { return }
        for day in [m.date, m.date.addingTimeInterval(-86_400)] {
            guard let j = await Self.json("\(m.leaguePath)/scoreboard?dates=\(Self.ymd(day))"),
                  let e = (j["events"] as? [[String: Any]])?.first(where: { ($0["id"] as? String) == m.id }),
                  let fresh = Self.match(e, fallback: m.leaguePath) else { continue }
            upcoming.removeAll { $0.id == fresh.id }
            if fresh.state == "post" {
                results.insert(fresh, at: 0)
            } else {
                upcoming.insert(fresh, at: 0)
            }
            return
        }
    }

    // MARK: League view

    func loadLeague() async {
        let id = leagueID
        loadingLeague = leagueMatches.isEmpty
        let days = (0..<14).compactMap { Calendar.current.date(byAdding: .day, value: $0, to: .now) }
        var all: [Match] = []
        await withTaskGroup(of: [Match].self) { group in
            for day in days {
                group.addTask { Self.matches(await Self.json("\(id)/scoreboard?dates=\(Self.ymd(day))"), fallback: id) }
            }
            // ESPN's own "current matchday" skips international breaks and off days, so the
            // list is never empty just because nothing is on this week.
            group.addTask { Self.matches(await Self.json("\(id)/scoreboard"), fallback: id) }
            for await m in group { all += m }
        }
        guard id == leagueID else { return }
        loadingLeague = false
        let unique = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }).values
        leagueMatches = unique.sorted { $0.date < $1.date }
    }

    func loadTeams() async {
        let id = leagueID
        guard let j = await Self.json("\(id)/teams"),
              let list = ((j["sports"] as? [[String: Any]])?.first?["leagues"] as? [[String: Any]])?.first?["teams"] as? [[String: Any]]
        else { return }
        let parsed = list.compactMap { entry -> Team? in
            guard let t = entry["team"] as? [String: Any], let tid = t["id"] as? String else { return nil }
            return Team(id: tid, name: (t["displayName"] as? String) ?? tid, abbr: (t["abbreviation"] as? String) ?? "")
        }
        guard id == leagueID else { return }
        teams = parsed.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    // MARK: Beside the notch

    var liveActivity: LiveActivity? {
        guard showActivity, let m = liveMatch else { return nil }
        let mine = m.home.id == teamID ? m.home : m.away
        let theirs = m.home.id == teamID ? m.away : m.home
        let minute = m.detail.isEmpty ? "" : " \(m.detail)"
        return LiveActivity(symbol: symbol, label: "\(mine.score)-\(theirs.score)\(minute)", tint: .systemGreen)
    }

    // MARK: Parsing

    nonisolated private static let base = "https://site.api.espn.com/apis/site/v2/sports/"

    nonisolated private static func json(_ path: String) async -> [String: Any]? {
        guard let url = URL(string: base + path),
              let (data, response) = try? await URLSession.shared.data(for: URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    nonisolated private static func ymd(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd"
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: date)
    }

    nonisolated private static func parseDate(_ s: String) -> Date? {
        // ESPN sends "2026-10-10T16:30Z" (no seconds) in some feeds and full ISO 8601 in others.
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm'Z'"
        if let d = f.date(from: s) { return d }
        return ISO8601DateFormatter().date(from: s)
    }

    nonisolated private static func matches(_ json: [String: Any]?, fallback: String) -> [Match] {
        ((json?["events"] as? [[String: Any]]) ?? []).compactMap { match($0, fallback: fallback) }
    }

    nonisolated private static func match(_ e: [String: Any], fallback: String) -> Match? {
        guard let id = e["id"] as? String,
              let ds = e["date"] as? String, let date = parseDate(ds),
              let comp = (e["competitions"] as? [[String: Any]])?.first,
              let sides = comp["competitors"] as? [[String: Any]] else { return nil }

        func side(_ homeAway: String) -> Side {
            let c = sides.first { ($0["homeAway"] as? String) == homeAway } ?? [:]
            let t = c["team"] as? [String: Any] ?? [:]
            // The scoreboard sends the score as a string, a team schedule as an object.
            let score = (c["score"] as? String) ?? ((c["score"] as? [String: Any])?["displayValue"] as? String) ?? ""
            let logo = (t["logo"] as? String) ?? ((t["logos"] as? [[String: Any]])?.first?["href"] as? String) ?? ""
            return Side(id: (t["id"] as? String) ?? "", name: (t["displayName"] as? String) ?? "?",
                        abbr: (t["abbreviation"] as? String) ?? "?", logo: logo, score: score,
                        winner: (c["winner"] as? Bool) ?? false)
        }

        let status = (comp["status"] as? [String: Any]) ?? (e["status"] as? [String: Any]) ?? [:]
        let type = status["type"] as? [String: Any] ?? [:]
        let state = (type["state"] as? String) ?? "pre"
        var detail = ""
        if state == "in" {
            detail = (type["shortDetail"] as? String).flatMap { $0 == "Scheduled" ? nil : $0 } ?? (status["displayClock"] as? String) ?? ""
        } else if state == "post" {
            detail = (type["shortDetail"] as? String) ?? "FT"
        }

        let league = e["league"] as? [String: Any]
        let slug = league?["slug"] as? String
        let leaguePath = slug.map { fallback.hasPrefix("soccer/") ? "soccer/\($0)" : fallback } ?? fallback
        let competition = (league?["name"] as? String) ?? ((e["season"] as? [String: Any])?["displayName"] as? String) ?? ""
        let venue = ((comp["venue"] as? [String: Any])?["fullName"] as? String) ?? ""

        return Match(id: id, date: date, state: state, detail: detail, competition: competition,
                     leaguePath: leaguePath, venue: venue, home: side("home"), away: side("away"))
    }
}
