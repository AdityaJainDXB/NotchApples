//
//  F1Model.swift
//  Notch Apple
//
//  Formula 1 in the notch:
//   • The weekend schedule in your time zone, with a countdown to the next session
//     (Jolpica, the free Ergast-compatible API).
//   • During a session: the live running order (ESPN's free racing feed; F1 and
//     OpenF1 only offer live gaps to paid accounts). Once a session's timing is
//     published, the full classification with gaps, tyres, laps and the flag
//     (F1's public live-timing archive).
//   • Driver and team standings.
//   • Follow a driver and their position and the lap show beside the closed notch.
//
//  It only polls while the F1 tab is open, or while a session is live and the
//  notch activity is on, so it costs nothing the rest of the time.
//

import AppKit
import SwiftUI

@MainActor
final class F1Model: ObservableObject {
    static let shared = F1Model()

    // MARK: Data

    struct Session: Identifiable, Equatable {
        var id: String { name }
        let name: String
        let start: Date
    }

    struct Weekend: Equatable {
        let name: String
        let circuit: String
        let round: String
        let sessions: [Session]
    }

    struct Car: Identifiable, Equatable {
        var id: String { number }
        let number: String
        let position: Int
        let code: String
        let team: String
        let colour: Color
        let gap: String
        let interval: String
        let lastLap: String
        let bestLap: String
        let tyre: String
        let tyreAge: Int     // laps on this set of tyres
        let laps: Int
        let pits: Int
        let inPit: Bool
        let out: Bool        // retired / stopped / knocked out
    }

    struct Standing: Identifiable, Equatable {
        var id: String { name }
        let position: String
        let name: String
        let detail: String
        let points: String
    }

    @Published private(set) var weekend: Weekend?
    @Published private(set) var sessionTitle = ""
    @Published private(set) var sessionType = ""
    @Published private(set) var status = ""          // Started, Finished, Inactive…
    @Published private(set) var track = ""           // AllClear, Yellow, SCDeployed, Red…
    @Published private(set) var lap: (current: Int, total: Int)?
    @Published private(set) var cars: [Car] = []
    @Published private(set) var isLive = false
    @Published private(set) var drivers: [Standing] = []
    @Published private(set) var teams: [Standing] = []
    @Published private(set) var error: String?
    /// True while showing the live running order (positions only, no gaps yet).
    @Published private(set) var orderOnly = false
    @Published var viewing = false { didSet { if viewing { refreshAll() } ; schedulePolling() } }

    @AppStorage("f1.follow") var followedDriver = "" { didSet { schedulePolling(); LiveActivityCenter.shared.recompute() } }
    /// Favourite team (as F1 names it, e.g. "Ferrari"): its best-placed car shows when no driver is followed.
    @AppStorage("f1.team") var favouriteTeam = "" { didSet { schedulePolling(); LiveActivityCenter.shared.recompute() } }

    /// The car to show beside the notch: the followed driver, else the favourite team's best-placed car.
    var favouriteCar: Car? {
        if !followedDriver.isEmpty,
           let car = cars.first(where: { $0.code.caseInsensitiveCompare(followedDriver) == .orderedSame || $0.number == followedDriver }) {
            return car
        }
        guard !favouriteTeam.isEmpty else { return nil }
        return cars.first { !$0.team.isEmpty && ($0.team.localizedCaseInsensitiveContains(favouriteTeam) || favouriteTeam.localizedCaseInsensitiveContains($0.team)) }
    }

    /// Teams in the current order, for the favourite-team menu.
    var teamNames: [String] {
        var seen: [String] = []
        for c in cars where !c.team.isEmpty && !seen.contains(c.team) { seen.append(c.team) }
        for t in teams.map(\.name) where !seen.contains(where: { $0.localizedCaseInsensitiveContains(t) || t.localizedCaseInsensitiveContains($0) }) { seen.append(t) }
        return seen
    }
    @AppStorage("f1.activity") var showActivity = true { didSet { schedulePolling(); LiveActivityCenter.shared.recompute() } }

