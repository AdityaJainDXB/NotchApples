//
//  BoardGames.swift
//  Notch Apple
//
//  The rules of Chess and Checkers, with no screen and no network, so tests can run them. They plug into the same two-player
//  session as Connect Four (TwoPlayerGames.swift): a move is one message from a square to a square, both players run the same
//  rules on every message, and an illegal move changes nothing. Squares are numbered 0...63, row by row from the top-left
//  (row 0 is the far side from the first player; the first player is white in Chess and moves up the screen in Checkers).
//

import Foundation

// MARK: - Chess

struct Chess: Equatable {
    /// Uppercase is white (the first player), lowercase black, "." empty. Row 0 is rank 8.
    var board: [Character] = Array("rnbqkbnrpppppppp" + String(repeating: ".", count: 32) + "PPPPPPPPRNBQKBNR")
    var turn = 0                                   // 0 white, 1 black
    /// White kingside, white queenside, black kingside, black queenside.
    var castle = [true, true, true, true]
    var enPassant: Int?                            // the square a pawn that just moved two squares passed over
    var quiet = 0                                  // half-moves since the last capture or pawn move
    var moves = 0                                  // half-moves played (also the message number)
    var last: [Int]?                               // [from, to] of the last move
    var check = false                              // the side to move is in check
    /// nil while the game goes on; otherwise checkmate, stalemate, fifty, repetition or material.
    var outcome: String?
    var seen: [String: Int] = [:]

    static let promotions: Set<String> = ["q", "r", "b", "n"]

    func side(of square: Int) -> Int? {
        let c = board[square]
        return c == "." ? nil : (c.isUppercase ? 0 : 1)
    }

    /// The player who delivered checkmate, if that is how it ended.
    var winnerIndex: Int? { outcome == "checkmate" ? 1 - turn : nil }

    var isOver: Bool { outcome != nil }

    // ---- attacks

    private static let knightSteps = [(-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1)]
    private static let kingSteps = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    private static let rookDirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    private static let bishopDirs = [(-1, -1), (-1, 1), (1, -1), (1, 1)]

    private func inside(_ r: Int, _ c: Int) -> Bool { r >= 0 && r < 8 && c >= 0 && c < 8 }

    /// True when a piece of `by` could capture on `square` (ignoring pins).
    func attacked(_ square: Int, by: Int) -> Bool {
        let r = square / 8, c = square % 8
        func piece(_ ch: Character) -> Character { by == 0 ? Character(ch.uppercased()) : ch }
        let pr = r + (by == 0 ? 1 : -1)
        for dc in [-1, 1] where inside(pr, c + dc) && board[pr * 8 + c + dc] == piece("p") { return true }
        for (dr, dc) in Self.knightSteps where inside(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] == piece("n") { return true }
        for (dr, dc) in Self.kingSteps where inside(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] == piece("k") { return true }
        for (dirs, kinds) in [(Self.rookDirs, ["r", "q"]), (Self.bishopDirs, ["b", "q"])] {
            for (dr, dc) in dirs {
                var rr = r + dr, cc = c + dc
                while inside(rr, cc) {
                    let ch = board[rr * 8 + cc]
                    if ch != "." {
                        if kinds.contains(where: { piece(Character($0)) == ch }) { return true }
                        break
                    }
                    rr += dr; cc += dc
                }
            }
        }
        return false
    }

    func kingSquare(_ side: Int) -> Int? { board.firstIndex(of: side == 0 ? "K" : "k") }

    // ---- moves

