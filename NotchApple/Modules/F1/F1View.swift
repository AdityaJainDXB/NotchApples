//
//  F1View.swift
//  Notch apple
//
//  The F1 tab: live timing tower on the left; countdown, weekend schedule and
//  standings on the right. See F1Model for where the data comes from.
//

import SwiftUI

struct F1View: View {
    @StateObject private var f1 = F1Model.shared
    @State private var tab = 0

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            GlassCard { tower }
            VStack(spacing: 10) {
                GlassCard { nextUp }
                GlassCard { standings }
            }
            .frame(width: 250)
        }
        .onAppear { f1.viewing = true }
        .onDisappear { f1.viewing = false }
    }

    // MARK: Timing tower

    private var tower: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                if f1.isLive {
                    Text("LIVE").font(.system(size: 9, weight: .heavy)).foregroundStyle(.white)
                        .padding(.horizontal, 5).padding(.vertical, 2).background(.red, in: Capsule())
                }
                Text(f1.sessionTitle.isEmpty ? "Formula 1" : f1.sessionTitle)
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                Spacer()
                if let lap = f1.lap, lap.total > 0 {
                    Text("Lap \(lap.current)/\(lap.total)").font(.system(size: 11, weight: .medium).monospacedDigit()).foregroundStyle(Theme.textSecondary)
                }
                flag
                IconButton(systemImage: "arrow.clockwise", help: "Refresh") { f1.refreshAll() }
            }
            if f1.orderOnly {
                Text(f1.isLive ? "Live running order · gaps and tyres appear when the session's timing is published"
                               : "Provisional order · full timing appears when F1 publishes it")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1).minimumScaleFactor(0.8)
            } else if !f1.isLive, !f1.status.isEmpty, !f1.cars.isEmpty {
                Text("Latest session · \(f1.status == "Finalised" || f1.status == "Ends" ? "final classification" : f1.status.lowercased())")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
            if let e = f1.error { Text(e).font(.system(size: 11)).foregroundStyle(.orange) }
            ScrollView {
                LazyVStack(spacing: 2) {
                    if f1.cars.isEmpty && f1.error == nil {
                        ProgressView().controlSize(.small).padding(.top, 20)
                    }
                    ForEach(f1.cars) { row($0) }
                }
            }
        }
    }

    private func row(_ c: F1Model.Car) -> some View {
        let followed = c.code.caseInsensitiveCompare(f1.followedDriver) == .orderedSame
        return HStack(spacing: 6) {
            Text("\(c.position)").font(.system(size: 11, weight: .bold).monospacedDigit()).foregroundStyle(.white).frame(width: 18, alignment: .trailing)
            RoundedRectangle(cornerRadius: 1.5).fill(c.colour).frame(width: 3, height: 14)
            Text(c.code).font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundStyle(c.out ? Theme.textSecondary : .white).frame(width: 34, alignment: .leading)
            tyre(c.tyre)
            Text(f1.orderOnly ? c.team : c.out ? "OUT" : c.inPit ? "PIT" : (c.position == 1 ? (f1.sessionType == "Race" ? "Leader" : c.bestLap) : (f1.sessionType == "Race" ? c.interval : c.gap)))
                .font(.system(size: 11, weight: .medium).monospacedDigit())
                .foregroundStyle(c.inPit ? .yellow : c.out ? .red.opacity(0.8) : .white)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(c.lastLap.isEmpty ? c.bestLap : c.lastLap).font(.system(size: 10).monospacedDigit()).foregroundStyle(Theme.textSecondary)
        }
        .padding(.horizontal, 6).padding(.vertical, 3)
        .background(followed ? Theme.accent.opacity(0.25) : .clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture { f1.followedDriver = followed ? "" : c.code }
        .help(followed ? "Stop following \(c.code)" : "Follow \(c.code): their position shows beside the notch during sessions")
    }

    private func tyre(_ compound: String) -> some View {
        let (letter, colour): (String, Color) = switch compound.uppercased() {
        case "SOFT": ("S", .red)
        case "MEDIUM": ("M", .yellow)
        case "HARD": ("H", .white)
        case "INTERMEDIATE": ("I", .green)
        case "WET": ("W", .blue)
        default: ("", .clear)
        }
        return Text(letter).font(.system(size: 8, weight: .heavy)).foregroundStyle(colour)
            .frame(width: 13, height: 13)
            .overlay(Circle().strokeBorder(colour, lineWidth: letter.isEmpty ? 0 : 1.5))
    }

    @ViewBuilder private var flag: some View {
        let t = f1.track
        if !t.isEmpty, f1.isLive {
            let (label, colour): (String, Color) =
                t.contains("Red") ? ("Red flag", .red) :
                t.contains("VSC") ? ("VSC", .yellow) :
                t.contains("SC") ? ("Safety car", .yellow) :
                t.contains("Yellow") ? ("Yellow", .yellow) : ("Green", .green)
            Label(label, systemImage: "flag.fill").font(.system(size: 10, weight: .semibold)).foregroundStyle(colour)
        }
    }

    // MARK: Next session

    private var nextUp: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let w = f1.weekend {
                Text("Round \(w.round) · \(w.name)").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                    .lineLimit(1).minimumScaleFactor(0.75)
                if let next = f1.nextSession {
                    HStack(alignment: .firstTextBaseline) {
                        Text("\(next.name) starts in").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                        Spacer()
                        Text(next.start, style: .relative).font(.system(size: 13, weight: .bold).monospacedDigit()).foregroundStyle(Theme.accentBright)
                    }
                }
                ForEach(w.sessions) { s in
                    HStack {
                        Text(s.name).font(.system(size: 11)).foregroundStyle(s.start < .now ? Theme.textSecondary : .white)
                        Spacer()
                        Text(s.start.formatted(.dateTime.weekday(.abbreviated).hour().minute()))
                            .font(.system(size: 11).monospacedDigit()).foregroundStyle(Theme.textSecondary)
                    }
                }
            } else {
                Text("Loading the schedule…").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
        }
    }

    // MARK: Standings

    private var standings: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Menu {
                    Button("None") { f1.favouriteTeam = "" }
                    Divider()
                    ForEach(f1.teamNames, id: \.self) { t in
                        Button { f1.favouriteTeam = t } label: { Label(t, systemImage: t == f1.favouriteTeam ? "checkmark" : "") }
                    }
                } label: {
                    Label(f1.favouriteTeam.isEmpty ? "Favourite team" : f1.favouriteTeam, systemImage: "star.fill").font(.system(size: 11, weight: .medium))
                }
                .menuStyle(.borderlessButton).fixedSize()
                .help("Your team's best-placed car shows beside the notch during sessions (unless you follow a driver)")
                Spacer()
                if !f1.followedDriver.isEmpty {
                    Text("Following \(f1.followedDriver)").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
            }
            Picker("", selection: $tab) {
                Text("Drivers").tag(0)
                Text("Teams").tag(1)
            }
            .pickerStyle(.segmented).labelsHidden()
            ScrollView {
                VStack(spacing: 3) {
                    ForEach(tab == 0 ? f1.drivers : f1.teams) { s in
                        HStack(spacing: 6) {
                            Text(s.position).font(.system(size: 11, weight: .bold).monospacedDigit()).foregroundStyle(.white).frame(width: 18, alignment: .trailing)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(s.name).font(.system(size: 11, weight: .medium)).foregroundStyle(.white).lineLimit(1)
                                Text(s.detail).font(.system(size: 9)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                            }
                            Spacer()
                            Text(s.points).font(.system(size: 11, weight: .semibold).monospacedDigit()).foregroundStyle(Theme.accentBright)
                        }
                    }
                }
            }
        }
    }
}
