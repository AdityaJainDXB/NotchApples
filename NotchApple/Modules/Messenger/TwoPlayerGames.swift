//
//  TwoPlayerGames.swift
//  Notch Apple
//
//  Connect Four, Rock Paper Scissors, Battleship, Chess and Checkers for two people in a Messenger room or a friend chat: the rules with no
//  screen and no network, so tests can run them. Both players run the same `reduce` on every game message, their own
//  included, so they always agree. A message that is illegal, repeated, stale or from someone who is not playing changes nothing.
//  A message that arrives too early (messages can swap order) is kept in `stash` and tried again after the next change.
//
//  Fair play without a referee:
//    Rock Paper Scissors  each pick is sent first as a hash (commit) and shown only after both are in (reveal), so no one can change theirs.
//    Battleship           each fleet is committed as a hash when its owner presses Ready, shots are answered by the owner, and when the
//                         game ends both fleets are revealed and checked against the hash and against every answer given.
//
//  Wire message (PlayMessage), op = invite | accept | start | cancel | quit | rematch   (lobby, same for every game)
//                                  | move                                                (Connect Four: a = column; Chess and Checkers: a = from square, b = to square, s = promotion q r b n)
//                                  | commit | reveal                                     (Rock Paper Scissors: h hash; a pick, s salt)
//                                  | ready | shoot | result | reveal                     (Battleship: h hash; a cell, b answer; s board:salt)
//

import CryptoKit
import Foundation

enum PlayKind: String, CaseIterable, Equatable {
    case connect4 = "c4", rps = "rps", battleship = "bs", chess = "ch", checkers = "ck", rocket = "rl"
    var title: String {
        switch self {
        case .connect4: "Connect Four"
        case .rps: "Rock Paper Scissors"
        case .battleship: "Battleship"
        case .chess: "Chess"
        case .checkers: "Checkers"
        case .rocket: "Rocket League"
        }
    }
    var emoji: String {
        switch self {
        case .connect4: "🔴"
        case .rps: "✊"
        case .battleship: "🚢"
        case .chess: "♟️"
        case .checkers: "⚫"
        case .rocket: "🚀"
        }
    }
}

/// What goes over the wire. Every field except `g`, `op` and `gid` is optional and checked by `PlayRules.parse`.
struct PlayMessage: Codable, Equatable {
    var g: String
    var op: String
    var gid: String
    var x: String?      // start: the player who goes first
    var o: String?      // start: the other player
    var r: Int?         // round (0 for the first game; goes up with each rematch)
    var n: Int?         // move number / round within a match
    var a: Int?
    var b: Int?
    var h: String?
    var s: String?
}

struct PlayStash: Equatable {
    var m: PlayMessage
    var from: String
}

struct PlaySession: Equatable {
    enum Status: String { case invited, playing, finished, ended, cancelled }

    var kind: PlayKind
    var gid: String
    var status: Status
    var inviter: String
    var accepted: String?
    var p1: String?          // moves first
    var p2: String?
    var round = 0
    var rematch: [String] = []
    var leaver: String?
    /// The winning player's id once `status == .finished`; nil for a draw.
    var winner: String?
    var c4 = ConnectFour()
    var rps = RockPaperScissors()
    var bs = Battleship()
    var chess = Chess()
    var checkers = Checkers()
    var stash: [PlayStash] = []

    var isFinished: Bool { status == .finished || status == .ended || status == .cancelled }
    func index(of id: String) -> Int? { id == p1 ? 0 : (id == p2 ? 1 : nil) }
    func isPlayer(_ id: String) -> Bool { index(of: id) != nil }
    func player(_ i: Int) -> String? { i == 0 ? p1 : p2 }
    func other(than id: String) -> String? { id == p1 ? p2 : (id == p2 ? p1 : nil) }
}

// MARK: - The three games' own state

struct ConnectFour: Equatable {
    static let cols = 7, rows = 6
    /// Row 0 is the top. 0 empty, 1 first player, 2 second player.
    var cells = [Int](repeating: 0, count: 42)
    var moves = 0
    var line: [Int]?
    var last: Int?

