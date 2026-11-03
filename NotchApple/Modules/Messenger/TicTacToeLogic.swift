//
//  TicTacToeLogic.swift
//  Notch Apple
//
//  Tic-tac-toe in a Messenger room: the rules with no screen and no network (so tests can run them).
//  A port of NotchWindows/src/js/games/tictactoe-logic.js; keep the two in step. Both players run the same
//  `reduce` on every game message, their own moves included, so they always agree. A message that is illegal,
//  repeated, stale or from someone who is not playing returns the state unchanged.
//
//  Wire message (the `game` field of a MessengerEnvelope), op = invite | accept | start | move | rematch | quit | cancel:
//    invite {mark}      the inviter picks their own mark (X always moves first)
//    accept             anyone else in the room says yes
//    start {x, o}       the inviter picks the first acceptor; x and o are sender IDs and one of them is the inviter
//    move {r, n, cell}  round r, move number n (0 = X's first move), cell 0...8
//    rematch {r}        another round; when both asked, the marks swap
//    quit               leaving the game (the app also applies this when a player leaves the room)
//    cancel             the inviter withdraws an open invite
//

import Foundation

enum TTTMark: String, Equatable {
    case x = "X", o = "O"
}

/// What goes over the wire. Every field except `g`, `op` and `gid` is optional and checked by `TicTacToe.parse`.
struct TicTacToeMessage: Codable, Equatable {
    var g: String
    var op: String
    var gid: String
    var mark: String?
    var x: String?
    var o: String?
    var r: Int?
    var n: Int?
    var cell: Int?
}

struct TicTacToeGame: Equatable {
    enum Status: String { case invited, playing, won, draw, ended, cancelled }

    /// A move that arrived before it was its turn (messages can come out of order through different relays).
    struct Pending: Equatable {
        var r: Int
        var n: Int
        var cell: Int
        var from: String
    }

    var gid: String
    var status: Status
    var inviter: String
    var inviterMark: TTTMark
    var accepted: String?
    var x: String?
    var o: String?
    var board: [TTTMark?] = Array(repeating: nil, count: 9)
    var moves = 0
    var round = 0
    /// The winning mark once `status == .won`; nil for a draw.
    var winner: TTTMark?
    var line: [Int]?
    var leaver: String?
    var rematch: [String] = []
    var pending: [Pending] = []

    var isFinished: Bool { status == .won || status == .draw || status == .ended || status == .cancelled }
    func isPlayer(_ id: String) -> Bool { id == x || id == o }
    func mark(of id: String) -> TTTMark? { id == x ? .x : (id == o ? .o : nil) }
    /// The sender ID whose turn it is: X moves when an even number of moves has been made.
    var turnPlayer: String? { moves % 2 == 0 ? x : o }
}

