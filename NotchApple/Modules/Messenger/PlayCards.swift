//
//  PlayCards.swift
//  Notch Apple
//
//  The screens for Connect Four, Rock Paper Scissors and Battleship in a Messenger room or friend chat: an invite with
//  Accept, then the game, then Rematch. The rules are in TwoPlayerGames.swift and the glue in PlayController.swift;
//  this only draws them and passes the player's choices on.
//

import SwiftUI

/// The "Games" menu in a chat header: tic-tac-toe plus the games here. Shown only while no game is open.
struct GamesMenu: View {
    var tictactoe: () -> Void
    var start: (PlayKind) -> Void

    var body: some View {
        Menu {
            Button("⭕ Tic-tac-toe", action: tictactoe)
            ForEach(PlayKind.allCases, id: \.self) { kind in
                Button("\(kind.emoji) \(kind.title)") { start(kind) }
            }
        } label: { Label("Games", systemImage: "gamecontroller") }
        .menuStyle(.borderlessButton).fixedSize()
        .help("Invite them to a two-player game")
    }
}

struct PlayCard: View {
    @ObservedObject var play: PlayController
    /// Which chat this is, so the notch can open taller while a board is up (NotchPrefs.chatGame).
    let source: String

    private var myID: String { play.myID }

    var body: some View {
        if let s = play.session {
            VStack(spacing: 8) {
                switch s.status {
                case .invited, .cancelled: invite(s)
                default: game(s)
                }
            }
            .padding(10).frame(maxWidth: .infinity)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
            .onAppear { NotchPrefs.chatGame(source, true) }
            .onDisappear { NotchPrefs.chatGame(source, false) }
        }
    }

    // MARK: Invite

    private func invite(_ s: PlaySession) -> some View {
        VStack(spacing: 6) {
            Text("\(s.kind.emoji) " + inviteLine(s)).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
            if s.status == .cancelled {
                Button("Close") { play.close() }.buttonStyle(PurpleButtonStyle(prominent: false))
            } else if s.inviter == myID {
                Button("Cancel invite") { play.cancelInvite() }.buttonStyle(PurpleButtonStyle(prominent: false))
            } else if s.accepted != myID {
                Button("Accept") { play.accept() }.buttonStyle(PurpleButtonStyle())
            }
        }
    }

    private func inviteLine(_ s: PlaySession) -> String {
        let who = play.name(s.inviter)
        if s.status == .cancelled { return "\(who) cancelled the \(s.kind.title) invite." }
        if s.inviter == myID { return "Waiting for someone to accept your \(s.kind.title) invite…" }
        if s.accepted == myID { return "Waiting for \(who) to start…" }
        return "\(who) invites you to play \(s.kind.title)."
    }

    // MARK: Game

    private func game(_ s: PlaySession) -> some View {
        let me = s.index(of: myID)
        return VStack(spacing: 8) {
            Text("\(s.kind.emoji) \(s.kind.title) · " + headline(s, me: me)).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            switch s.kind {
            case .connect4: connectFour(s, me: me)
            case .rps: rps(s, me: me)
            case .battleship: battleship(s, me: me)
            }
            Text(statusLine(s, me: me)).font(.system(size: 12, weight: myTurn(s, me: me) ? .bold : .regular)).foregroundStyle(.white).multilineTextAlignment(.center)
            HStack(spacing: 8) {
                if s.status == .finished, me != nil {
                    let asked = s.rematch.contains(myID)
                    Button(asked ? "Waiting for a rematch…" : "Rematch") { play.rematch() }.buttonStyle(PurpleButtonStyle(prominent: !asked)).disabled(asked)
                }
                if s.status == .playing, me != nil { Button("Leave game") { play.leave() }.buttonStyle(PurpleButtonStyle(prominent: false)) }
                if s.status != .playing { Button("Close") { play.close() }.buttonStyle(PurpleButtonStyle(prominent: false)) }
            }
        }
    }