    func lowestEmptyRow(_ col: Int) -> Int? {
        guard col >= 0, col < Self.cols else { return nil }
        for row in stride(from: Self.rows - 1, through: 0, by: -1) where cells[row * Self.cols + col] == 0 { return row }
        return nil
    }

    /// Four in a row through `cell`, if there is one.
    func winningLine(through cell: Int) -> [Int]? {
        let me = cells[cell]
        guard me != 0 else { return nil }
        let r0 = cell / Self.cols, c0 = cell % Self.cols
        for (dr, dc) in [(0, 1), (1, 0), (1, 1), (1, -1)] {
            var line = [cell]
            for sign in [1, -1] {
                var r = r0 + dr * sign, c = c0 + dc * sign
                while r >= 0, r < Self.rows, c >= 0, c < Self.cols, cells[r * Self.cols + c] == me { line.append(r * Self.cols + c); r += dr * sign; c += dc * sign }
            }
            if line.count >= 4 { return line.sorted() }
        }
        return nil
    }
}

struct RockPaperScissors: Equatable {
    static let wins = 2          // first to two
    var n = 0                    // which game of the match
    var commit: [String?] = [nil, nil]
    var reveal: [Int?] = [nil, nil]
    var score = [0, 0]
    /// What the last finished game was: both picks (player 1's, player 2's).
    var last: [Int]?
    var lastWinner: Int?         // 0, 1, or nil for a tie
    static func beats(_ a: Int, _ b: Int) -> Bool { (a - b + 3) % 3 == 1 }   // 0 rock, 1 paper, 2 scissors
    static let names = ["Rock", "Paper", "Scissors"]
    static let emoji = ["✊", "✋", "✌️"]
}

struct Battleship: Equatable {
    static let size = 10
    static let fleet: [(id: Character, length: Int)] = [("A", 5), ("B", 4), ("C", 3), ("D", 3), ("E", 2)]
    static let shipCells = 17

    var commit: [String?] = [nil, nil]
    var moves = 0
    var pendingCell: Int?
    /// shots[p] = what has happened to shots fired AT player p's board: 0 not shot, 1 miss, 2 hit.
    var shots = [[Int]](repeating: [Int](repeating: 0, count: 100), count: 2)
    /// Lengths of the ships already sunk on player p's board.
    var sunk: [[Int]] = [[], []]
    var hits = [0, 0]
    /// nil until that player's fleet is revealed at the end; then whether it matched the hash and every answer.
    var revealed: [Bool?] = [nil, nil]

    var bothReady: Bool { commit[0] != nil && commit[1] != nil }
    /// Whose turn to shoot (index), or nil while waiting for an answer.
    var shooter: Int? { pendingCell == nil && bothReady ? moves % 2 : nil }

    // ---- fleets

    static func isLegalFleet(_ board: String) -> Bool {
        let chars = Array(board)
        guard chars.count == 100 else { return false }
        for (id, length) in fleet {
            let cells = chars.indices.filter { chars[$0] == id }
            guard cells.count == length else { return false }
            let rows = Set(cells.map { $0 / 10 }), cols = Set(cells.map { $0 % 10 })
            if rows.count == 1 { if cols.max()! - cols.min()! != length - 1 { return false } }
            else if cols.count == 1 { if rows.max()! - rows.min()! != length - 1 { return false } }
            else { return false }
        }
        return chars.filter { $0 != "0" }.count == shipCells && chars.allSatisfy { ch in ch == "0" || fleet.contains { $0.id == ch } }
    }

    static func randomFleet() -> String {
        while true {
            var board = [Character](repeating: "0", count: 100)
            var ok = true
            for (id, length) in fleet {
                var placed = false
                for _ in 0..<200 {
                    let horizontal = Bool.random()
                    let r = Int.random(in: 0..<(horizontal ? 10 : 10 - length + 1)), c = Int.random(in: 0..<(horizontal ? 10 - length + 1 : 10))
                    let cells = (0..<length).map { horizontal ? r * 10 + c + $0 : (r + $0) * 10 + c }
                    if cells.allSatisfy({ board[$0] == "0" }) { for cell in cells { board[cell] = id }; placed = true; break }
                }
                if !placed { ok = false; break }
            }
            if ok { return String(board) }
        }
    }