    private var sessionPath: String?
    /// When the archive's newest session started (to tell if it's behind the schedule).
    private var archiveStart = Date.distantPast
    private var sessionWindow: ClosedRange<Date>?
    private var pollTimer: Timer?
    private var lastSlowFetch = Date.distantPast
    private var drivers_: [String: [String: Any]] = [:]

    private static let base = "https://livetiming.formula1.com/static/"

    // MARK: Timing

    /// The next session that hasn't started yet.
    var nextSession: Session? { weekend?.sessions.first { $0.start > .now } }

    /// Called by the heartbeat (every 30 s) and when the tab opens.
    func refreshIfDue() {
        if Date.now.timeIntervalSince(lastSlowFetch) > (isLive ? 120 : 900) { refreshAll() }
        else if isLive || runningSession != nil || sessionWindow.map({ $0.contains(.now) }) == true { schedulePolling() }
    }

    func refreshAll() {
        lastSlowFetch = .now
        Task {
            await loadSchedule()
            if drivers.isEmpty { await loadStandings() }
            await findSession()
            await loadTiming()
            schedulePolling()
            if viewing || drivers.isEmpty { await loadStandings() }
        }
    }

    /// Fast polling only while someone is looking, or while live with the notch activity on.
    private func schedulePolling() {
        let live = runningSession != nil || (sessionWindow.map { $0.contains(.now) } ?? false)
        let want = live && (viewing || (showActivity && (!followedDriver.isEmpty || !favouriteTeam.isEmpty)))
        if want, pollTimer == nil {
            pollTimer = Timer.scheduledTimer(withTimeInterval: viewing ? 5 : 15, repeats: true) { _ in
                MainActor.assumeIsolated { _ = Task { await F1Model.shared.loadTiming() } }
            }
        } else if !want {
            pollTimer?.invalidate(); pollTimer = nil
        }
    }

    // MARK: Schedule (Jolpica)

    private func loadSchedule() async {
        guard let url = URL(string: "https://api.jolpi.ca/ergast/f1/current/next.json"),
              let json = await Self.json(url),
              let race = ((json["MRData"] as? [String: Any])?["RaceTable"] as? [String: Any]).flatMap({ ($0["Races"] as? [[String: Any]])?.first })
        else { return }
        func date(_ d: [String: Any]?) -> Date? {
            guard let d, let day = d["date"] as? String else { return nil }
            return ISO8601DateFormatter().date(from: "\(day)T\((d["time"] as? String) ?? "00:00:00Z")")
        }
        let parts: [(String, String)] = [("FirstPractice", "Practice 1"), ("SecondPractice", "Practice 2"), ("ThirdPractice", "Practice 3"),
                                         ("SprintQualifying", "Sprint Qualifying"), ("Sprint", "Sprint"), ("Qualifying", "Qualifying")]
        var sessions = parts.compactMap { key, name in date(race[key] as? [String: Any]).map { Session(name: name, start: $0) } }
        if let r = date(race) { sessions.append(Session(name: "Race", start: r)) }
        sessions.sort { $0.start < $1.start }
        let circuit = (race["Circuit"] as? [String: Any])?["circuitName"] as? String ?? ""
        weekend = Weekend(name: race["raceName"] as? String ?? "Next race", circuit: circuit, round: race["round"] as? String ?? "", sessions: sessions)
    }

    // MARK: Which session (F1 live-timing index)

