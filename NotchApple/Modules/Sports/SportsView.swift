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

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            GlassCard { myTeam }
            GlassCard { leagueCard }.frame(width: 310)
        }
        .onAppear { sports.viewing = true }
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
        .help(m.competition)
    }

    // MARK: League

    private var leagueCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                leagueMenu
                Spacer()
                IconButton(systemImage: "arrow.clockwise", help: "Refresh") { Task { await sports.loadLeague() } }
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    if sports.loadingLeague {
                        ProgressView().controlSize(.small).padding(.top, 16).frame(maxWidth: .infinity)
                    } else if sports.leagueMatches.isEmpty {
                        Text("No upcoming matches found.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary).padding(.top, 12)
                    }
                    ForEach(days, id: \.self) { day in
                        Text(dayTitle(day)).sectionTitle().padding(.top, 6)
                        ForEach(sports.leagueMatches.filter { Calendar.current.isDate($0.date, inSameDayAs: day) }) { leagueRow($0) }
                    }
                }
            }
            Text("Tap a team to track it.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
        }
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
        return HStack(spacing: 4) {
            teamButton(m.home, alignment: .trailing)
            VStack(spacing: 0) {
                if m.state == "pre" {
                    Text(m.date.formatted(.dateTime.hour().minute())).font(.system(size: 11).monospacedDigit()).foregroundStyle(Theme.textSecondary)
                } else {
                    Text("\(m.home.score)–\(m.away.score)").font(.system(size: 12, weight: .bold).monospacedDigit())
                        .foregroundStyle(m.isLive ? Color.green : .white)
                    Text(m.isLive ? m.detail : "FT").font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(m.isLive ? Color.green : Theme.textSecondary)
                }
            }
            .frame(width: 50)
            teamButton(m.away, alignment: .leading)
        }
        .padding(.vertical, 3).padding(.horizontal, 4)
        .background(involvesMine ? Theme.accent.opacity(0.22) : .clear, in: RoundedRectangle(cornerRadius: 6))
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