    /// The answer to a shot at `cell` on `board`, given every cell already shot (including this one): 0 miss, 1 hit, 10 + length when it sinks a ship.
    static func answer(board: String, shot: Set<Int>, cell: Int) -> Int {
        let chars = Array(board)
        guard cell >= 0, cell < 100, chars[cell] != "0" else { return 0 }
        let ship = chars[cell]
        let all = chars.indices.filter { chars[$0] == ship }
        return all.allSatisfy({ shot.contains($0) }) ? 10 + all.count : 1
    }
}

// MARK: - The rules

enum PlayRules {
    static func sha256Hex(_ text: String) -> String { SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined() }
    private static func isHex64(_ s: String?) -> Bool { s.map { $0.count == 64 && $0.allSatisfy { $0.isHexDigit && !$0.isUppercase } } ?? false }
    private static func isID(_ s: String?) -> Bool { s.map { !$0.isEmpty && $0.count <= 64 } ?? false }
    private static func inRange(_ v: Int?, _ lo: Int, _ hi: Int) -> Bool { v.map { $0 >= lo && $0 <= hi } ?? false }

    /// What Rock Paper Scissors commits to: the pick and a random salt.
    static func rpsCommit(pick: Int, salt: String) -> String { sha256Hex("\(pick):\(salt)") }
    /// What Battleship commits to: the fleet (100 characters) and a random salt.
    static func fleetCommit(board: String, salt: String) -> String { sha256Hex("\(board):\(salt)") }

    static func parse(_ m: PlayMessage) -> PlayMessage? {
        guard PlayKind(rawValue: m.g) != nil, isID(m.gid) else { return nil }
        switch m.op {
        case "invite", "accept", "quit", "cancel": return m
        case "start": return isID(m.x) && isID(m.o) && m.x != m.o ? m : nil
        case "rematch": return inRange(m.r, 0, 1000) ? m : nil
        case "move":
            guard inRange(m.r, 0, 1000) else { return nil }
            if m.g == PlayKind.chess.rawValue || m.g == PlayKind.checkers.rawValue {       // a = from square, b = to square, s = promotion (q r b n)
                return inRange(m.n, 0, 800) && inRange(m.a, 0, 63) && inRange(m.b, 0, 63) && (m.s == nil || Chess.promotions.contains(m.s!)) ? m : nil
            }
            return inRange(m.n, 0, 100) && inRange(m.a, 0, 6) ? m : nil
        case "commit": return inRange(m.r, 0, 1000) && inRange(m.n, 0, 10) && isHex64(m.h) ? m : nil
        case "reveal":
            guard inRange(m.r, 0, 1000), let s = m.s, s.count >= 1, s.count <= 140 else { return nil }
            if m.g == PlayKind.rps.rawValue { return inRange(m.n, 0, 10) && inRange(m.a, 0, 2) ? m : nil }
            return m.g == PlayKind.battleship.rawValue ? m : nil
        case "ready": return inRange(m.r, 0, 1000) && isHex64(m.h) ? m : nil
        case "shoot": return inRange(m.r, 0, 1000) && inRange(m.n, 0, 200) && inRange(m.a, 0, 99) ? m : nil
        case "result":
            guard inRange(m.r, 0, 1000), inRange(m.n, 0, 200), inRange(m.a, 0, 99), let b = m.b else { return nil }
            return b == 0 || b == 1 || (12...15).contains(b) ? m : nil
        default: return nil
        }
    }