    private func findSession() async {
        let year = Calendar(identifier: .gregorian).component(.year, from: .now)
        guard let url = URL(string: "\(Self.base)\(year)/Index.json"), let json = await Self.json(url),
              let meetings = json["Meetings"] as? [[String: Any]] else { return }
        // Newest session that has started (the index lists the current one as soon as it begins).
        var best: (path: String, window: ClosedRange<Date>, start: Date)?
        for m in meetings {
            for s in (m["Sessions"] as? [[String: Any]]) ?? [] {
                guard let path = s["Path"] as? String,
                      let start = Self.utc(s["StartDate"] as? String, offset: s["GmtOffset"] as? String),
                      let end = Self.utc(s["EndDate"] as? String, offset: s["GmtOffset"] as? String),
                      start <= .now.addingTimeInterval(15 * 60) else { continue }
                if best == nil || start > best!.start {
                    best = (path, start.addingTimeInterval(-15 * 60)...end.addingTimeInterval(45 * 60), start)
                }
            }
        }
        // A session today that the index doesn't list yet: watch its window from the schedule.
        if let s = weekend?.sessions.first(where: { abs($0.start.timeIntervalSinceNow) < 3 * 3600 && $0.start > (best?.start ?? .distantPast) }) {
            sessionWindow = s.start.addingTimeInterval(-15 * 60)...s.start.addingTimeInterval(3 * 3600)
        } else {
            sessionWindow = best?.window
        }
        if let best { archiveStart = best.start }
        if let best, best.path != sessionPath { sessionPath = best.path; cars = []; drivers_ = [:] }
    }

    // MARK: Live timing

    /// The schedule's session that's running now, if any.
    private var runningSession: Session? {
        weekend?.sessions.last { s in
            s.start <= .now && Date.now < s.start.addingTimeInterval(s.name == "Race" ? 3 * 3600 : s.name.contains("Practice") ? 75 * 60 : 100 * 60)
        }
    }

    /// The weekend's latest session that has started but isn't in F1's archive yet.
    private var unarchivedSession: Session? {
        guard let s = weekend?.sessions.last(where: { $0.start <= .now }), s.start > archiveStart.addingTimeInterval(3600) else { return nil }
        return s
    }

