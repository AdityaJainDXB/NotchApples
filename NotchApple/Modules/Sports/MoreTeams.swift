//
//  MoreTeams.swift
//  Notch apple
//
//  Pro: follow more teams than your main one. While any of them is playing,
//  its live score takes turns beside the notch with your main team's.
//  Uses the same free ESPN schedule feed as Sports.
//

import AppKit
import SwiftUI

struct FollowedTeam: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let path: String
}

@MainActor
final class MoreTeams: ObservableObject {
    static let shared = MoreTeams()
    static let limit = 5

    @Published private(set) var teams: [FollowedTeam] = []
    /// Live matches of the extra teams, by team ID.
    @Published private(set) var live: [String: SportsModel.Match] = [:]
    private var lastFetch = Date.distantPast
    private var playingToday = false
    private let key = "sports.moreTeams"

    private init() {
        if let data = UserDefaults.standard.data(forKey: key), let t = try? JSONDecoder().decode([FollowedTeam].self, from: data) { teams = t }
    }

    var canAdd: Bool { teams.count < Self.limit }

    func add(_ team: SportsModel.Team, league: String) {
        guard Entitlements.shared.canUse(.multiMatch), canAdd, !teams.contains(where: { $0.id == team.id }) else { return }
        teams.append(FollowedTeam(id: team.id, name: team.name, path: league.hasPrefix("soccer/") ? "soccer/all" : league))
        save()
        lastFetch = .distantPast
        refreshIfDue()
    }

    func remove(_ team: FollowedTeam) {
        teams.removeAll { $0 == team }
        live[team.id] = nil
        save()
        LiveActivityCenter.shared.recompute()
    }

    private func save() { UserDefaults.standard.set(try? JSONEncoder().encode(teams), forKey: key) }

    /// Called by the heartbeat: every minute on match days, otherwise every 30 minutes.
    func refreshIfDue() {
        guard Entitlements.shared.canUse(.multiMatch), !teams.isEmpty else { return }
        let interval: TimeInterval = playingToday ? 60 : 1800
        guard Date.now.timeIntervalSince(lastFetch) > interval else { return }
        lastFetch = .now
        Task {
            var found: [String: SportsModel.Match] = [:]
            var today = false
            for t in teams {
                let fallback = t.path == "soccer/all" ? "soccer/esp.1" : t.path
                let ms = SportsModel.matches(await SportsModel.json("\(t.path)/teams/\(t.id)/schedule?fixture=true"), fallback: fallback)
                if ms.contains(where: { Calendar.current.isDateInToday($0.date) }) { today = true }
                if let m = ms.first(where: { $0.isLive }) { found[t.id] = m }
            }
            playingToday = today
            if found != live { live = found; LiveActivityCenter.shared.recompute() }
        }
    }

    /// One of the live extra matches; which one changes every 30 seconds.
    var rotatingActivity: LiveActivity? {
        guard Entitlements.shared.canUse(.multiMatch), !live.isEmpty else { return nil }
        let ids = live.keys.sorted()
        let id = ids[Int(Date.now.timeIntervalSince1970 / 30) % ids.count]
        guard let m = live[id] else { return nil }
        let mine = m.home.id == id ? m.home : m.away
        let theirs = m.home.id == id ? m.away : m.home
        let short = mine.abbr.isEmpty ? String(mine.name.prefix(3)).uppercased() : mine.abbr
        return LiveActivity(symbol: "sportscourt.fill", label: "\(short) \(mine.score)-\(theirs.score)", tint: .systemGreen)
    }
}

/// In the Sports tab's Change menu: add the current league's teams to "More teams" (Pro).
struct MoreTeamsMenu: View {
    @ObservedObject private var more = MoreTeams.shared
    @ObservedObject private var sports = SportsModel.shared
    @ObservedObject private var entitlements = Entitlements.shared

    var body: some View {
        Menu {
            if !entitlements.canUse(.multiMatch) {
                Text("Pro: \(Feature.multiMatch.benefit)")
                Button("Get Pro…") { NSWorkspace.shared.open(URL(string: LicenseServer.site)!) }
            } else {
                if !more.teams.isEmpty {
                    Section("Following") {
                        ForEach(more.teams) { t in Button("Stop following \(t.name)") { more.remove(t) } }
                    }
                }
                if more.canAdd {
                    Section("Add from \(sports.league.name)") {
                        ForEach(sports.teams.filter { t in !more.teams.contains { $0.id == t.id } }) { t in
                            Button(t.name) { more.add(t, league: sports.leagueID) }
                        }
                    }
                } else {
                    Text("Up to \(MoreTeams.limit) extra teams")
                }
            }
        } label: {
            Label(more.teams.isEmpty ? "More teams" : "More teams (\(more.teams.count))", systemImage: "plus.circle")
                .font(.system(size: 11, weight: .semibold))
        }
        .menuStyle(.borderlessButton).fixedSize()
        .help(Feature.multiMatch.benefit)
    }
}