    static func reduce(_ state: PlaySession?, _ raw: PlayMessage, from: String) -> PlaySession? {
        guard let m = parse(raw), let kind = PlayKind(rawValue: m.g) else { return state }
        if m.op == "invite" {
            if let s = state, !s.isFinished { return state }
            return PlaySession(kind: kind, gid: m.gid, status: .invited, inviter: from)
        }
        guard var s = state, s.gid == m.gid, s.kind == kind else { return state }
        switch m.op {
        case "accept":
            guard s.status == .invited, from != s.inviter, s.accepted == nil else { return state }
            s.accepted = from
            return s
        case "cancel":
            guard s.status == .invited, from == s.inviter else { return state }
            s.status = .cancelled
            return s
        case "start":
            guard s.status == .invited, from == s.inviter, let acc = s.accepted, let x = m.x, let o = m.o, Set([x, o]) == Set([s.inviter, acc]) else { return state }
            s.status = .playing; s.p1 = x; s.p2 = o
            return s
        case "quit":
            guard s.status == .playing, s.isPlayer(from) else { return state }
            s.status = .ended; s.leaver = from
            return s
        case "rematch":
            guard s.status == .finished, s.isPlayer(from), m.r == s.round, !s.rematch.contains(from) else { return state }
            s.rematch.append(from)
            if s.rematch.count == 2 {                       // both asked: the first mover swaps and the game starts again
                s.round += 1; s.rematch = []; s.winner = nil
                swap(&s.p1, &s.p2)
                s.c4 = ConnectFour(); s.rps = RockPaperScissors(); s.bs = Battleship(); s.chess = Chess(); s.checkers = Checkers(); s.stash = []
                s.status = .playing
            }
            return s
        default:
            break
        }
        // The Battleship reveal comes after the game is over; everything else only while it is being played.
        let revealAfter = m.op == "reveal" && kind == .battleship && (s.status == .finished || s.status == .ended)
        guard (s.status == .playing || revealAfter), let idx = s.index(of: from), m.r == s.round else { return state }
        if s.apply(m, by: idx) {
            s.drain()
            return s
        }
        // Not legal yet: it may just have overtaken an earlier message, so keep it for after the next change.
        let item = PlayStash(m: m, from: from)
        if s.stash.count < 12, !s.stash.contains(item), m.op != "reveal" || kind == .rps {
            s.stash.append(item)
            return s
        }
        return state
    }

    // MARK: Building messages

    static func newGameID() -> String {
        let alphabet = Array("abcdefghjkmnpqrstuvwxyz23456789")
        return String((0..<12).map { _ in alphabet.randomElement()! })
    }
    static func invite(_ kind: PlayKind, gid: String) -> PlayMessage { .init(g: kind.rawValue, op: "invite", gid: gid) }
    static func accept(_ s: PlaySession) -> PlayMessage { .init(g: s.kind.rawValue, op: "accept", gid: s.gid) }
    static func cancel(_ s: PlaySession) -> PlayMessage { .init(g: s.kind.rawValue, op: "cancel", gid: s.gid) }
    static func quit(_ s: PlaySession) -> PlayMessage { .init(g: s.kind.rawValue, op: "quit", gid: s.gid) }
    static func rematch(_ s: PlaySession) -> PlayMessage { .init(g: s.kind.rawValue, op: "rematch", gid: s.gid, r: s.round) }
    /// The inviter picks who goes first (at random unless `inviterFirst` says otherwise).
    static func start(_ s: PlaySession, acceptor: String, inviterFirst: Bool = Bool.random()) -> PlayMessage {
        .init(g: s.kind.rawValue, op: "start", gid: s.gid, x: inviterFirst ? s.inviter : acceptor, o: inviterFirst ? acceptor : s.inviter)
    }
    static func move(_ s: PlaySession, column: Int) -> PlayMessage { .init(g: s.kind.rawValue, op: "move", gid: s.gid, r: s.round, n: s.c4.moves, a: column) }
    /// Chess and Checkers: a move from one square to another (`promotion` only for a pawn reaching the last row in Chess).
    static func boardMove(_ s: PlaySession, from: Int, to: Int, promotion: String? = nil) -> PlayMessage {
        .init(g: s.kind.rawValue, op: "move", gid: s.gid, r: s.round, n: s.kind == .chess ? s.chess.moves : s.checkers.moves, a: from, b: to, s: promotion)
    }
    /// Where `id` may move the piece on `from` right now in Chess or Checkers (empty when it is not their turn).
    static func boardTargets(_ s: PlaySession?, id: String, from: Int) -> [Int] {
        guard let g = s, g.status == .playing, let me = g.index(of: id) else { return [] }
        switch g.kind {
        case .chess: return g.chess.turn == me ? g.chess.legalTargets(from) : []
        case .checkers: return g.checkers.turn == me ? g.checkers.legalTargets(from) : []
        default: return []
        }
    }
    static func commit(_ s: PlaySession, pick: Int, salt: String) -> PlayMessage {
        .init(g: s.kind.rawValue, op: "commit", gid: s.gid, r: s.round, n: s.rps.n, h: rpsCommit(pick: pick, salt: salt))
    }
    static func reveal(_ s: PlaySession, pick: Int, salt: String) -> PlayMessage { .init(g: s.kind.rawValue, op: "reveal", gid: s.gid, r: s.round, n: s.rps.n, a: pick, s: salt) }
    static func ready(_ s: PlaySession, board: String, salt: String) -> PlayMessage { .init(g: s.kind.rawValue, op: "ready", gid: s.gid, r: s.round, h: fleetCommit(board: board, salt: salt)) }
    static func shoot(_ s: PlaySession, cell: Int) -> PlayMessage { .init(g: s.kind.rawValue, op: "shoot", gid: s.gid, r: s.round, n: s.bs.moves, a: cell) }
    static func result(_ s: PlaySession, cell: Int, answer: Int) -> PlayMessage { .init(g: s.kind.rawValue, op: "result", gid: s.gid, r: s.round, n: s.bs.moves, a: cell, b: answer) }
    static func revealFleet(_ s: PlaySession, board: String, salt: String) -> PlayMessage { .init(g: s.kind.rawValue, op: "reveal", gid: s.gid, r: s.round, s: "\(board):\(salt)") }