enum TicTacToe {
    static let lines: [[Int]] = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]
    static let maxPending = 18

    enum Outcome: Equatable {
        case win(TTTMark, [Int])
        case draw
    }

    /// A win with its line, a draw when the board is full, or nil while the game goes on.
    static func outcome(_ board: [TTTMark?]) -> Outcome? {
        guard board.count == 9 else { return nil }
        for line in lines {
            if let m = board[line[0]], board[line[1]] == m, board[line[2]] == m { return .win(m, line) }
        }
        return board.allSatisfy({ $0 != nil }) ? .draw : nil
    }

    private static func isID(_ s: String?) -> Bool {
        guard let id = s else { return false }
        return !id.isEmpty && id.count <= 64
    }
    private static func inRange(_ v: Int?, _ lo: Int, _ hi: Int) -> Bool {
        guard let n = v else { return false }
        return n >= lo && n <= hi
    }

    /// Cleans anything that came off the network: a safe message, or nil.
    static func parse(_ raw: TicTacToeMessage) -> TicTacToeMessage? {
        guard raw.g == "ttt", isID(raw.gid) else { return nil }
        var m = TicTacToeMessage(g: "ttt", op: raw.op, gid: raw.gid)
        switch raw.op {
        case "invite":
            guard raw.mark == "X" || raw.mark == "O" else { return nil }
            m.mark = raw.mark
        case "start":
            guard isID(raw.x), isID(raw.o), raw.x != raw.o else { return nil }
            m.x = raw.x; m.o = raw.o
        case "move":
            guard inRange(raw.r, 0, 1000), inRange(raw.n, 0, 8), inRange(raw.cell, 0, 8) else { return nil }
            m.r = raw.r; m.n = raw.n; m.cell = raw.cell
        case "rematch":
            guard inRange(raw.r, 0, 1000) else { return nil }
            m.r = raw.r
        case "accept", "quit", "cancel":
            break
        default:
            return nil
        }
        return m
    }

    /// The state after `raw` from sender `from`. The same state comes back when the message is ignored.
    static func reduce(_ state: TicTacToeGame?, _ raw: TicTacToeMessage, from: String) -> TicTacToeGame? {
        guard let msg = parse(raw), isID(from) else { return state }

        if msg.op == "invite" {
            // One game per room at a time: a new invite only replaces nothing or a finished game.
            if let old = state, !old.isFinished { return state }
            guard let mark = TTTMark(rawValue: msg.mark ?? "") else { return state }
            return TicTacToeGame(gid: msg.gid, status: .invited, inviter: from, inviterMark: mark)
        }
        guard var s = state, s.gid == msg.gid else { return state }

        switch msg.op {
        case "accept":
            guard s.status == .invited, from != s.inviter, s.accepted == nil else { return state }
            s.accepted = from
            return s

        case "cancel":
            guard s.status == .invited, from == s.inviter else { return state }
            s.status = .cancelled
            return s

        case "start":
            guard s.status == .invited, from == s.inviter, let x = msg.x, let o = msg.o else { return state }
            let inviterIsX = x == s.inviter
            guard inviterIsX || o == s.inviter else { return state }                 // the inviter must play
            guard (inviterIsX ? TTTMark.x : TTTMark.o) == s.inviterMark else { return state }   // with the mark they chose
            s.status = .playing
            s.x = x; s.o = o
            return drain(s)                                                          // moves that beat the start are applied now

        case "quit":
            if s.status == .ended || s.status == .cancelled { return state }
            if s.status == .invited {
                guard from == s.inviter else { return state }
                s.status = .cancelled
                return s
            }
            guard s.isPlayer(from) else { return state }
            s.status = .ended
            s.leaver = from
            return s

        case "rematch":
            guard s.status == .won || s.status == .draw, msg.r == s.round, s.isPlayer(from), !s.rematch.contains(from) else { return state }
            s.rematch.append(from)
            if s.rematch.count < 2 { return s }
            // Both agreed: a clean board, the marks swap, and moves that already arrived for the new round are applied.
            let oldRound = s.round
            let (nx, no) = (s.o, s.x)
            s.x = nx; s.o = no
            s.board = Array(repeating: nil, count: 9)
            s.moves = 0
            s.round = oldRound + 1
            s.winner = nil; s.line = nil
            s.rematch = []
            s.pending = s.pending.filter { $0.r > oldRound }
            s.status = .playing
            return drain(s)

        case "move":
            guard let r = msg.r, let n = msg.n, let cell = msg.cell else { return state }
            let isQueued = s.pending.contains { $0.r == r && $0.n == n && $0.from == from }
            if s.status == .playing || s.status == .invited {
                if r < s.round || (r == s.round && n < s.moves) { return state }     // old or duplicate
                if s.status == .playing, r == s.round, n == s.moves,
                   s.turnPlayer != from || s.board[cell] != nil { return state }       // it is due now and it is illegal
                if isQueued { return state }
                if s.status == .playing, !s.isPlayer(from) { return state }          // not in this game
                if s.status == .invited, from != s.inviter, from != s.accepted { return state }
                if s.pending.count >= maxPending { return state }
                s.pending.append(.init(r: r, n: n, cell: cell, from: from))
                return drain(s)
            }
            // After a win or draw only the next round's early moves matter; hold them for the rematch.
            if (s.status == .won || s.status == .draw), s.isPlayer(from), r == s.round + 1, s.pending.count < maxPending, !isQueued {
                s.pending.append(.init(r: r, n: n, cell: cell, from: from))
                return s
            }
            return state

        default:
            return state
        }
    }

    /// Applies queued moves that are now next in line (same round, move number = moves made, right player, empty cell).
    private static func drain(_ start: TicTacToeGame) -> TicTacToeGame {
        var s = start
        while s.status == .playing, let want = s.turnPlayer {
            guard let i = s.pending.firstIndex(where: { $0.r == s.round && $0.n == s.moves && $0.from == want }) else { break }
            let p = s.pending.remove(at: i)
            if s.board[p.cell] != nil { continue }                                   // occupied: drop it
            s.board[p.cell] = s.mark(of: p.from)
            s.moves += 1
            let round = s.round
            s.pending = s.pending.filter { $0.r >= round }
            if let end = outcome(s.board) {
                switch end {
                case .win(let m, let line): s.status = .won; s.winner = m; s.line = line
                case .draw: s.status = .draw; s.winner = nil; s.line = nil
                }
            }
        }
        // Drop leftovers that can never apply any more (earlier rounds or already-played move numbers).
        let round = s.round, moves = s.moves
        s.pending = s.pending.filter { $0.r > round || ($0.r == round && $0.n >= moves) }
        return s
    }

    // MARK: Building messages (the app checks each with `reduce` on its own state before sending it)

    static func newGameID() -> String {
        let alphabet = Array("abcdefghjkmnpqrstuvwxyz23456789")
        return String((0..<12).map { _ in alphabet.randomElement()! })
    }
    static func invite(gid: String, mark: TTTMark) -> TicTacToeMessage { .init(g: "ttt", op: "invite", gid: gid, mark: mark.rawValue) }
    static func accept(gid: String) -> TicTacToeMessage { .init(g: "ttt", op: "accept", gid: gid) }
    static func cancel(gid: String) -> TicTacToeMessage { .init(g: "ttt", op: "cancel", gid: gid) }
    static func quit(gid: String) -> TicTacToeMessage { .init(g: "ttt", op: "quit", gid: gid) }
    static func rematch(_ s: TicTacToeGame) -> TicTacToeMessage { .init(g: "ttt", op: "rematch", gid: s.gid, r: s.round) }
    static func move(_ s: TicTacToeGame, cell: Int) -> TicTacToeMessage { .init(g: "ttt", op: "move", gid: s.gid, r: s.round, n: s.moves, cell: cell) }
    /// The inviter's answer to the first accept: who is X and who is O follows the mark the inviter chose.
    static func start(_ s: TicTacToeGame, acceptor: String) -> TicTacToeMessage {
        let inviterIsX = s.inviterMark == .x
        return .init(g: "ttt", op: "start", gid: s.gid, x: inviterIsX ? s.inviter : acceptor, o: inviterIsX ? acceptor : s.inviter)
    }

    /// True when `id` may play `cell` right now (the board enables cells with it; `reduce` is still the judge).
    static func canMove(_ s: TicTacToeGame?, id: String, cell: Int) -> Bool {
        guard let g = s, g.status == .playing, g.turnPlayer == id, cell >= 0, cell < 9 else { return false }
        return g.board[cell] == nil
    }
}