    /// Where the piece on `from` could go before the "don't leave your king in check" rule.
    private func pseudoTargets(_ from: Int) -> [Int] {
        guard let me = side(of: from) else { return [] }
        let r = from / 8, c = from % 8
        var out: [Int] = []
        func addIfFreeOrEnemy(_ rr: Int, _ cc: Int) { if inside(rr, cc), side(of: rr * 8 + cc) != me { out.append(rr * 8 + cc) } }
        switch Character(board[from].lowercased()) {
        case "p":
            let dir = me == 0 ? -1 : 1, start = me == 0 ? 6 : 1
            if inside(r + dir, c), board[(r + dir) * 8 + c] == "." {
                out.append((r + dir) * 8 + c)
                if r == start, board[(r + 2 * dir) * 8 + c] == "." { out.append((r + 2 * dir) * 8 + c) }
            }
            for dc in [-1, 1] where inside(r + dir, c + dc) {
                let to = (r + dir) * 8 + c + dc
                if let other = side(of: to), other != me { out.append(to) } else if to == enPassant { out.append(to) }
            }
        case "n": for (dr, dc) in Self.knightSteps { addIfFreeOrEnemy(r + dr, c + dc) }
        case "k":
            for (dr, dc) in Self.kingSteps { addIfFreeOrEnemy(r + dr, c + dc) }
            let home = me == 0 ? 60 : 4
            if from == home, !check {
                let rook: Character = me == 0 ? "R" : "r"
                if castle[me * 2], board[home + 3] == rook, board[home + 1] == ".", board[home + 2] == ".", !attacked(home + 1, by: 1 - me) { out.append(home + 2) }
                if castle[me * 2 + 1], board[home - 4] == rook, board[home - 1] == ".", board[home - 2] == ".", board[home - 3] == ".", !attacked(home - 1, by: 1 - me) { out.append(home - 2) }
            }
        default:
            let kind = Character(board[from].lowercased())
            let dirs = kind == "r" ? Self.rookDirs : (kind == "b" ? Self.bishopDirs : Self.rookDirs + Self.bishopDirs)
            for (dr, dc) in dirs {
                var rr = r + dr, cc = c + dc
                while inside(rr, cc) {
                    let owner = side(of: rr * 8 + cc)
                    if owner == me { break }
                    out.append(rr * 8 + cc)
                    if owner != nil { break }
                    rr += dr; cc += dc
                }
            }
        }
        return out
    }

    /// Moves the piece (and the rook when castling, the captured pawn when taking en passant) without checking anything.
    private mutating func place(_ from: Int, _ to: Int, promotion: Character?) {
        var piece = board[from]
        let isPawn = piece == "P" || piece == "p"
        if isPawn, to == enPassant, board[to] == ".", from % 8 != to % 8 { board[(from / 8) * 8 + to % 8] = "." }
        if piece == "K" || piece == "k", abs(to % 8 - from % 8) == 2 {
            let kingside = to % 8 > from % 8
            let rookFrom = kingside ? from + 3 : from - 4, rookTo = kingside ? from + 1 : from - 1
            board[rookTo] = board[rookFrom]; board[rookFrom] = "."
        }
        if isPawn, to / 8 == 0 || to / 8 == 7 {
            let chosen = promotion ?? "q"
            piece = piece == "P" ? Character(chosen.uppercased()) : chosen
        }
        board[to] = piece; board[from] = "."
    }

    /// Squares the piece on `from` may legally move to now (empty if it isn't that side's turn).
    func legalTargets(_ from: Int) -> [Int] {
        guard outcome == nil, from >= 0, from < 64, let me = side(of: from), me == turn else { return [] }
        return pseudoTargets(from).filter { to in
            var copy = self
            copy.place(from, to, promotion: "q")
            guard let king = copy.kingSquare(me) else { return false }
            return !copy.attacked(king, by: 1 - me)
        }
    }

    func isPromotion(from: Int, to: Int) -> Bool {
        (board[from] == "P" && to / 8 == 0) || (board[from] == "p" && to / 8 == 7)
    }

    /// Plays a legal move. `promotion` is q, r, b or n and only matters when a pawn reaches the last row (queen if missing).
    @discardableResult
    mutating func play(from: Int, to: Int, promotion: String? = nil) -> Bool {
        guard legalTargets(from).contains(to) else { return false }
        if let p = promotion, !Self.promotions.contains(p) { return false }
        let me = turn, piece = board[from]
        let capture = board[to] != "." || ((piece == "P" || piece == "p") && to == enPassant)
        place(from, to, promotion: promotion.flatMap { $0.first })
        // Castling rights go when the king or a rook moves, or a rook is taken.
        if piece == "K" { castle[0] = false; castle[1] = false }
        if piece == "k" { castle[2] = false; castle[3] = false }
        for square in [from, to] {
            switch square { case 63: castle[0] = false; case 56: castle[1] = false; case 7: castle[2] = false; case 0: castle[3] = false; default: break }
        }
        enPassant = (piece == "P" || piece == "p") && abs(to - from) == 16 ? (from + to) / 2 : nil
        quiet = (capture || piece == "P" || piece == "p") ? 0 : quiet + 1
        turn = 1 - me; moves += 1; last = [from, to]
        check = kingSquare(turn).map { attacked($0, by: me) } ?? false
        let key = String(board) + "|\(turn)|\(castle)|\(enPassant ?? -1)"
        seen[key, default: 0] += 1
        let canMove = (0..<64).contains { !legalTargets($0).isEmpty }
        if !canMove { outcome = check ? "checkmate" : "stalemate" }
        else if quiet >= 100 { outcome = "fifty" }
        else if seen[key, default: 0] >= 3 { outcome = "repetition" }
        else if insufficientMaterial { outcome = "material" }
        return true
    }