    func loadTiming() async {
        if let running = runningSession ?? unarchivedSession {
            // The archive is only written after the session; follow the live order meanwhile.
            if driversNeeded, let path = sessionPath,
               let dl = await Self.json(URL(string: Self.base + path + "DriverList.json")!) {
                drivers_ = dl.compactMapValues { $0 as? [String: Any] }
            }
            await loadLiveOrder(running)
            return
        }
        guard let path = sessionPath else {
            // F1's own live-timing feed is not reachable (it now refuses unsigned requests). With no session on, show the latest
            // final classification (race, sprint or qualifying) from Jolpica; failing that the order from ESPN. Never leave the
            // spinner running.
            // First choice: OpenF1's free data for the latest finished session (lap times, tyres and their age, pit stops,
            // gaps), then the final classification from Jolpica, then the order from ESPN.
            if await loadOpenF1() { return }
            await loadLastClassification()
            if cars.isEmpty { await loadLiveOrder(weekend?.sessions.last(where: { $0.start <= .now })) }
            return
        }
        orderOnly = false
        let b = Self.base + path
        async let infoJ = Self.json(URL(string: b + "SessionInfo.json")!)
        async let statusJ = Self.json(URL(string: b + "SessionStatus.json")!)
        async let trackJ = Self.json(URL(string: b + "TrackStatus.json")!)
        async let lapJ = Self.json(URL(string: b + "LapCount.json")!)
        async let timingJ = Self.json(URL(string: b + "TimingData.json")!)
        async let appJ = Self.json(URL(string: b + "TimingAppData.json")!)
        let needDrivers = drivers_.isEmpty
        async let driverJ = needDrivers ? Self.json(URL(string: b + "DriverList.json")!) : nil
        let (info, st, tr, lp, timing, app, dl) = await (infoJ, statusJ, trackJ, lapJ, timingJ, appJ, driverJ)

        if let dl { drivers_ = dl.compactMapValues { $0 as? [String: Any] } }
        if let info {
            let meeting = (info["Meeting"] as? [String: Any])?["Name"] as? String ?? ""
            let name = info["Name"] as? String ?? ""
            sessionTitle = meeting.isEmpty ? name : "\(meeting) · \(name)"
            sessionType = info["Type"] as? String ?? ""
        }
        status = st?["Status"] as? String ?? ""
        track = tr?["Message"] as? String ?? ""
        if let c = lp?["CurrentLap"] as? Int { lap = (c, lp?["TotalLaps"] as? Int ?? 0) } else { lap = nil }
        isLive = ["Started", "Aborted"].contains(status) || (status == "Inactive" && sessionWindow?.contains(.now) == true)

        guard let lines = timing?["Lines"] as? [String: [String: Any]] else {
            if timing == nil, cars.isEmpty { error = isLive ? nil : "Timing for the latest session isn't available yet." }
            LiveActivityCenter.shared.recompute()
            return
        }
        error = nil
        let stints = (app?["Lines"] as? [String: [String: Any]]) ?? [:]
        func value(_ v: Any?) -> String {
            if let s = v as? String { return s }
            if let d = v as? [String: Any] { return (d["Value"] as? String) ?? "" }
            return ""
        }
        cars = lines.compactMap { number, l -> Car? in
            guard let pos = Int(l["Position"] as? String ?? "") else { return nil }
            let d = drivers_[number] ?? [:]
            // The current stint: its tyre, and how many laps those tyres have done (TotalLaps counts laps on them before this stint too).
            let stint = ((stints[number]?["Stints"] as? [[String: Any]])?.last)
                ?? ((stints[number]?["Stints"] as? [String: [String: Any]]).flatMap { s in s.keys.compactMap(Int.init).max().flatMap { s[String($0)] } })
            let tyre = stint?["Compound"] as? String ?? ""
            let tyreAge = stint?["TotalLaps"] as? Int ?? (stint?["TotalLaps"] as? String).flatMap(Int.init) ?? 0
            // Races show the gap to the leader; practice and qualifying the gap to the fastest lap.
            var gap = value(l["GapToLeader"]).isEmpty ? value(l["TimeDiffToFastest"]) : value(l["GapToLeader"])
            var interval = value(l["IntervalToPositionAhead"]).isEmpty ? value(l["TimeDiffToPositionAhead"]) : value(l["IntervalToPositionAhead"])
            var best = value(l["BestLapTime"])
            // Qualifying keeps one set per part (Q1, Q2, Q3): use the latest part this driver set a time in.
            if let stats = l["Stats"] as? [[String: Any]], let parts = l["BestLapTimes"] as? [[String: Any]],
               let part = parts.indices.last(where: { !(parts[$0]["Value"] as? String ?? "").isEmpty }), part < stats.count {
                gap = stats[part]["TimeDiffToFastest"] as? String ?? gap
                interval = stats[part]["TimeDifftoPositionAhead"] as? String ?? interval
                best = parts[part]["Value"] as? String ?? best
            }
            return Car(number: number, position: pos,
                       code: d["Tla"] as? String ?? number,
                       team: d["TeamName"] as? String ?? "",
                       colour: Color(hex: d["TeamColour"] as? String ?? "888888"),
                       gap: gap, interval: interval,
                       lastLap: value(l["LastLapTime"]), bestLap: best,
                       tyre: tyre, tyreAge: tyreAge, laps: l["NumberOfLaps"] as? Int ?? 0, pits: l["NumberOfPitStops"] as? Int ?? 0,
                       inPit: isLive && (l["InPit"] as? Bool ?? false),   // after a session every car is "in the pit"
                       out: (l["Retired"] as? Bool ?? false) || (l["Stopped"] as? Bool ?? false) || (l["KnockedOut"] as? Bool ?? false))
        }.sorted { $0.position < $1.position }
        LiveActivityCenter.shared.recompute()
    }

    private var driversNeeded: Bool { drivers_.isEmpty }
    /// From the standings: family name → (code, team, team id). Used when F1's driver list is unavailable.
    private var roster: [String: (code: String, team: String, teamID: String)] = [:]
    private static let teamColours: [String: String] = [
        "mercedes": "00D7B6", "ferrari": "ED1131", "mclaren": "F47600", "red_bull": "4781D7", "rb": "6C98FF",
        "alpine": "00A1E8", "haas": "9C9FA2", "audi": "F50537", "sauber": "01C00E", "williams": "1868DB",
        "aston_martin": "229971", "cadillac": "AAAAAD",
    ]