    /// True when `id` may drop a disc in `column` right now (the board enables columns with it; `reduce` is still the judge).
    static func canDrop(_ s: PlaySession?, id: String, column: Int) -> Bool {
        guard let g = s, g.kind == .connect4, g.status == .playing, g.index(of: id) == g.c4.moves % 2, g.c4.lowestEmptyRow(column) != nil else { return false }
        return true
    }
    static func canShoot(_ s: PlaySession?, id: String, cell: Int) -> Bool {
        guard let g = s, g.kind == .battleship, g.status == .playing, let me = g.index(of: id), g.bs.shooter == me, cell >= 0, cell < 100 else { return false }
        return g.bs.shots[1 - me][cell] == 0
    }
}

// MARK: - Applying a game message

extension PlaySession {
    /// Applies one game message from player `idx`. Returns false when it isn't legal right now.
    fileprivate mutating func apply(_ m: PlayMessage, by idx: Int) -> Bool {
        switch kind {
        case .connect4: return applyConnectFour(m, idx)
        case .rps: return applyRPS(m, idx)
        case .battleship: return applyBattleship(m, idx)
        case .chess: return applyChess(m, idx)
        case .checkers: return applyCheckers(m, idx)
        case .rocket: return false          // the match itself runs live between the two web views (rocket.js); only the lobby is here
        }
    }

    /// Tries the kept messages again; stops when none of them applies any more.
    fileprivate mutating func drain() {
        var progress = true
        while progress, !stash.isEmpty {
            progress = false
            for item in stash {
                guard let idx = index(of: item.from), status == .playing || item.m.op == "reveal" else { continue }
                var copy = self
                copy.stash = []
                if copy.apply(item.m, by: idx) {
                    copy.stash = stash.filter { $0 != item }
                    self = copy
                    progress = true
                    break
                }
            }
        }
    }

    private mutating func finish(winnerIndex: Int?) {
        status = .finished
        winner = winnerIndex.flatMap { player($0) }
    }

