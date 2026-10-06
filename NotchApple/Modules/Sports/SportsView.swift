//
//  SportsView.swift
//  Notch apple
//
//  The Sports tab: your team (Barcelona by default) on the left, a league's
//  fixtures and scores for the next week on the right. See SportsModel for the data.
//

import SwiftUI

struct SportsView: View {
    @StateObject private var sports = SportsModel.shared
    @AppStorage("sports.showTable") private var showTable = false
    enum RightMode: String { case leagues, scores }
    @AppStorage("sports.rightMode") private var rightMode = RightMode.leagues

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            GlassCard { myTeam }
            GlassCard {
                VStack(alignment: .leading, spacing: 8) {
                    Picker("", selection: $rightMode) {
                        Text("Leagues").tag(RightMode.leagues)
                        Text("Live scores").tag(RightMode.scores)
                    }
                    .pickerStyle(.segmented).labelsHidden()
                    switch rightMode {
                    case .scores: ScoresPanel()
                    case .leagues: if let d = sports.detail { detailCard(d) } else { leagueCard }
                    }
                }
            }
            .frame(width: 310)
        }
        .onAppear { sports.viewing = true; if showTable { Task { await sports.loadStandings() } } }
        .onDisappear { sports.viewing = false }
    }

    // MARK: Your team

    private var myTeam: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "star.fill").font(.system(size: 11)).foregroundStyle(Theme.accentBright)
                VStack(alignment: .leading, spacing: 0) {
                    Text(sports.teamName).font(.system(size: 14, weight: .bold)).foregroundStyle(.white).lineLimit(1)
                    Text(sports.isDefaultTeam ? "Your team · default" : "Your team")
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                MoreTeamsMenu()
                changeTeamMenu
                IconButton(systemImage: "arrow.clockwise", help: "Refresh") { sports.refreshAll() }
            }

            if let error = sports.teamError {
                Text(error).font(.system(size: 11)).foregroundStyle(.orange)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if let live = sports.liveMatch {
                        liveCard(live)
                    } else if let next = sports.nextMatch {
                        nextCard(next)
                    } else if sports.teamError == nil {
                        ProgressView().controlSize(.small).padding(.top, 16).frame(maxWidth: .infinity)
                    }

                    let more = sports.upcoming.filter { $0.id != (sports.liveMatch ?? sports.nextMatch)?.id }.prefix(5)
                    if !more.isEmpty {
                        Text("Coming up").sectionTitle()
                        VStack(spacing: 2) { ForEach(Array(more)) { upcomingRow($0) } }
                    }

                    if !sports.results.isEmpty {
                        Text("Recent results").sectionTitle()
                        VStack(spacing: 2) { ForEach(sports.results.prefix(3)) { resultRow($0) } }
                    }

                    Toggle("Show the live score beside the notch", isOn: $sports.showActivity)
                        .toggleStyle(.switch).controlSize(.mini)
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                        .padding(.top, 2)
                    Toggle("Match alerts: 30 minutes before kick-off, goals and full time", isOn: $sports.matchAlerts)
                        .toggleStyle(.switch).controlSize(.mini)
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
            }
        }
    }

    private var changeTeamMenu: some View {
        Menu {
            if !sports.isDefaultTeam {
                Button("Back to \(SportsModel.defaultTeam.name) (default)") { sports.resetToDefaultTeam() }
                Divider()
            }
            if sports.teams.isEmpty {
                Text("Loading \(sports.league.name) teams…")
            } else {
                Section("\(sports.league.name) teams") {
                    ForEach(sports.teams) { team in
                        Button(team.name) { sports.track(team) }
                    }
                }
            }
            Text("Pick another league on the right to see its teams")
        } label: {
            Label("Change", systemImage: "arrow.left.arrow.right")
                .font(.system(size: 11, weight: .semibold))
        }
        .menuStyle(.borderlessButton).fixedSize()
        .help("Choose which team to track")
    }

    private func liveCard(_ m: SportsModel.Match) -> some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                Text("LIVE").font(.system(size: 9, weight: .heavy)).foregroundStyle(.white)
                    .padding(.horizontal, 5).padding(.vertical, 2).background(.red, in: Capsule())
                Text(m.detail).font(.system(size: 11, weight: .semibold).monospacedDigit()).foregroundStyle(.white)
                Spacer()
                Text(m.competition).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            scoreLine(m)
        }
        .padding(10)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
        .contentShape(Rectangle())
        .onTapGesture { sports.openDetail(m) }
        .help("Goals, cards and lineups")
    }

    private func nextCard(_ m: SportsModel.Match) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text("Next match").sectionTitle()
                Spacer()
                Text(m.date, style: .relative)
                    .font(.system(size: 13, weight: .bold).monospacedDigit()).foregroundStyle(Theme.accentBright)
            }
            scoreLine(m)
            HStack(spacing: 6) {
                Text(m.date.formatted(.dateTime.weekday(.wide).day().month(.abbreviated).hour().minute()))
                    .font(.system(size: 11)).foregroundStyle(.white)
                Spacer()
                Text(m.competition).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            if !m.venue.isEmpty {
                Text(m.venue).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
        }
        .padding(10)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
    }

    /// "Barcelona  2 – 1  Getafe", or the kick-off time before the match.
    private func scoreLine(_ m: SportsModel.Match) -> some View {
        HStack(spacing: 8) {
            teamBadge(m.home, alignment: .trailing)
            Group {
                if m.state == "pre" {
                    Text("vs").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.textSecondary)
                } else {
                    Text("\(m.home.score) – \(m.away.score)")
                        .font(.system(size: 20, weight: .bold).monospacedDigit()).foregroundStyle(.white)
                }
            }
            .frame(minWidth: 56)
            teamBadge(m.away, alignment: .leading)
        }
    }

    private func teamBadge(_ s: SportsModel.Side, alignment: Alignment) -> some View {
        let mine = s.id == sports.teamID
        return HStack(spacing: 5) {
            if alignment == .trailing { Spacer(minLength: 0) }
            if alignment == .trailing { name(s, mine) }
            logo(s.logo)
            if alignment == .leading { name(s, mine) }
            if alignment == .leading { Spacer(minLength: 0) }
        }
        .frame(maxWidth: .infinity)
    }

    private func name(_ s: SportsModel.Side, _ mine: Bool) -> some View {
        Text(s.name).font(.system(size: 12, weight: mine ? .bold : .medium))
            .foregroundStyle(mine ? Theme.accentBright : .white).lineLimit(1).minimumScaleFactor(0.7)
    }

    private func logo(_ url: String) -> some View {
        AsyncImage(url: URL(string: url)) { image in
            image.resizable().scaledToFit()
        } placeholder: {
            Image(systemName: "shield").foregroundStyle(Theme.textSecondary)
        }
        .frame(width: 22, height: 22)
    }

    private func opponent(of m: SportsModel.Match) -> (side: SportsModel.Side, home: Bool) {
        m.home.id == sports.teamID ? (m.away, true) : (m.home, false)
    }

    private func upcomingRow(_ m: SportsModel.Match) -> some View {
        let opp = opponent(of: m)
        return HStack(spacing: 6) {
            Text(m.date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)))
                .font(.system(size: 11).monospacedDigit()).foregroundStyle(Theme.textSecondary).frame(width: 74, alignment: .leading)
            Text("\(opp.home ? "vs" : "at") \(opp.side.name)")
                .font(.system(size: 11, weight: .medium)).foregroundStyle(.white).lineLimit(1)
            Spacer()
            Text(m.date.formatted(.dateTime.hour().minute())).font(.system(size: 11).monospacedDigit()).foregroundStyle(Theme.textSecondary)
        }
        .padding(.horizontal, 6).padding(.vertical, 3)
        .help(m.competition)
    }

    private func resultRow(_ m: SportsModel.Match) -> some View {
        let opp = opponent(of: m)
        let mine = opp.home ? m.home : m.away
        let theirs = opp.side
        let outcome: (String, Color) = mine.winner ? ("W", .green) : theirs.winner ? ("L", .red) : ("D", .yellow)
        return HStack(spacing: 6) {
            Text(outcome.0).font(.system(size: 10, weight: .heavy)).foregroundStyle(.black)
                .frame(width: 18, height: 18).background(outcome.1, in: RoundedRectangle(cornerRadius: 4))
            Text("\(opp.home ? "vs" : "at") \(theirs.name)")
                .font(.system(size: 11, weight: .medium)).foregroundStyle(.white).lineLimit(1)
            Spacer()
            Text("\(mine.score)–\(theirs.score)").font(.system(size: 11, weight: .semibold).monospacedDigit()).foregroundStyle(.white)
        }
        .padding(.horizontal, 6).padding(.vertical, 2)
        .contentShape(Rectangle())
        .onTapGesture { sports.openDetail(m) }
        .help("\(m.competition) · click for goals, cards and lineups")
    }

    // MARK: League

    private var leagueCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                leagueMenu
                Spacer()
                IconButton(systemImage: "arrow.clockwise", help: "Refresh") {
                    Task { await sports.loadLeague(); if showTable { await sports.loadStandings() } }
                }
            }
            Picker("", selection: $showTable) {
                Text("Fixtures").tag(false)
                Text("Table").tag(true)
            }
            .pickerStyle(.segmented).labelsHidden().controlSize(.small)
            .onChange(of: showTable) { _, on in if on && !sports.standingsLoaded { Task { await sports.loadStandings() } } }
            .onChange(of: sports.leagueID) { _, _ in if showTable { Task { await sports.loadStandings() } } }
            if showTable { tableView } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    if sports.loadingLeague {
                        ProgressView().controlSize(.small).padding(.top, 16).frame(maxWidth: .infinity)
                    } else if sports.leagueUnavailable {
                        Label("Sports data is unavailable right now (ESPN didn't answer). It'll try again shortly.", systemImage: "wifi.exclamationmark")
                            .font(.system(size: 11)).foregroundStyle(.orange).padding(.top, 12)
                    } else if sports.leagueMatches.isEmpty {
                        Text("No upcoming matches found.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary).padding(.top, 12)
                    }
                    ForEach(days, id: \.self) { day in
                        Text(dayTitle(day)).sectionTitle().padding(.top, 6)
                        ForEach(sports.leagueMatches.filter { Calendar.current.isDate($0.date, inSameDayAs: day) }) { leagueRow($0) }
                    }
                }
            }
            }
            Text(showTable ? "Tap a team to track it." : "Tap a team to track it, or a score for details.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
        }
    }

    // MARK: Table

    private var tableView: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 1) {
                if !sports.standingsLoaded {
                    ProgressView().controlSize(.small).padding(.top, 16).frame(maxWidth: .infinity)
                } else if sports.standings.isEmpty {
                    Text(sports.leagueID == SportsModel.indiaCricket ? "International cricket has no league table." : "No table for this competition right now.")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).padding(.top, 12)
                } else {
                    HStack(spacing: 4) {
                        Text("#").frame(width: 18, alignment: .trailing)
                        Text("Team").frame(maxWidth: .infinity, alignment: .leading)
                        Text("P").frame(width: 22)
                        Text(sports.leagueID.hasPrefix("cricket") ? "NRR" : "GD").frame(width: 38)
                        Text("Pts").frame(width: 26)
                    }
                    .font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                    ForEach(sports.standings) { row in
                        if row.rank == 1, !row.group.isEmpty {
                            Text(row.group).sectionTitle().padding(.top, 6)
                        }
                        let mine = row.teamID == sports.teamID
                        HStack(spacing: 4) {
                            Text("\(row.rank)").frame(width: 18, alignment: .trailing).foregroundStyle(Theme.textSecondary)
                            Button { sports.track(id: row.teamID, name: row.team, fromLeague: sports.leagueID) } label: {
                                Text(row.team).fontWeight(mine ? .bold : .medium).foregroundStyle(mine ? Theme.accentBright : .white)
                                    .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain).help("Track \(row.team)")
                            Text(row.played).frame(width: 22).foregroundStyle(Theme.textSecondary)
                            Text(row.extra).frame(width: 38).foregroundStyle(Theme.textSecondary)
                            Text(row.points).fontWeight(.bold).frame(width: 26).foregroundStyle(.white)
                        }
                        .font(.system(size: 11).monospacedDigit())
                        .padding(.vertical, 2).padding(.horizontal, 3)
                        .background(mine ? Theme.accent.opacity(0.22) : .clear, in: RoundedRectangle(cornerRadius: 5))
                    }
                }
            }
        }
    }

    // MARK: Match details

    private func detailCard(_ d: SportsModel.MatchDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Button { sports.closeDetail() } label: { Label("Back", systemImage: "chevron.left").font(.system(size: 11, weight: .semibold)) }
                    .buttonStyle(.plain).foregroundStyle(Theme.accentBright).keyboardShortcut(.cancelAction)
                Spacer()
                Text(d.match.competition).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            scoreLine(d.match)
            if !d.note.isEmpty || !d.match.detail.isEmpty {
                Text(d.note.isEmpty ? d.match.detail : d.note).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(2)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    if sports.loadingDetail {
                        ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(.top, 10)
                    } else if d.events.isEmpty && d.lineups.isEmpty {
                        Text(d.match.state == "pre" ? "Lineups appear about an hour before kick-off." : "No goals, cards or lineups available for this match.")
                            .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    }
                    if !d.events.isEmpty {
                        Text("Goals & cards").sectionTitle()
                        ForEach(d.events) { e in
                            HStack(alignment: .top, spacing: 6) {
                                Text(e.minute).font(.system(size: 10, weight: .semibold).monospacedDigit()).foregroundStyle(Theme.textSecondary).frame(width: 34, alignment: .trailing)
                                Text(icon(e.kind)).font(.system(size: 11))
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(e.players.isEmpty ? e.kind : e.players).font(.system(size: 11, weight: .medium)).foregroundStyle(.white).lineLimit(2)
                                    Text("\(e.kind) · \(e.team)").font(.system(size: 9)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                                }
                            }
                        }
                    }
                    ForEach(d.lineups) { l in
                        Text("\(l.team)\(l.formation.isEmpty ? "" : " · \(l.formation)")").sectionTitle().padding(.top, 6)
                        Text(l.starters.joined(separator: " · ")).font(.system(size: 10)).foregroundStyle(.white).fixedSize(horizontal: false, vertical: true)
                        if !l.subs.isEmpty {
                            Text("Bench: " + l.subs.joined(separator: " · ")).font(.system(size: 9)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    /// "161/5 (18/20 ov, target 156)" → "161/5" for lists; the full line is in the details.
    private func short(_ score: String) -> String {
        score.components(separatedBy: " (").first ?? score
    }

    private func icon(_ kind: String) -> String {
        if kind.hasPrefix("Yellow") { return "🟨" }
        if kind.hasPrefix("Red") { return "🟥" }
        if kind.hasPrefix("Substitution") { return "🔁" }
        return "⚽"
    }

    private var leagueMenu: some View {
        Menu {
            let sportsInOrder = SportsModel.leagues.reduce(into: [String]()) { if !$0.contains($1.sport) { $0.append($1.sport) } }
            ForEach(sportsInOrder, id: \.self) { sport in
                Section(sport) {
                    ForEach(SportsModel.leagues.filter { $0.sport == sport }) { league in
                        Button { sports.leagueID = league.id } label: {
                            Label(league.name, systemImage: sports.leagueID == league.id ? "checkmark" : league.symbol)
                        }
                    }
                }
            }
        } label: {
            Label(sports.league.name, systemImage: sports.league.symbol)
                .font(.system(size: 12, weight: .semibold))
        }
        .menuStyle(.borderlessButton).fixedSize()
        .help("Choose a league")
    }

    private var days: [Date] {
        var seen: [Date] = []
        for m in sports.leagueMatches {
            let d = Calendar.current.startOfDay(for: m.date)
            if !seen.contains(d) { seen.append(d) }
        }
        return seen
    }

    private func dayTitle(_ day: Date) -> String {
        if Calendar.current.isDateInToday(day) { return "Today" }
        if Calendar.current.isDateInTomorrow(day) { return "Tomorrow" }
        return day.formatted(.dateTime.weekday(.wide).day().month(.abbreviated))
    }

    private func leagueRow(_ m: SportsModel.Match) -> some View {
        let involvesMine = m.home.id == sports.teamID || m.away.id == sports.teamID
        // Cricket scores ("351/7") and status lines ("West Indies require 175 runs") are long:
        // a wider score column, each side's score under its name, and the status on its own line.
        let cricket = m.leaguePath.hasPrefix("cricket")
        return VStack(spacing: 2) {
            HStack(spacing: 4) {
                teamButton(m.home, alignment: .trailing)
                VStack(spacing: 0) {
                    if m.state == "pre" {
                        Text(m.date.formatted(.dateTime.hour().minute())).font(.system(size: 11).monospacedDigit()).foregroundStyle(Theme.textSecondary)
                    } else if cricket {
                        Text(m.isLive ? "LIVE" : "Result").font(.system(size: 9, weight: .heavy))
                            .foregroundStyle(m.isLive ? Color.green : Theme.textSecondary)
                    } else {
                        Text("\(short(m.home.score))–\(short(m.away.score))").font(.system(size: 12, weight: .bold).monospacedDigit())
                            .minimumScaleFactor(0.6).lineLimit(1)
                            .foregroundStyle(m.isLive ? Color.green : .white)
                        Text(m.isLive ? m.detail : "FT").font(.system(size: 8, weight: .semibold)).lineLimit(1)
                            .foregroundStyle(m.isLive ? Color.green : Theme.textSecondary)
                    }
                }
                .frame(width: 50)
                .contentShape(Rectangle())
                .onTapGesture { sports.openDetail(m) }
                .help(cricket ? "Match details" : "Goals, cards and lineups")
                teamButton(m.away, alignment: .leading)
            }
            if cricket && m.state != "pre" {
                HStack(spacing: 4) {
                    Text(short(m.home.score)).frame(maxWidth: .infinity, alignment: .trailing)
                    Color.clear.frame(width: 50, height: 1)
                    Text(short(m.away.score)).frame(maxWidth: .infinity, alignment: .leading)
                }
                .font(.system(size: 12, weight: .bold).monospacedDigit())
                .foregroundStyle(m.isLive ? Color.green : .white)
                if !m.detail.isEmpty {
                    Text(m.detail).font(.system(size: 10)).foregroundStyle(m.isLive ? Color.green : Theme.textSecondary)
                        .lineLimit(2).multilineTextAlignment(.center).frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.vertical, 3).padding(.horizontal, 4)
        .background(involvesMine ? Theme.accent.opacity(0.22) : .clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture { if cricket { sports.openDetail(m) } }
    }

    private func teamButton(_ s: SportsModel.Side, alignment: Alignment) -> some View {
        let mine = s.id == sports.teamID
        return Button {
            sports.track(id: s.id, name: s.name, fromLeague: sports.leagueID)
        } label: {
            Text(s.name).font(.system(size: 11, weight: mine ? .bold : .medium))
                .foregroundStyle(mine ? Theme.accentBright : .white)
                .lineLimit(1).minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, alignment: alignment)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(mine ? "You're tracking \(s.name)" : "Track \(s.name)")
    }
}