    private func loadLiveOrder(_ running: Session?) async {
        guard let url = URL(string: "https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard"),
              let json = await Self.json(url),
              let event = (json["events"] as? [[String: Any]])?.first,
              let comp = running.flatMap({ Self.competition(event, for: $0.name) }) ?? Self.latestFinished(event),
              let entries = comp["competitors"] as? [[String: Any]], !entries.isEmpty else {
            if cars.isEmpty { error = "F1 isn't publishing session timing right now. The schedule and standings still work." }
            return
        }
        let compType = comp["type"] as? [String: Any]
        let sessionName = running?.name ?? (compType?["text"] as? String) ?? (compType?["abbreviation"] as? String) ?? "Latest session"
        // Match ESPN's names to F1's driver list for codes and team colours.
        let byName = Dictionary(drivers_.values.compactMap { d -> (String, [String: Any])? in
            (d["LastName"] as? String).map { ($0.lowercased(), d) }
        }, uniquingKeysWith: { a, _ in a })
        cars = entries.compactMap { e -> Car? in
            guard let order = e["order"] as? Int, let a = e["athlete"] as? [String: Any] else { return nil }
            let full = a["fullName"] as? String ?? ""
            let last = full.split(separator: " ").dropFirst().joined(separator: " ").lowercased()
            let surname = String(full.split(separator: " ").last ?? "").lowercased()
            let d = byName[last] ?? byName[surname] ?? [:]
            let r = roster[last] ?? roster[surname]
            let code = d["Tla"] as? String ?? r?.code ?? surname.prefix(3).uppercased()
            let colour = d["TeamColour"] as? String ?? r.flatMap { Self.teamColours[$0.teamID] } ?? "888888"
            return Car(number: d["RacingNumber"] as? String ?? code, position: order, code: code,
                       team: d["TeamName"] as? String ?? r?.team ?? "", colour: Color(hex: colour),
                       gap: "", interval: "", lastLap: "", bestLap: "", tyre: "", tyreAge: 0, laps: 0, pits: 0, inPit: false, out: false)
        }.sorted { $0.position < $1.position }
        sessionTitle = "\((event["name"] as? String) ?? weekend?.name ?? "Formula 1") · \(sessionName)"
        sessionType = sessionName == "Race" || sessionName == "Sprint" ? "Race" : sessionName
        let state = ((comp["status"] as? [String: Any])?["type"] as? [String: Any])?["state"] as? String
        isLive = running != nil && runningSession != nil && state == "in"
        status = isLive ? "Started" : "Provisional"; track = ""; lap = nil
        orderOnly = true; error = nil
        LiveActivityCenter.shared.recompute()
    }

    // MARK: Latest final classification (Jolpica)

