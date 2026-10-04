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
//   • National teams (World Cup, qualifiers, Nations League, Euro, Copa América,
//     friendlies) and cricket: India's internationals and the IPL.
//   • A league table next to the fixtures, and match details (goals, cards,
//     lineups) from ESPN's per-match summary.
//   • Match alerts: a notification 30 minutes before your team kicks off, and a
//     flash in the notch on goals and at full time.
//   • If ESPN is down or changes its format, Sports says it's unavailable rather
//     than showing an empty tab.
//
//  It only polls while the Sports tab is open, or while your team is playing, so it
//  costs nothing the rest of the time.
//

import AppKit
import SwiftUI
import UserNotifications

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
        League(id: "soccer/fifa.world", name: "FIFA World Cup", sport: "National teams", symbol: "globe.europe.africa.fill"),
        League(id: "soccer/fifa.worldq.uefa", name: "World Cup qualifying · Europe", sport: "National teams", symbol: "globe.europe.africa.fill"),
        League(id: "soccer/fifa.worldq.conmebol", name: "World Cup qualifying · South America", sport: "National teams", symbol: "globe.americas.fill"),
        League(id: "soccer/fifa.worldq.afc", name: "World Cup qualifying · Asia", sport: "National teams", symbol: "globe.asia.australia.fill"),
        League(id: "soccer/uefa.nations", name: "UEFA Nations League", sport: "National teams", symbol: "globe.europe.africa.fill"),
        League(id: "soccer/uefa.euro", name: "UEFA Euro", sport: "National teams", symbol: "globe.europe.africa.fill"),
        League(id: "soccer/conmebol.america", name: "Copa América", sport: "National teams", symbol: "globe.americas.fill"),
        League(id: "soccer/afc.asian.cup", name: "AFC Asian Cup", sport: "National teams", symbol: "globe.asia.australia.fill"),
        League(id: "soccer/fifa.friendly", name: "International friendlies", sport: "National teams", symbol: "globe"),
        League(id: SportsModel.indiaCricket, name: "India (international cricket)", sport: "Cricket", symbol: "cricket.ball.fill"),
        League(id: "cricket/8048", name: "IPL", sport: "Cricket", symbol: "cricket.ball.fill"),
        League(id: "basketball/nba", name: "NBA", sport: "Basketball", symbol: "basketball.fill"),
        League(id: "football/nfl", name: "NFL", sport: "American football", symbol: "football.fill"),
        League(id: "baseball/mlb", name: "MLB", sport: "Baseball", symbol: "baseball.fill"),
        League(id: "hockey/nhl", name: "NHL", sport: "Hockey", symbol: "hockey.puck.fill"),
    ]

    /// Not an ESPN league: India's men's internationals, from ESPN's all-cricket feed.
    static let indiaCricket = "cricket/india"

    struct Standing: Identifiable, Equatable {
        var id: String { "\(group)-\(rank)-\(team)" }
        let group: String
        let rank: Int
        let team: String
        let teamID: String
        let logo: String
        let played: String
        let points: String
        let extra: String          // goal difference, or net run rate in cricket
    }

    struct MatchEvent: Identifiable, Equatable {
        let id: Int
        let minute: String
        let kind: String           // "Goal", "Yellow Card", "Red Card", "Penalty - Scored", "Own Goal"…
        let team: String
        let players: String
    }

    struct Lineup: Identifiable, Equatable {
        var id: String { team }
        let team: String
        let formation: String
        let starters: [String]
        let subs: [String]
    }

    struct MatchDetail: Equatable {
        let match: Match
        let events: [MatchEvent]
        let lineups: [Lineup]
        let note: String           // e.g. cricket's "West Indies require 205 runs"
    }

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
            leagueMatches = []; teams = []; standings = []; standingsLoaded = false; detail = nil
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
    @Published private(set) var standings: [Standing] = []
    @Published private(set) var standingsLoaded = false
    /// Set when ESPN didn't answer or sent something unreadable (shown instead of an empty list).
    @Published private(set) var leagueUnavailable = false
    @Published private(set) var detail: MatchDetail?
    @Published private(set) var loadingDetail = false
    /// A notification 30 minutes before kick-off, and a flash in the notch on goals and full time.
    @AppStorage("sports.alerts") var matchAlerts = true { didSet { Task { await scheduleKickoffAlert() } } }
    private var lastScores: [String: String] = [:]
    private var lastStates: [String: String] = [:]
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
            checkMatchMoments()
            await scheduleKickoffAlert()
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
        if id == Self.indiaCricket {
            let found = await Self.indiaMatches()
            guard id == leagueID else { return }
            loadingLeague = false
            leagueUnavailable = found == nil
            leagueMatches = found ?? []
            return
        }
        let days = (0..<14).compactMap { Calendar.current.date(byAdding: .day, value: $0, to: .now) }
        var all: [Match] = []
        var answered = 0
        await withTaskGroup(of: (Bool, [Match]).self) { group in
            for day in days {
                group.addTask { let j = await Self.json("\(id)/scoreboard?dates=\(Self.ymd(day))"); return (j?["events"] != nil, Self.matches(j, fallback: id)) }
            }
            // ESPN's own "current matchday" skips international breaks and off days, so the
            // list is never empty just because nothing is on this week.
            group.addTask { let j = await Self.json("\(id)/scoreboard"); return (j?["events"] != nil, Self.matches(j, fallback: id)) }
            for await (ok, m) in group { all += m; if ok { answered += 1 } }
        }
        guard id == leagueID else { return }
        loadingLeague = false
        // No readable answer at all: ESPN is down or changed its format.
        leagueUnavailable = answered == 0
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

    // MARK: League table

    func loadStandings() async {
        let id = leagueID
        guard id != Self.indiaCricket else { standings = []; standingsLoaded = true; return }
        let j = await Self.json("\(id)/standings", base: Self.standingsBase)
        guard id == leagueID else { return }
        var rows: [Standing] = []
        let groups = (j?["children"] as? [[String: Any]]) ?? (j.map { [$0] } ?? [])
        for g in groups {
            let groupName = groups.count > 1 ? (g["name"] as? String ?? "") : ""
            let entries = ((g["standings"] as? [String: Any])?["entries"] as? [[String: Any]]) ?? []
            for (i, e) in entries.enumerated() {
                let t = e["team"] as? [String: Any] ?? [:]
                var stats: [String: String] = [:]
                for st in (e["stats"] as? [[String: Any]]) ?? [] {
                    if let n = st["name"] as? String { stats[n] = (st["displayValue"] as? String) ?? (st["value"].map { "\($0)" } ?? "") }
                }
                rows.append(Standing(group: groupName, rank: Int(stats["rank"] ?? "") ?? i + 1,
                                     team: (t["displayName"] as? String) ?? "?", teamID: (t["id"] as? String) ?? "",
                                     logo: ((t["logos"] as? [[String: Any]])?.first?["href"] as? String) ?? "",
                                     played: stats["gamesPlayed"] ?? stats["matchesPlayed"] ?? "",
                                     points: stats["points"] ?? stats["matchPoints"] ?? "",
                                     extra: stats["pointDifferential"] ?? stats["netRunRate"] ?? stats["goalDifference"] ?? ""))
            }
        }
        standings = rows
        standingsLoaded = true
    }

    // MARK: Match details

    func openDetail(_ m: Match) {
        detail = MatchDetail(match: m, events: [], lineups: [], note: "")
        loadingDetail = true
        Task {
            let path = m.leaguePath
            let j = await Self.json("\(path)/summary?event=\(m.id)")
            guard detail?.match.id == m.id else { return }
            loadingDetail = false
            let events = ((j?["keyEvents"] as? [[String: Any]]) ?? []).enumerated().compactMap { i, k -> MatchEvent? in
                let kind = (k["type"] as? [String: Any])?["text"] as? String ?? ""
                let interesting = ["Goal", "Penalty - Scored", "Own Goal", "Yellow Card", "Red Card", "Substitution"]
                guard interesting.contains(where: { kind.hasPrefix($0) }) else { return nil }
                let names = ((k["participants"] as? [[String: Any]]) ?? [])
                    .compactMap { ($0["athlete"] as? [String: Any])?["displayName"] as? String }
                // Goals: scorer then assist. Substitutions: ESPN lists the player coming on first.
                let players = kind.hasPrefix("Substitution")
                    ? (names.count == 2 ? "\(names[0]) on, \(names[1]) off" : names.joined(separator: ", "))
                    : (names.count >= 2 && !kind.contains("Card") ? "\(names[0]) (assist: \(names[1]))" : names.joined(separator: ", "))
                return MatchEvent(id: i, minute: ((k["clock"] as? [String: Any])?["displayValue"] as? String) ?? "",
                                  kind: kind, team: ((k["team"] as? [String: Any])?["displayName"] as? String) ?? "", players: players)
            }
            let lineups = ((j?["rosters"] as? [[String: Any]]) ?? []).compactMap { r -> Lineup? in
                guard let team = (r["team"] as? [String: Any])?["displayName"] as? String else { return nil }
                let players = (r["roster"] as? [[String: Any]]) ?? []
                func name(_ p: [String: Any]) -> String {
                    let n = (p["athlete"] as? [String: Any])?["displayName"] as? String ?? "?"
                    return (p["jersey"] as? String).map { "\($0) \(n)" } ?? n
                }
                return Lineup(team: team, formation: r["formation"] as? String ?? "",
                              starters: players.filter { $0["starter"] as? Bool == true }.map(name),
                              subs: players.filter { $0["starter"] as? Bool != true }.map(name))
            }
            let header = (j?["header"] as? [String: Any])?["competitions"] as? [[String: Any]]
            let note = ((header?.first?["status"] as? [String: Any])?["summary"] as? String) ?? ""
            detail = MatchDetail(match: m, events: events, lineups: lineups,
                                 note: j == nil ? "Match details are unavailable right now." : note)
        }
    }

    func closeDetail() { detail = nil }

    // MARK: Match alerts

    /// Goals and the final whistle for your team's match: a flash in the notch (and a notification).
    private func checkMatchMoments() {
        guard matchAlerts else { return }
        for m in (upcoming + results.prefix(2)) where m.home.id == teamID || m.away.id == teamID {
            let score = "\(m.home.score)-\(m.away.score)"
            defer { lastScores[m.id] = score; lastStates[m.id] = m.state }
            guard let oldScore = lastScores[m.id], let oldState = lastStates[m.id] else { continue }
            let line = "\(m.home.abbr) \(m.home.score)–\(m.away.score) \(m.away.abbr)"
            if m.state == "post" && oldState == "in" {
                LiveActivityCenter.shared.flash(LiveActivity(symbol: symbol, label: "FT \(m.home.score)-\(m.away.score)", tint: .systemBlue), seconds: 8)
                Notifier.post(title: "Full time", body: line)
            } else if m.state == "in" && score != oldScore && !oldScore.hasPrefix("-") && oldScore != "-" {
                LiveActivityCenter.shared.flash(LiveActivity(symbol: symbol, label: "GOAL \(m.home.score)-\(m.away.score)", tint: .systemGreen), seconds: 8)
                Notifier.post(title: "Goal!", body: line)
            }
        }
    }

    /// A notification 30 minutes before your team's next match (rescheduled whenever the schedule changes).
    private func scheduleKickoffAlert() async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix("kickoff-") }
        center.removePendingNotificationRequests(withIdentifiers: pending)
        guard matchAlerts, let m = nextMatch, m.state == "pre" else { return }
        let fireAt = m.date.addingTimeInterval(-30 * 60)
        guard fireAt > .now else { return }
        let content = UNMutableNotificationContent()
        content.title = "\(m.home.name) v \(m.away.name) in 30 minutes"
        content.body = [m.competition, m.venue].filter { !$0.isEmpty }.joined(separator: " · ")
        let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: fireAt)
        try? await center.add(UNNotificationRequest(identifier: "kickoff-\(m.id)", content: content,
                                                    trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
    }

    // MARK: Cricket: India

    /// India's men's international matches from ESPN's all-cricket feed (nil if it didn't answer).
    nonisolated private static func indiaMatches() async -> [Match]? {
        guard let url = URL(string: "https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket&lang=en&region=in"),
              let (data, response) = try? await URLSession.shared.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let sports = j["sports"] as? [[String: Any]] else { return nil }
        var out: [Match] = []
        for league in sports.flatMap({ ($0["leagues"] as? [[String: Any]]) ?? [] }) {
            let leagueName = league["name"] as? String ?? ""
            let leagueID = league["id"] as? String ?? ""
            for e in (league["events"] as? [[String: Any]]) ?? [] {
                let sides = (e["competitors"] as? [[String: Any]]) ?? []
                // The men's team only: not India A, Women, Under-19s or "Rest of India".
                guard sides.contains(where: { ($0["displayName"] as? String) == "India" && ($0["isNational"] as? Bool ?? true) }),
                      let id = e["id"] as? String, let ds = e["date"] as? String, let date = parseDate(ds) else { continue }
                func side(_ ha: String) -> Side {
                    let c = sides.first { ($0["homeAway"] as? String) == ha } ?? [:]
                    return Side(id: c["id"] as? String ?? "", name: c["displayName"] as? String ?? "?",
                                abbr: c["abbreviation"] as? String ?? "?", logo: c["logo"] as? String ?? "",
                                score: c["score"] as? String ?? "", winner: (c["winner"] as? Bool) ?? ((c["winner"] as? String) == "true"))
                }
                let state = e["status"] as? String ?? "pre"
                let full = (e["fullStatus"] as? [String: Any])?["summary"] as? String ?? e["summary"] as? String ?? ""
                out.append(Match(id: id, date: date, state: state, detail: state == "pre" ? "" : full,
                                 competition: [e["title"] as? String, leagueName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "),
                                 leaguePath: "cricket/\(leagueID)", venue: e["location"] as? String ?? "",
                                 home: side("home"), away: side("away")))
            }
        }
        return out.sorted { $0.date < $1.date }
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

    nonisolated static let base = "https://site.api.espn.com/apis/site/v2/sports/"
    nonisolated private static let standingsBase = "https://site.api.espn.com/apis/v2/sports/"

    nonisolated static func json(_ path: String, base: String = base) async -> [String: Any]? {
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

    nonisolated static func matches(_ json: [String: Any]?, fallback: String) -> [Match] {
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
                        winner: (c["winner"] as? Bool) ?? ((c["winner"] as? String) == "true"))
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