    private mutating func applyConnectFour(_ m: PlayMessage, _ idx: Int) -> Bool {
        guard m.op == "move", let col = m.a, m.n == c4.moves, idx == c4.moves % 2, let row = c4.lowestEmptyRow(col) else { return false }
        let cell = row * ConnectFour.cols + col
        c4.cells[cell] = idx + 1; c4.moves += 1; c4.last = cell
        if let line = c4.winningLine(through: cell) { c4.line = line; finish(winnerIndex: idx) }
        else if c4.moves == 42 { finish(winnerIndex: nil) }
        return true
    }

    private mutating func applyChess(_ m: PlayMessage, _ idx: Int) -> Bool {
        guard m.op == "move", m.n == chess.moves, idx == chess.turn, let from = m.a, let to = m.b, chess.play(from: from, to: to, promotion: m.s) else { return false }
        if chess.isOver { finish(winnerIndex: chess.winnerIndex) }
        return true
    }

    private mutating func applyCheckers(_ m: PlayMessage, _ idx: Int) -> Bool {
        guard m.op == "move", m.n == checkers.moves, idx == checkers.turn, let from = m.a, let to = m.b, checkers.play(from: from, to: to) else { return false }
        if checkers.over { finish(winnerIndex: checkers.winnerIndex) }
        return true
    }

    private mutating func applyRPS(_ m: PlayMessage, _ idx: Int) -> Bool {
        guard m.n == rps.n else { return false }
        switch m.op {
        case "commit":
            guard rps.commit[idx] == nil, let h = m.h else { return false }
            rps.commit[idx] = h
            return true
        case "reveal":
            guard rps.reveal[idx] == nil, let pick = m.a, let salt = m.s, let committed = rps.commit[idx], PlayRules.rpsCommit(pick: pick, salt: salt) == committed else { return false }
            rps.reveal[idx] = pick
            if let a = rps.reveal[0], let b = rps.reveal[1] {            // both are in: score the game
                rps.last = [a, b]
                if a == b { rps.lastWinner = nil }
                else { let w = RockPaperScissors.beats(a, b) ? 0 : 1; rps.lastWinner = w; rps.score[w] += 1 }
                rps.commit = [nil, nil]; rps.reveal = [nil, nil]; rps.n += 1
                if let w = rps.score.firstIndex(of: RockPaperScissors.wins) { finish(winnerIndex: w) }
            }
            return true
        default: return false
        }
    }

    private mutating func applyBattleship(_ m: PlayMessage, _ idx: Int) -> Bool {
        switch m.op {
        case "ready":
            guard status == .playing, bs.commit[idx] == nil, let h = m.h else { return false }
            bs.commit[idx] = h
            return true
        case "shoot":
            guard status == .playing, bs.shooter == idx, m.n == bs.moves, let cell = m.a, bs.shots[1 - idx][cell] == 0 else { return false }
            bs.pendingCell = cell
            return true
        case "result":
            // The answer comes from the player who was shot at.
            guard status == .playing, let cell = m.a, let code = m.b, let shotAt = bs.pendingCell, shotAt == cell, m.n == bs.moves, idx == (bs.moves + 1) % 2 else { return false }
            let mover = 1 - idx
            bs.shots[idx][cell] = code == 0 ? 1 : 2
            if code >= 10 { bs.sunk[idx].append(code - 10) }
            if code != 0 { bs.hits[idx] += 1 }
            bs.pendingCell = nil; bs.moves += 1
            if bs.hits[idx] == Battleship.shipCells { finish(winnerIndex: mover) }
            return true
        case "reveal":
            guard bs.revealed[idx] == nil, let text = m.s else { return false }
            let parts = text.split(separator: ":", maxSplits: 1).map(String.init)
            var ok = false
            if parts.count == 2, let committed = bs.commit[idx], PlayRules.fleetCommit(board: parts[0], salt: parts[1]) == committed, Battleship.isLegalFleet(parts[0]) {
                let board = Array(parts[0])
                ok = (0..<100).allSatisfy { cell in
                    switch bs.shots[idx][cell] { case 1: return board[cell] == "0"; case 2: return board[cell] != "0"; default: return true }
                }
            }
            bs.revealed[idx] = ok
            return true
        default: return false
        }
    }
}