    /// The newest finished race, sprint or qualifying, as a classification (the same table the live timing shows, without the tyres).
    private func loadLastClassification() async {
        func when(_ race: [String: Any], _ key: String?) -> Date {
            let d = key.flatMap { race[$0] as? [String: Any] } ?? race
            guard let day = d["date"] as? String else { return .distantPast }
            return ISO8601DateFormatter().date(from: "\(day)T\((d["time"] as? String) ?? "00:00:00Z")") ?? .distantPast
        }
        var best: (when: Date, race: [String: Any], rows: [[String: Any]], kind: String)?
        for (path, key, session, kind) in [("results", "Results", nil as String?, "Race"), ("sprint", "SprintResults", "Sprint", "Sprint"), ("qualifying", "QualifyingResults", "Qualifying", "Qualifying")] {
            guard let url = URL(string: "https://api.jolpi.ca/ergast/f1/current/last/\(path).json"), let json = await Self.json(url),
                  let race = (((json["MRData"] as? [String: Any])?["RaceTable"] as? [String: Any])?["Races"] as? [[String: Any]])?.first,
                  let rows = race[key] as? [[String: Any]], !rows.isEmpty else { continue }
            let t = when(race, session)
            if best == nil || t > best!.when { best = (t, race, rows, kind) }
        }
        guard let best else { return }
        let isQuali = best.kind == "Qualifying"
        let list: [Car] = best.rows.compactMap { r -> Car? in
            guard let pos = Int(r["position"] as? String ?? ""), let d = r["Driver"] as? [String: Any] else { return nil }
            let family = d["familyName"] as? String ?? ""
            let code = d["code"] as? String ?? String(family.prefix(3)).uppercased()
            let con = r["Constructor"] as? [String: Any]
            let colour = Self.teamColours[con?["constructorId"] as? String ?? ""] ?? "888888"
            let status = r["status"] as? String ?? "Finished"
            let finished = isQuali || status == "Finished" || status.hasPrefix("+") || status == "Lapped"
            let qBest = ["Q3", "Q2", "Q1"].compactMap { r[$0] as? String }.first(where: { !$0.isEmpty }) ?? ""
            let fastest = ((r["FastestLap"] as? [String: Any])?["Time"] as? [String: Any])?["time"] as? String ?? ""
            let gap = isQuali ? "" : ((r["Time"] as? [String: Any])?["time"] as? String ?? (finished ? status : status))
            return Car(number: d["permanentNumber"] as? String ?? code, position: pos, code: code, team: con?["name"] as? String ?? "",
                       colour: Color(hex: colour), gap: pos == 1 && !isQuali ? "" : gap, interval: "", lastLap: "", bestLap: isQuali ? qBest : fastest,
                       tyre: "", tyreAge: 0, laps: Int(r["laps"] as? String ?? "") ?? 0, pits: 0, inPit: false, out: !finished)
        }.sorted { $0.position < $1.position }
        guard !list.isEmpty else { return }
        cars = list
        sessionTitle = "\(best.race["raceName"] as? String ?? "Formula 1") · \(best.kind)"
        sessionType = best.kind == "Qualifying" ? "Qualifying" : "Race"
        status = "Finalised"; track = ""; lap = nil; isLive = false; orderOnly = false; error = nil
        LiveActivityCenter.shared.recompute()
    }

    /// The most recent session in an ESPN event that has finished.
    private static func latestFinished(_ event: [String: Any]) -> [String: Any]? {
        let comps = (event["competitions"] as? [[String: Any]]) ?? []
        return comps.last { (($0["status"] as? [String: Any])?["type"] as? [String: Any])?["state"] as? String == "post" && (($0["competitors"] as? [[String: Any]])?.isEmpty == false) }
    }

    /// ESPN's entry for a session ("Practice 1" → FP1, "Qualifying" → Qual…), or whichever is running.
    private static func competition(_ event: [String: Any], for name: String) -> [String: Any]? {
        let comps = (event["competitions"] as? [[String: Any]]) ?? []
        let abbr = ["Practice 1": "FP1", "Practice 2": "FP2", "Practice 3": "FP3", "Qualifying": "Qual", "Race": "Race",
                    "Sprint": "Sprint", "Sprint Qualifying": "SQ"][name] ?? name
        let match = comps.first { (($0["type"] as? [String: Any])?["abbreviation"] as? String)?.caseInsensitiveCompare(abbr) == .orderedSame }
        let running = comps.first { (($0["status"] as? [String: Any])?["type"] as? [String: Any])?["state"] as? String == "in" }
        let found = match ?? running
        return (found?["competitors"] as? [[String: Any]])?.isEmpty == false ? found : nil
    }

    // MARK: Standings (Jolpica)