    private func headline(_ s: PlaySession, me: Int?) -> String {
        guard let me, let other = s.player(1 - me) else { return "Watching \(play.name(s.p1)) vs \(play.name(s.p2))" }
        switch s.kind {
        case .connect4: return "You are \(me == 0 ? "red" : "yellow") · \(play.name(other)) is \(me == 0 ? "yellow" : "red")"
        case .rps: return "You vs \(play.name(other)) · first to \(RockPaperScissors.wins)"
        case .battleship: return "You vs \(play.name(other))"
        }
    }

    private func myTurn(_ s: PlaySession, me: Int?) -> Bool {
        guard s.status == .playing, let me else { return false }
        switch s.kind {
        case .connect4: return s.c4.moves % 2 == me
        case .rps: return s.rps.commit[me] == nil
        case .battleship: return s.bs.bothReady ? s.bs.shooter == me : !play.iCommittedFleet
        }
    }

    private func statusLine(_ s: PlaySession, me: Int?) -> String {
        switch s.status {
        case .finished:
            guard let w = s.winner else { return "A draw" }
            return me != nil ? (w == myID ? "You won! 🎉" : "\(play.name(w)) won") : "\(play.name(w)) won"
        case .ended: return "\(play.name(s.leaver)) left the game"
        default: break
        }
        switch s.kind {
        case .connect4: return myTurn(s, me: me) ? "Your turn" : "\(play.name(s.player(s.c4.moves % 2)))'s turn"
        case .rps:
            guard let me else { return "Playing…" }
            if s.rps.commit[me] == nil { return "Choose rock, paper or scissors" }
            return s.rps.commit[1 - me] == nil ? "Waiting for \(play.name(s.player(1 - me)))…" : "Showing picks…"
        case .battleship:
            guard let me else { return "Playing…" }
            if !s.bs.bothReady { return play.iCommittedFleet ? "Waiting for \(play.name(s.player(1 - me))) to place their ships…" : "Shuffle until you like your fleet, then press Ready" }
            if s.bs.pendingCell != nil { return "Waiting for the answer…" }
            return s.bs.shooter == me ? "Your shot: pick a square in Enemy waters" : "\(play.name(s.player(1 - me))) is aiming…"
        }
    }

    // MARK: Connect Four

