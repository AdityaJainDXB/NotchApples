//
//  TennisView.swift
//  Notch apple
//
//  The Tennis tab: the week's matches on the left, under a banner for the tournament
//  (red for a Grand Slam), with Men, Women and Mixed tabs and arrows to earlier weeks;
//  favourite players and the ATP / WTA top 20 on the right. Click a player to follow them.
//  See TennisModel for where the data comes from.
//

import SwiftUI

struct TennisView: View {
    @StateObject private var tennis = TennisModel.shared
    @AppStorage("tennis.draw") private var drawRaw = TennisDraw.men.rawValue
    @AppStorage("tennis.kind") private var kind = "all"       // all, singles, doubles
    @AppStorage("tennis.tour") private var tour = "atp"
    @State private var eventID: String?
    @State private var newFavourite = ""

    private static let slamRed = Color(red: 0.78, green: 0.06, blue: 0.18)
    private static let ball = Color(red: 0.78, green: 0.96, blue: 0.2)
    private static let gold = Color(red: 1, green: 0.83, blue: 0.3)

    private var draw: TennisDraw { TennisDraw(rawValue: drawRaw) ?? .men }
    private var event: TennisEvent? { tennis.events.first { $0.id == eventID } ?? tennis.events.first }

    var body: some View {
        // Widths are set from the space the notch really gives this tab, so nothing inside can push the page wider.
        GeometryReader { geo in
            let sideWidth = min(260, max(190, geo.size.width * 0.34))
            let mainWidth = max(geo.size.width - sideWidth - 12, 0)
            HStack(alignment: .top, spacing: 12) {
                GlassCard { main }
                    .frame(width: mainWidth)
                    .overlay(RoundedRectangle(cornerRadius: Theme.corner, style: .continuous)
                        .strokeBorder(event?.slam == true ? Self.slamRed.opacity(0.8) : .clear, lineWidth: 1.5))
                    .shadow(color: event?.slam == true ? Self.slamRed.opacity(0.35) : .clear, radius: 12)
                GlassCard { side }
                    .frame(width: sideWidth)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
        .onAppear { tennis.viewing = true }
        .onDisappear { tennis.viewing = false }
        .onChange(of: tennis.week) { eventID = tennis.events.first(where: \.slam)?.id }
    }

    // MARK: Matches

    private var main: some View {
        VStack(alignment: .leading, spacing: 8) {
            banner
            if tennis.events.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 5) {
                        ForEach(tennis.events) { e in
                            let on = e.id == event?.id
                            Button { eventID = e.id } label: {
                                Text("\(e.slam ? "🏆 " : "")\(e.name)\(e.liveCount > 0 ? " •" : "")")
                                    .font(.system(size: 11, weight: .semibold)).lineLimit(1)
                                    .foregroundStyle(on ? .white : e.slam ? Color(red: 1, green: 0.55, blue: 0.56) : Theme.textSecondary)
                                    .padding(.horizontal, 9).padding(.vertical, 3)
                                    .background(Capsule().fill(on ? (e.slam ? Self.slamRed : Theme.accent) : Theme.surface))
                                    .overlay(Capsule().strokeBorder(e.slam && !on ? Self.slamRed : .clear))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            // One row when it fits, two when the card is narrow, so the pickers never push the page wider than the notch.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { drawPicker; Spacer(minLength: 4); kindPicker }
                VStack(alignment: .leading, spacing: 6) { drawPicker; kindPicker }
            }
            matchList
        }
    }

    private var drawPicker: some View {
        Picker("", selection: $drawRaw) {
            ForEach(TennisDraw.allCases) { d in
                let n = event?.matches.filter { $0.draw == d }.count ?? 0
                Text(n > 0 ? "\(d.title) \(n)" : d.title).tag(d.rawValue)
            }
        }
        .pickerStyle(.segmented).labelsHidden().fixedSize()
    }

    @ViewBuilder private var kindPicker: some View {
        if draw != .mixed {
            Picker("", selection: $kind) {
                Text("All").tag("all")
                Text("Singles").tag("singles")
                Text("Doubles").tag("doubles")
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
        }
    }

    private var banner: some View {
        let e = event
        let slam = e?.slam == true
        let tours = (e?.tours ?? []).map { $0.uppercased() }.joined(separator: " · ")
        let colors: [Color] = slam
            ? [Color(red: 0.48, green: 0, blue: 0.09), Self.slamRed, Color(red: 1, green: 0.35, blue: 0.37).opacity(0.3)]
            : [Color(red: 0.12, green: 0.54, blue: 0.3).opacity(0.6), Self.ball.opacity(0.15), Color.clear]
        let border: Color = slam ? Color(red: 1, green: 0.35, blue: 0.37).opacity(0.9) : Self.ball.opacity(0.35)
        return HStack(spacing: 12) {
            TennisBall().frame(width: 34, height: 34)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    if slam {
                        Text("🏆 GRAND SLAM").font(.system(size: 9, weight: .heavy)).tracking(0.8).foregroundStyle(Self.slamRed)
                            .padding(.horizontal, 6).padding(.vertical, 2).background(.white, in: RoundedRectangle(cornerRadius: 5))
                    } else {
                        Text(tours.isEmpty ? "TENNIS" : tours)
                            .font(.system(size: 9, weight: .heavy)).tracking(0.6).foregroundStyle(Color(red: 0.04, green: 0.14, blue: 0.06))
                            .padding(.horizontal, 6).padding(.vertical, 2).background(Self.ball, in: RoundedRectangle(cornerRadius: 5))
                    }
                    if let live = e?.liveCount, live > 0 {
                        Text("\(live) LIVE").font(.system(size: 9, weight: .heavy)).foregroundStyle(.white)
                            .padding(.horizontal, 5).padding(.vertical, 2).background(.red, in: Capsule())
                    }
                }
                Text(e?.name ?? "Tennis").font(.system(size: 16, weight: .heavy)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.7)
                Text(subtitle(e)).font(.system(size: 10)).foregroundStyle(.white.opacity(0.8)).lineLimit(1)
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 2) {
                HStack(spacing: 0) {
                    IconButton(systemImage: "chevron.left", help: "Previous week") { tennis.go(week: tennis.week - 1) }
                    Text(weekLabel).font(.system(size: 11, weight: .semibold).monospacedDigit()).foregroundStyle(.white).frame(minWidth: 74)
                    IconButton(systemImage: "chevron.right", help: "Next week") { tennis.go(week: tennis.week + 1) }
                    IconButton(systemImage: "arrow.clockwise", help: "Refresh") { tennis.refreshAll() }
                }
                HStack(spacing: 6) {
                    if tennis.week != 0 {
                        Button("Today") { tennis.go(week: 0) }.buttonStyle(.plain)
                            .font(.system(size: 10, weight: .semibold)).foregroundStyle(.white)
                    }
                    slamMenu
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing))
        )
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(border))
    }

    private func subtitle(_ e: TennisEvent?) -> String {
        guard let e else { return " " }
        var dates = ""
        if let s = e.start {
            dates = s.formatted(.dateTime.day().month(.abbreviated))
            if let end = e.end { dates += " – " + end.formatted(.dateTime.day().month(.abbreviated)) }
        }
        let text = [e.place, dates].filter { !$0.isEmpty }.joined(separator: " · ")
        return text.isEmpty ? " " : text
    }

    private var weekLabel: String {
        switch tennis.week {
        case 0: return "This week"
        case -1: return "Last week"
        case 1: return "Next week"
        default:
            let d = Date.now.addingTimeInterval(Double(tennis.week) * 7 * 86400)
            return "Week of " + d.formatted(.dateTime.day().month(.abbreviated))
        }
    }

    private struct SlamTarget: Identifiable {
        let id: String      // "Wimbledon 2026"
        let date: Date
    }

    /// Grand Slams from last year to next, newest first.
    private var slamTargets: [SlamTarget] {
        let cal = Calendar(identifier: .gregorian)
        let year = cal.component(.year, from: Date.now)
        var all: [SlamTarget] = []
        for y in (year - 1)...(year + 1) {
            for s in TennisLogic.slamDates {
                if let d = cal.date(from: DateComponents(year: y, month: s.month, day: s.day)) {
                    all.append(SlamTarget(id: "\(s.name) \(y)", date: d))
                }
            }
        }
        return all.sorted { $0.date > $1.date }
    }

    /// The last four Grand Slams that have started, and the next one.
    private var slamMenu: some View {
        let all = slamTargets
        let next = all.last { $0.date > Date.now }
        let past = Array(all.filter { $0.date <= Date.now }.prefix(4))
        return Menu {
            if let n = next {
                Button("Next: \(n.id)") { tennis.jump(to: n.date) }
                Divider()
            }
            ForEach(past) { s in
                Button("🏆 \(s.id)") { tennis.jump(to: s.date) }
            }
        } label: {
            Label("Slams", systemImage: "trophy.fill").font(.system(size: 10, weight: .semibold))
        }
        .menuStyle(.borderlessButton).fixedSize()
        .help("Jump to a Grand Slam")
    }

    private var visibleMatches: [TennisMatch] {
        var ms = (event?.matches ?? []).filter { $0.draw == draw }
        if draw != .mixed && kind != "all" { ms = ms.filter { $0.isDoubles == (kind == "doubles") } }
        let sorted = TennisLogic.sorted(ms)
        // Favourites' matches first, keeping the order otherwise.
        return sorted.filter { m in m.players.contains { tennis.isFavourite($0.name) } }
            + sorted.filter { m in !m.players.contains { tennis.isFavourite($0.name) } }
    }

    @ViewBuilder private var matchList: some View {
        let ms = visibleMatches
        if tennis.loading && (ms.isEmpty || !tennis.loaded) {
            ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(.top, 30)
        } else if let e = tennis.error, tennis.events.isEmpty {
            message("wifi.exclamationmark", e, "Check your connection, then refresh.")
        } else if event == nil {
            message("calendar", "No tournaments this week", "Use ‹ for earlier weeks, or Slams to jump to a Grand Slam.")
        } else if ms.isEmpty {
            message("tennisball", "No \(draw.title.lowercased())'s matches here",
                    draw == .mixed ? "Mixed doubles is played at the Grand Slams." : "Try another tournament or week.")
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(ms.enumerated()), id: \.element.id) { i, m in
                        if i == 0 || ms[i - 1].state != m.state {
                            Text(m.state == .live ? "LIVE NOW" : m.state == .pre ? "COMING UP" : "RESULTS")
                                .font(.system(size: 9, weight: .heavy)).tracking(0.8)
                                .foregroundStyle(m.state == .live ? .red : Theme.textSecondary)
                                .padding(.top, i == 0 ? 0 : 4)
                        }
                        matchCard(m)
                    }
                }
            }
        }
    }

    private func message(_ symbol: String, _ title: String, _ detail: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: symbol).font(.system(size: 22)).foregroundStyle(Theme.textSecondary)
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
            Text(detail).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.top, 30)
    }

    private func matchCard(_ m: TennisMatch) -> some View {
        let slam = event?.slam == true
        let edge: Color = m.state == .live ? .red : slam ? Self.slamRed : Self.ball.opacity(0.6)
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text([m.round, m.court].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.system(size: 9)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                Spacer()
                status(m)
            }
            ForEach(m.players.indices, id: \.self) { i in playerRow(m, i) }
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(m.state == .live ? AnyShapeStyle(LinearGradient(colors: [.red.opacity(0.14), Theme.surface], startPoint: .leading, endPoint: .trailing))
                                        : AnyShapeStyle(Theme.surface))
        )
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: 10, bottomLeadingRadius: 10).fill(edge).frame(width: 3)
        }
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(m.state == .live ? Color.red.opacity(0.35) : .clear))
    }

    @ViewBuilder private func status(_ m: TennisMatch) -> some View {
        switch m.state {
        case .live:
            HStack(spacing: 4) {
                Circle().fill(.red).frame(width: 6, height: 6).shadow(color: .red, radius: 3)
                Text(m.detail.isEmpty || m.detail.lowercased() == "in progress" ? "LIVE" : m.detail)
                    .font(.system(size: 9, weight: .heavy)).foregroundStyle(.red)
            }
        case .pre:
            Text(m.date.map { $0.formatted(.dateTime.weekday(.abbreviated).hour().minute()) } ?? "Scheduled")
                .font(.system(size: 9).monospacedDigit()).foregroundStyle(Theme.textSecondary)
        case .post:
            Text(m.detail.isEmpty ? "Final" : m.detail).font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
        }
    }

    private func playerRow(_ m: TennisMatch, _ i: Int) -> some View {
        let p = m.players[i]
        let other = m.players.count == 2 ? m.players[1 - i] : nil
        let fav = tennis.isFavourite(p.name)
        let lost = m.state == .post && m.players.contains(where: \.winner) && !p.winner
        return HStack(spacing: 6) {
            flag(p.flagURL, country: p.country)
            Text((fav ? "★ " : "") + p.name)
                .font(.system(size: 12, weight: p.winner ? .heavy : .medium))
                .foregroundStyle(fav ? Self.gold : .white).lineLimit(1)
            if let seed = p.seed { Text("(\(seed))").font(.system(size: 9)).foregroundStyle(Theme.textSecondary) }
            if m.state == .live && p.serving {
                Circle().fill(Self.ball).frame(width: 6, height: 6).shadow(color: Self.ball, radius: 3).help("Serving")
            }
            Spacer(minLength: 4)
            if p.winner { Image(systemName: "checkmark").font(.system(size: 9, weight: .heavy)).foregroundStyle(.green) }
            HStack(spacing: 3) {
                ForEach(p.sets.indices, id: \.self) { k in setBox(m, p, other, k) }
            }
        }
        .frame(height: 20)
        .opacity(lost ? 0.6 : 1)
        .contentShape(Rectangle())
        .onTapGesture { if !p.isPair { tennis.toggleFavourite(p.name) } }
        .help(p.isPair ? p.name : fav ? "Stop following \(p.name)" : "Follow \(p.name): their live score shows beside the notch")
    }

    private func setBox(_ m: TennisMatch, _ p: TennisPlayer, _ other: TennisPlayer?, _ k: Int) -> some View {
        let s = p.sets[k]
        let current = m.state == .live && k == p.sets.count - 1
        let theirs = other.flatMap { k < $0.sets.count ? $0.sets[k].games : nil } ?? 0
        let won = s.won || (!current && s.games > theirs)
        return HStack(alignment: .top, spacing: 0) {
            Text("\(s.games)").font(.system(size: 11, weight: .semibold).monospacedDigit())
            if let tb = s.tiebreak { Text("\(tb)").font(.system(size: 7, weight: .semibold)).baselineOffset(5) }
        }
        .foregroundStyle(current ? Color(red: 0.04, green: 0.14, blue: 0.06) : won ? .white : Theme.textSecondary)
        .frame(minWidth: 18).padding(.horizontal, 2).padding(.vertical, 1)
        .background(RoundedRectangle(cornerRadius: 4).fill(current ? (event?.slam == true ? Color(red: 1, green: 0.35, blue: 0.37) : Self.ball)
                                                                   : won ? Color.white.opacity(0.14) : Color.white.opacity(0.04)))
    }

    @ViewBuilder private func flag(_ url: String, country: String) -> some View {
        if let u = URL(string: url), !url.isEmpty {
            AsyncImage(url: u) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Color.white.opacity(0.1)
            }
            .frame(width: 14, height: 10).clipShape(RoundedRectangle(cornerRadius: 2)).help(country)
        } else if !TennisLogic.flagEmoji(country).isEmpty {
            Text(TennisLogic.flagEmoji(country)).font(.system(size: 11)).frame(width: 14)
        } else {
            Color.clear.frame(width: 14, height: 10)
        }
    }

    // MARK: Favourites and top 20

    private var side: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: "star.fill").foregroundStyle(Self.gold)
                Text("Favourite players").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                Spacer()
                Toggle("", isOn: $tennis.showActivity).toggleStyle(.switch).controlSize(.mini).labelsHidden()
                    .help("Show a favourite's live score beside the notch")
            }
            if tennis.favourites.isEmpty {
                Text("Star players below or click one in a match. Their live score shows beside the notch.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        ForEach(tennis.favourites, id: \.self) { f in
                            Button { tennis.toggleFavourite(f) } label: {
                                HStack(spacing: 3) {
                                    Text(f).lineLimit(1)
                                    Image(systemName: "xmark").font(.system(size: 7, weight: .bold))
                                }
                                .font(.system(size: 10, weight: .semibold)).foregroundStyle(Self.gold)
                                .padding(.horizontal, 7).padding(.vertical, 3)
                                .background(Capsule().fill(Self.gold.opacity(0.14)))
                                .overlay(Capsule().strokeBorder(Self.gold.opacity(0.35)))
                            }
                            .buttonStyle(.plain).help("Stop following \(f)")
                        }
                    }
                }
            }
            HStack(spacing: 4) {
                TextField("Add a favourite player…", text: $newFavourite)
                    .textFieldStyle(.roundedBorder).font(.system(size: 11))
                    .onSubmit(addFavourite)
                Menu {
                    ForEach(tennis.allPlayers.filter { !tennis.isFavourite($0) }, id: \.self) { n in
                        Button(n) { tennis.toggleFavourite(n) }
                    }
                } label: { Image(systemName: "person.crop.circle.badge.plus") }
                .menuStyle(.borderlessButton).fixedSize().help("Pick from everyone playing and the top 20")
            }

            HStack {
                Text("Top 20").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                Spacer()
                Picker("", selection: $tour) {
                    Text("ATP").tag("atp")
                    Text("WTA").tag("wta")
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
            }
            .padding(.top, 4)
            if !tennis.rankingsLive && !tennis.rankings.isEmpty {
                Text("Saved list · live rankings appear when ESPN answers").font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
            }
            ScrollView {
                VStack(spacing: 2) {
                    let rows = tennis.rankings[tour] ?? []
                    if rows.isEmpty { ProgressView().controlSize(.small).padding(.top, 20) }
                    ForEach(rows) { r in rankRow(r) }
                }
            }
        }
    }

    private func addFavourite() {
        let n = newFavourite.trimmingCharacters(in: .whitespaces)
        if !n.isEmpty && !tennis.isFavourite(n) { tennis.toggleFavourite(n) }
        newFavourite = ""
    }

    private func rankRow(_ r: TennisRanked) -> some View {
        let fav = tennis.isFavourite(r.name)
        let medal: Color = r.rank == 1 ? Self.gold : r.rank == 2 ? Color(white: 0.87) : r.rank == 3 ? Color(red: 0.89, green: 0.64, blue: 0.42) : .white
        return HStack(spacing: 6) {
            Text("\(r.rank)").font(.system(size: 11, weight: .heavy).monospacedDigit()).foregroundStyle(medal).frame(width: 18, alignment: .trailing)
            Text(r.move > 0 ? "▲\(r.move)" : r.move < 0 ? "▼\(-r.move)" : "")
                .font(.system(size: 8, weight: .bold)).foregroundStyle(r.move > 0 ? .green : .red).frame(width: 20, alignment: .leading)
            flag(r.flagURL, country: r.country)
            Text(r.name).font(.system(size: 11, weight: fav ? .bold : .medium)).foregroundStyle(fav ? Theme.accentBright : .white).lineLimit(1)
            Spacer(minLength: 2)
            if let pts = r.points {
                Text(pts.formatted()).font(.system(size: 9).monospacedDigit()).foregroundStyle(Theme.textSecondary)
            }
            Image(systemName: fav ? "star.fill" : "star").font(.system(size: 10)).foregroundStyle(fav ? Self.gold : Theme.textSecondary)
        }
        .padding(.horizontal, 6).padding(.vertical, 3)
        .background(fav ? Theme.accent.opacity(0.18) : .clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture { tennis.toggleFavourite(r.name) }
        .help(fav ? "Stop following \(r.name)" : "Follow \(r.name)")
    }
}

/// A spinning tennis ball for the banner.
private struct TennisBall: View {
    @State private var spin = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle().fill(RadialGradient(colors: [Color(red: 0.96, green: 1, blue: 0.6), Color(red: 0.78, green: 0.96, blue: 0.2), Color(red: 0.56, green: 0.75, blue: 0.07)],
                                         center: UnitPoint(x: 0.35, y: 0.3), startRadius: 1, endRadius: 22))
            Circle().stroke(Color.white.opacity(0.9), lineWidth: 2).frame(width: 30, height: 30).offset(x: -21).mask(Circle())
            Circle().stroke(Color.white.opacity(0.9), lineWidth: 2).frame(width: 30, height: 30).offset(x: 21).mask(Circle())
        }
        .clipShape(Circle())
        .shadow(color: Color(red: 0.78, green: 0.96, blue: 0.2).opacity(0.5), radius: 7)
        .rotationEffect(.degrees(spin ? 360 : 0))
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 7).repeatForever(autoreverses: false)) { spin = true }
        }
    }
}