    /// Neither side can ever give mate: only kings, or kings and one knight or bishop.
    var insufficientMaterial: Bool {
        let rest = board.filter { $0 != "." && $0 != "K" && $0 != "k" }
        return rest.isEmpty || (rest.count == 1 && "nNbB".contains(rest[0]))
    }

    static func describe(outcome: String) -> String {
        switch outcome {
        case "checkmate": "Checkmate"
        case "stalemate": "Stalemate"
        case "fifty": "Draw: fifty moves without a capture or pawn move"
        case "repetition": "Draw: the same position three times"
        case "material": "Draw: not enough pieces left to mate"
        default: ""
        }
    }
}

// MARK: - Checkers

/// English draughts on 8 x 8: men move and capture forward, kings both ways, a capture is compulsory and a jump
/// continues while another jump is possible (it stops when a man is crowned).
struct Checkers: Equatable {
    /// "a"/"A" first player's man/king (starts at the bottom, moves up), "b"/"B" second player's. Pieces live on dark squares (row + column odd).
    var board: [Character] = {
        var b = [Character](repeating: ".", count: 64)
        for sq in 0..<64 where (sq / 8 + sq % 8) % 2 == 1 {
            if sq / 8 < 3 { b[sq] = "b" } else if sq / 8 > 4 { b[sq] = "a" }
        }
        return b
    }()
    var turn = 0
    /// A piece that has just jumped and has to keep jumping (the same player moves again).
    var chain: Int?
    var moves = 0
    var quiet = 0                                  // moves since a capture or a man's move
    var last: [Int]?
    var over = false
    var winnerIndex: Int?                          // nil with `over` means a draw

    func side(of square: Int) -> Int? {
        switch board[square] { case "a", "A": 0; case "b", "B": 1; default: nil }
    }
    private func isKing(_ square: Int) -> Bool { board[square] == "A" || board[square] == "B" }
    private func inside(_ r: Int, _ c: Int) -> Bool { r >= 0 && r < 8 && c >= 0 && c < 8 }

    private func directions(_ square: Int) -> [(Int, Int)] {
        if isKing(square) { return [(-1, -1), (-1, 1), (1, -1), (1, 1)] }
        return side(of: square) == 0 ? [(-1, -1), (-1, 1)] : [(1, -1), (1, 1)]
    }

    private func jumps(from square: Int) -> [Int] {
        guard let me = side(of: square) else { return [] }
        let r = square / 8, c = square % 8
        return directions(square).compactMap { dr, dc in
            guard inside(r + 2 * dr, c + 2 * dc), side(of: (r + dr) * 8 + c + dc) == 1 - me, board[(r + 2 * dr) * 8 + c + 2 * dc] == "." else { return nil }
            return (r + 2 * dr) * 8 + c + 2 * dc
        }
    }

    private func steps(from square: Int) -> [Int] {
        let r = square / 8, c = square % 8
        return directions(square).compactMap { dr, dc in
            inside(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] == "." ? (r + dr) * 8 + c + dc : nil
        }
    }

    /// True when `side` has a capture available somewhere (then it must capture).
    func mustCapture(_ side: Int) -> Bool { (0..<64).contains { self.side(of: $0) == side && !jumps(from: $0).isEmpty } }

    func legalTargets(_ from: Int) -> [Int] {
        guard !over, from >= 0, from < 64, side(of: from) == turn else { return [] }
        if let c = chain { return from == c ? jumps(from: from) : [] }
        return mustCapture(turn) ? jumps(from: from) : steps(from: from) + []
    }

    @discardableResult
    mutating func play(from: Int, to: Int) -> Bool {
        guard legalTargets(from).contains(to) else { return false }
        let me = turn, wasKing = isKing(from)
        let jumped = abs(to / 8 - from / 8) == 2
        if jumped { board[((from / 8 + to / 8) / 2) * 8 + (from % 8 + to % 8) / 2] = "." }
        board[to] = board[from]; board[from] = "."
        var crowned = false
        if !wasKing, to / 8 == (me == 0 ? 0 : 7) { board[to] = me == 0 ? "A" : "B"; crowned = true }
        moves += 1; last = [from, to]
        quiet = (jumped || !wasKing) ? 0 : quiet + 1
        if jumped, !crowned, !jumps(from: to).isEmpty { chain = to } else { chain = nil; turn = 1 - me }
        // The game is over when the side to move has nothing left to move, or after a long stretch with no progress.
        if chain == nil {
            let canMove = (0..<64).contains { !legalTargets($0).isEmpty }
            if !canMove { over = true; winnerIndex = me }
            else if quiet >= 80 { over = true; winnerIndex = nil }
        }
        return true
    }
}
