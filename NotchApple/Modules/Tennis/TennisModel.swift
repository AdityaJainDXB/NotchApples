//
//  TennisModel.swift
//  Notch apple
//
//  Tennis in the notch (ESPN's free public feed, no account or key):
//   • Every ATP and WTA match of the week, live, coming up and finished, in the
//     Men, Women and Mixed draws. A Grand Slam is in both feeds and shows once.
//   • Earlier (and later) weeks one click away, and a jump to any recent Grand Slam.
//   • The ATP and WTA top 20 (a saved list if ESPN's rankings can't be reached).
//   • Favourite players: their matches come first, and while one plays, the score
//     shows beside the closed notch (red during a Grand Slam).
//
//  It polls every 30 s while the tab is open and something is live, and otherwise
//  only checks on your favourites (every 15 minutes, every minute while they play).
//  See TennisLogic for the parsing.
//

import AppKit
import SwiftUI

@MainActor
final class TennisModel: ObservableObject {
    static let shared = TennisModel()

    private static let base = "https://site.api.espn.com/apis/site/v2/sports/tennis/"
    private static let tours = ["atp", "wta"]

    @Published private(set) var events: [TennisEvent] = []
    @Published private(set) var rankings: [String: [TennisRanked]] = [:]
    @Published private(set) var rankingsLive = false
    /// Weeks from now: 0 is this week, -1 last week…
    @Published private(set) var week = 0
    @Published private(set) var loading = false
    @Published private(set) var loaded = false
    @Published private(set) var error: String?
    @Published var viewing = false { didSet { if viewing { refreshAll() }; schedulePolling() } }

    /// Favourite players, one per line.
    @AppStorage("tennis.favourites") private var favouritesRaw = "" { didSet { objectWillChange.send(); LiveActivityCenter.shared.recompute() } }
    @AppStorage("tennis.activity") var showActivity = true { didSet { LiveActivityCenter.shared.recompute() } }

    private var pollTimer: Timer?
    private var lastFetch = Date.distantPast

    var favourites: [String] { favouritesRaw.split(separator: "\n").map(String.init) }

    func isFavourite(_ name: String) -> Bool {
        favourites.contains { TennisLogic.samePlayer($0, name) }
            || (name.contains("/") && name.components(separatedBy: " / ").contains { n in favourites.contains { TennisLogic.samePlayer($0, n) } })
    }

    func toggleFavourite(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let list = favourites
        favouritesRaw = (isFavourite(trimmed) ? list.filter { !TennisLogic.samePlayer($0, trimmed) } : list + [trimmed]).joined(separator: "\n")
        schedulePolling()
    }

    /// Everyone you could pick: both top 20s and everyone playing this week.
    var allPlayers: [String] {
        var seen = Set<String>(), out: [String] = []
        let names = rankings.values.joined().map(\.name) + events.flatMap { $0.matches.flatMap { $0.players.map(\.name) } }
        for n in names where !n.contains("/") && n != "TBD" {
            if seen.insert(n.lowercased()).inserted { out.append(n) }
        }
        return out.sorted()
    }

    // MARK: Loading

    /// Called by the heartbeat (every 30 s): keeps an eye on favourites while the tab is closed.
    func refreshIfDue() {
        guard !favourites.isEmpty, week == 0, !loading else { return }
        let every: TimeInterval = favouriteLive != nil ? 60 : 900
        if Date.now.timeIntervalSince(lastFetch) > every { Task { await loadWeek(0) } }
    }

    func refreshAll() {
        Task {
            await loadWeek(week)
            if rankings.isEmpty || !rankingsLive { await loadRankings() }
        }
    }

    func go(week offset: Int) { Task { await loadWeek(offset) } }

    /// Jump to the week holding a date (a Grand Slam from the menu); selects that week's Grand Slam.
    func jump(to date: Date) { Task { await loadWeek(Int((date.timeIntervalSinceNow / (7 * 86400)).rounded()), at: date) } }

    func loadWeek(_ offset: Int, at day: Date? = nil) async {
        week = offset
        loading = true
        defer { loading = false; loaded = true; lastFetch = .now; schedulePolling(); LiveActivityCenter.shared.recompute() }
        let date = day ?? Date.now.addingTimeInterval(Double(offset) * 7 * 86400)
        let query = offset == 0 && day == nil ? "" : "?dates=\(Self.ymd(date))"
        let urls = Self.tours.compactMap { t in URL(string: "\(Self.base)\(t)/scoreboard\(query)").map { (t, $0) } }
        let lists: [[TennisEvent]] = await withTaskGroup(of: [TennisEvent]?.self) { group in
            for (t, url) in urls {
                group.addTask {
                    guard let json = await Self.json(url) else { return nil }
                    return TennisLogic.events(json, tour: t)
                }
            }
            var found: [[TennisEvent]] = []
            for await r in group { if let r { found.append(r) } }
            return found
        }
        guard week == offset else { return }   // you moved to another week meanwhile
        if lists.isEmpty {
            error = "Tennis scores are unavailable right now."
        } else {
            error = nil
            events = TennisLogic.merge(lists)
        }
    }

    func loadRankings() async {
        var out: [String: [TennisRanked]] = [:]
        for t in Self.tours {
            if let url = URL(string: "\(Self.base)\(t)/rankings"), let json = await Self.json(url) {
                let r = TennisLogic.rankings(json)
                if !r.isEmpty { out[t] = r }
            }
        }
        rankingsLive = Self.tours.allSatisfy { out[$0] != nil }
        for t in Self.tours where out[t] == nil { out[t] = TennisLogic.savedRanking(t) }
        rankings = out
    }

    /// Every 30 s while the tab is open, this week is shown and something is live.
    private func schedulePolling() {
        let want = viewing && week == 0 && events.contains { $0.liveCount > 0 }
        if want, pollTimer == nil {
            pollTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in
                MainActor.assumeIsolated {
                    let m = TennisModel.shared
                    if !m.loading { Task { await m.loadWeek(0) } }
                }
            }
        } else if !want {
            pollTimer?.invalidate(); pollTimer = nil
        }
    }

    // MARK: Beside the notch

    /// A favourite's live match this week: the event, the match and which side they're on.
    var favouriteLive: (event: TennisEvent, match: TennisMatch, side: Int)? {
        guard week == 0, !favourites.isEmpty else { return nil }
        for e in events {
            for m in e.matches where m.state == .live {
                if let side = m.players.firstIndex(where: { isFavourite($0.name) }) { return (e, m, side) }
            }
        }
        return nil
    }

    var liveActivity: LiveActivity? {
        guard showActivity, let f = favouriteLive else { return nil }
        let p = f.match.players[f.side]
        let surname = p.short.split(separator: " ").last.map(String.init) ?? p.name
        let score = TennisLogic.score(f.match, side: f.side)
        return LiveActivity(symbol: "tennisball.fill", label: score.isEmpty ? surname : "\(surname) \(score)",
                            tint: f.event.slam ? .systemRed : .systemGreen)
    }

    // MARK: Helpers

    private static func ymd(_ d: Date) -> String {
        let c = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d%02d%02d", c.year ?? 2026, c.month ?? 1, c.day ?? 1)
    }

    nonisolated private static func json(_ url: URL) async -> [String: Any]? {
        guard let (data, response) = try? await URLSession.shared.data(for: URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}
