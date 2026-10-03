//
//  F1Model.swift
//  Notch apple
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
        orderOnly = false
        guard let path = sessionPath else { return }
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
            let tyre = ((stints[number]?["Stints"] as? [[String: Any]])?.last?["Compound"] as? String)
                ?? (((stints[number]?["Stints"] as? [String: [String: Any]]).flatMap { s in s.keys.compactMap(Int.init).max().flatMap { s[String($0)] } })?["Compound"] as? String)
                ?? ""
            // Races show the gap to the leader; practice and qualifying the gap to the fastest lap.
            let gap = value(l["GapToLeader"]).isEmpty ? value(l["TimeDiffToFastest"]) : value(l["GapToLeader"])
            let interval = value(l["IntervalToPositionAhead"]).isEmpty ? value(l["TimeDiffToPositionAhead"]) : value(l["IntervalToPositionAhead"])
            return Car(number: number, position: pos,
                       code: d["Tla"] as? String ?? number,
                       team: d["TeamName"] as? String ?? "",
                       colour: Color(hex: d["TeamColour"] as? String ?? "888888"),
                       gap: gap, interval: interval,
                       lastLap: value(l["LastLapTime"]), bestLap: value(l["BestLapTime"]),
                       tyre: tyre, laps: l["NumberOfLaps"] as? Int ?? 0, pits: l["NumberOfPitStops"] as? Int ?? 0,
                       inPit: l["InPit"] as? Bool ?? false,
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

    private func loadLiveOrder(_ running: Session) async {
        guard let url = URL(string: "https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard"),
              let json = await Self.json(url),
              let event = (json["events"] as? [[String: Any]])?.first,
              let comp = Self.competition(event, for: running.name),
              let entries = comp["competitors"] as? [[String: Any]] else {
            if cars.isEmpty { error = "Live order isn't available right now." }
            return
        }
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
                       gap: "", interval: "", lastLap: "", bestLap: "", tyre: "", laps: 0, pits: 0, inPit: false, out: false)
        }.sorted { $0.position < $1.position }
        sessionTitle = "\(weekend?.name ?? "Formula 1") · \(running.name)"
        sessionType = running.name == "Race" || running.name == "Sprint" ? "Race" : running.name
        let state = ((comp["status"] as? [String: Any])?["type"] as? [String: Any])?["state"] as? String
        isLive = runningSession != nil && state == "in"
        status = isLive ? "Started" : "Provisional"; track = ""; lap = nil
        orderOnly = true; error = nil
        LiveActivityCenter.shared.recompute()
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