    private func loadStandings() async {
        if let url = URL(string: "https://api.jolpi.ca/ergast/f1/current/driverStandings.json"),
           let json = await Self.json(url),
           let list = Self.standingsList(json)?["DriverStandings"] as? [[String: Any]] {
            drivers = list.map { s in
                let d = s["Driver"] as? [String: Any] ?? [:]
                let c = (s["Constructors"] as? [[String: Any]])?.first
                let team = c?["name"] as? String ?? ""
                if let family = d["familyName"] as? String, let code = d["code"] as? String {
                    roster[family.lowercased()] = (code, team, c?["constructorId"] as? String ?? "")
                }
                return Standing(position: s["positionText"] as? String ?? "", name: "\(d["givenName"] as? String ?? "") \(d["familyName"] as? String ?? "")",
                                detail: team, points: s["points"] as? String ?? "0")
            }
        }
        if let url = URL(string: "https://api.jolpi.ca/ergast/f1/current/constructorStandings.json"),
           let json = await Self.json(url),
           let list = Self.standingsList(json)?["ConstructorStandings"] as? [[String: Any]] {
            teams = list.map { s in
                Standing(position: s["positionText"] as? String ?? "", name: (s["Constructor"] as? [String: Any])?["name"] as? String ?? "",
                         detail: "\(s["wins"] as? String ?? "0") wins", points: s["points"] as? String ?? "0")
            }
        }
    }

    private static func standingsList(_ json: [String: Any]) -> [String: Any]? {
        (((json["MRData"] as? [String: Any])?["StandingsTable"] as? [String: Any])?["StandingsLists"] as? [[String: Any]])?.first
    }

    // MARK: Beside the notch

    var liveActivity: LiveActivity? {
        // Only during a live session: never show an old result as if it were live.
        guard showActivity, isLive, let car = favouriteCar else { return nil }
        let lapText = lap.map { $0.total > 0 ? " L\($0.current)/\($0.total)" : "" } ?? ""
        let gap = orderOnly || car.position == 1 ? "" : (sessionType == "Race" ? car.interval : car.gap)
        let gapText = gap.isEmpty ? lapText : " \(gap)"
        let flag: NSColor = track.contains("Red") ? .systemRed : (track.contains("Yellow") || track.contains("SC") || track.contains("VSC")) ? .systemYellow : .systemGreen
        return LiveActivity(symbol: "flag.checkered", label: "P\(car.position) \(car.code)\(gapText)", tint: flag)
    }

    // MARK: Helpers

    // MARK: OpenF1 (api.openf1.org: free, no account; a session's data is complete once it has finished)