    private func connectFour(_ s: PlaySession, me: Int?) -> some View {
        HStack(spacing: 3) {
            ForEach(0..<ConnectFour.cols, id: \.self) { col in
                Button { play.drop(column: col) } label: {
                    VStack(spacing: 3) {
                        ForEach(0..<ConnectFour.rows, id: \.self) { row in disc(s, cell: row * ConnectFour.cols + col) }
                    }
                    .padding(3).background(Color.blue.opacity(0.55), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(!PlayRules.canDrop(s, id: myID, column: col))
                .accessibilityLabel("Drop in column \(col + 1)")
            }
        }
    }

    private func disc(_ s: PlaySession, cell: Int) -> some View {
        let v = s.c4.cells[cell]
        let win = s.c4.line?.contains(cell) ?? false
        return Circle()
            .fill(v == 1 ? Color.red : (v == 2 ? Color.yellow : Color.black.opacity(0.55)))
            .frame(width: 26, height: 26)
            .overlay(Circle().stroke(win ? Color.white : (s.c4.last == cell ? Color.white.opacity(0.6) : .clear), lineWidth: win ? 3 : 1.5))
    }

    // MARK: Rock Paper Scissors

    private func rps(_ s: PlaySession, me: Int?) -> some View {
        VStack(spacing: 8) {
            if let me {
                HStack(spacing: 14) {
                    Text("You \(s.rps.score[me])").font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                    Text("–").foregroundStyle(Theme.textSecondary)
                    Text("\(play.name(s.player(1 - me))) \(s.rps.score[1 - me])").font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                }
                if let last = s.rps.last {
                    let mine = last[me], theirs = last[1 - me]
                    Text("Last game: \(RockPaperScissors.emoji[mine]) vs \(RockPaperScissors.emoji[theirs]) · " + (s.rps.lastWinner == nil ? "a tie" : (s.rps.lastWinner == me ? "you won it" : "they won it")))
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
                HStack(spacing: 10) {
                    ForEach(0..<3, id: \.self) { i in
                        Button { play.pick(i) } label: {
                            VStack(spacing: 2) {
                                Text(RockPaperScissors.emoji[i]).font(.system(size: 28))
                                Text(RockPaperScissors.names[i]).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                            }
                            .frame(width: 78, height: 62)
                            .background(play.myPick == i ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Theme.surfaceHover), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .disabled(s.status != .playing || s.rps.commit[me] != nil)
                    }
                }
            } else {
                Text("\(play.name(s.p1)) \(s.rps.score[0]) – \(s.rps.score[1]) \(play.name(s.p2))").font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
            }
        }
    }

    // MARK: Battleship

    private func battleship(_ s: PlaySession, me: Int?) -> some View {
        VStack(spacing: 8) {
            if let me {
                if !s.bs.bothReady && !play.iCommittedFleet {
                    // Placing ships: your fleet, then Shuffle or Ready.
                    VStack(spacing: 6) {
                        Text("Your fleet").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                        grid(own: play.fleet, shots: nil, tappable: false, s: s, fire: { _ in })
                        HStack(spacing: 8) {
                            Button("Shuffle") { play.shuffleFleet() }.buttonStyle(PurpleButtonStyle(prominent: false))
                            Button("Ready") { play.readyFleet() }.buttonStyle(PurpleButtonStyle())
                        }
                    }
                } else {
                    HStack(alignment: .top, spacing: 18) {
                        VStack(spacing: 4) {
                            Text("Enemy waters").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                            grid(own: nil, shots: s.bs.shots[1 - me], tappable: true, s: s, fire: { play.fire($0) })
                            Text("Sunk: \(sunkText(s.bs.sunk[1 - me]))").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                        }
                        VStack(spacing: 4) {
                            Text("Your fleet").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                            grid(own: play.fleet, shots: s.bs.shots[me], tappable: false, s: s, fire: { _ in })
                            Text("Lost: \(sunkText(s.bs.sunk[me]))").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                        }
                    }
                }
                if s.status == .finished, let other = s.player(1 - me) {
                    switch s.bs.revealed[1 - me] {
                    case .some(true): Text("✅ \(play.name(other))'s fleet matched every answer they gave.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                    case .some(false): Text("⚠️ \(play.name(other))'s fleet didn't match their answers. They may have cheated.").font(.system(size: 10, weight: .semibold)).foregroundStyle(.orange)
                    case .none: Text("Checking \(play.name(other))'s fleet…").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                    }
                }
            } else {
                Text("Watching a Battleship game").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private func sunkText(_ lengths: [Int]) -> String { lengths.isEmpty ? "none" : lengths.sorted(by: >).map(String.init).joined(separator: ", ") }

    /// A 10 x 10 grid. `own` shows a fleet (ships as blue squares); `shots` marks misses and hits on it; `tappable` lets you fire.
    private func grid(own: String?, shots: [Int]?, tappable: Bool, s: PlaySession, fire: @escaping (Int) -> Void) -> some View {
        let ships = own.map(Array.init)
        return VStack(spacing: 1) {
            ForEach(0..<10, id: \.self) { row in
                HStack(spacing: 1) {
                    ForEach(0..<10, id: \.self) { col in
                        let cell = row * 10 + col
                        let shot = shots?[cell] ?? 0
                        let ship = ships.map { $0[cell] != "0" } ?? false
                        Button { fire(cell) } label: {
                            ZStack {
                                Rectangle().fill(ship ? Color.blue.opacity(0.7) : Color.white.opacity(0.08))
                                if shot == 2 { Text("✕").font(.system(size: 11, weight: .heavy)).foregroundStyle(.red) }
                                else if shot == 1 { Circle().fill(Color.white.opacity(0.55)).frame(width: 5, height: 5) }
                            }
                            .frame(width: 20, height: 20)
                        }
                        .buttonStyle(.plain)
                        .disabled(!tappable || !PlayRules.canShoot(s, id: myID, cell: cell))
                        .accessibilityLabel("Square \(row + 1), \(col + 1)")
                    }
                }
            }
        }
        .padding(2).background(Color.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 4))
    }
}