    private static func list(_ path: String) async -> [[String: Any]] {
        guard let url = URL(string: "https://api.openf1.org/v1/" + path),
              let (data, response) = try? await URLSession.shared.data(for: URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return [] }
        return (try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
    }

    static func lapText(_ secs: Double?) -> String {
        guard let secs, secs > 0 else { return "" }
        let m = Int(secs) / 60, rest = secs - Double(m * 60)
        return m > 0 ? String(format: "%d:%06.3f", m, rest) : String(format: "%.3f", rest)
    }

    /// The latest session from OpenF1: the order, last and best laps, tyre and its age, pit stops, and gaps. False when
    /// OpenF1 has nothing (then the other sources are tried).
    private func loadOpenF1() async -> Bool {
        guard let session = await Self.list("sessions?session_key=latest").first, let key = session["session_key"] as? Int else { return false }
        let q = "?session_key=\(key)"
        async let dJ = Self.list("drivers" + q)
        async let pJ = Self.list("position" + q)
        async let lJ = Self.list("laps" + q)
        async let sJ = Self.list("stints" + q)
        async let pitJ = Self.list("pit" + q)
        async let iJ = Self.list("intervals" + q)
        let (drv, pos, laps, stints, pits, ivals) = await (dJ, pJ, lJ, sJ, pitJ, iJ)
        guard !drv.isEmpty else { return false }
        let num = { (d: [String: Any]) in (d["driver_number"] as? Int).map(String.init) ?? "" }
        var place: [String: Int] = [:]; for p in pos { if let n = p["position"] as? Int { place[num(p)] = n } }       // the last one counts
        var best: [String: Double] = [:], last: [String: Double] = [:], lapCount: [String: Int] = [:]
        for l in laps {
            let n = num(l); lapCount[n] = max(lapCount[n] ?? 0, l["lap_number"] as? Int ?? 0)
            if let t = l["lap_duration"] as? Double { last[n] = t; if t < (best[n] ?? .infinity) { best[n] = t } }
        }
        var stint: [String: [String: Any]] = [:]; for st in stints { stint[num(st)] = st }
        var pitN: [String: Int] = [:]; for p in pits { pitN[num(p), default: 0] += 1 }
        var gapL: [String: String] = [:], gapA: [String: String] = [:]
        let gapText = { (v: Any?) -> String in if let d = v as? Double { return String(format: "+%.3f", d) }; return v as? String ?? "" }
        for i in ivals { gapL[num(i)] = gapText(i["gap_to_leader"]); gapA[num(i)] = gapText(i["interval"]) }
        let type = session["session_type"] as? String ?? "", isRace = type == "Race"
        let fastest = best.values.min()
        var rows = drv.map { d -> Car in
            let n = num(d), st = stint[n], laps = lapCount[n] ?? 0
            let age = st.map { ($0["tyre_age_at_start"] as? Int ?? 0) + max(0, laps - ($0["lap_start"] as? Int ?? laps) + 1) } ?? 0
            let gap = isRace ? (gapL[n] ?? "") : (best[n].flatMap { b in fastest.map { b == $0 ? "" : String(format: "+%.3f", b - $0) } } ?? "")
            return Car(number: n, position: place[n] ?? 99, code: d["name_acronym"] as? String ?? n, team: d["team_name"] as? String ?? "",
                       colour: Color(hex: d["team_colour"] as? String ?? "888888"), gap: gap, interval: isRace ? (gapA[n] ?? "") : gap,
                       lastLap: Self.lapText(last[n]), bestLap: Self.lapText(best[n]), tyre: st?["compound"] as? String ?? "", tyreAge: age,
                       laps: laps, pits: pitN[n] ?? 0, inPit: false, out: false)
        }
        // Practice and qualifying are ordered by the best lap.
        if !isRace { rows.sort { (best[$0.number] ?? .infinity) < (best[$1.number] ?? .infinity) }; rows = rows.enumerated().map { i, c in Car(number: c.number, position: i + 1, code: c.code, team: c.team, colour: c.colour, gap: c.gap, interval: c.interval, lastLap: c.lastLap, bestLap: c.bestLap, tyre: c.tyre, tyreAge: c.tyreAge, laps: c.laps, pits: c.pits, inPit: false, out: c.laps == 0) } }
        else { rows.sort { $0.position < $1.position } }
        sessionTitle = "\(session["session_name"] as? String ?? "Session") · \(session["location"] as? String ?? "")"
        sessionType = isRace ? "Race" : type
        status = "Finalised"; orderOnly = false; error = nil; isLive = false
        cars = rows
        LiveActivityCenter.shared.recompute()
        return !rows.isEmpty
    }

    private static func json(_ url: URL) async -> [String: Any]? {
        guard let (data, response) = try? await URLSession.shared.data(for: URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        // F1's files start with a byte-order mark.
        let clean = data.starts(with: [0xEF, 0xBB, 0xBF]) ? data.dropFirst(3) : data
        return try? JSONSerialization.jsonObject(with: Data(clean)) as? [String: Any]
    }

    /// F1's index gives local track time plus the offset from UTC.
    private static func utc(_ local: String?, offset: String?) -> Date? {
        guard let local, let date = ISO8601DateFormatter().date(from: local + "Z") else { return nil }
        let p = (offset ?? "00:00:00").replacingOccurrences(of: "-", with: "").split(separator: ":").compactMap { Double($0) }
        let secs = (p.first ?? 0) * 3600 + (p.count > 1 ? p[1] * 60 : 0)
        return date.addingTimeInterval((offset?.hasPrefix("-") == true ? 1 : -1) * secs)
    }
}
