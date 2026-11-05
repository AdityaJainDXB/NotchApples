import XCTest

// Chess and Checkers in Messenger: rules only (BoardGames.swift and TwoPlayerGames.swift), no screen and no network.
final class BoardGamesTests: XCTestCase {
    private let a = "alice", b = "bob"

    private func started(_ kind: PlayKind) throws -> PlaySession {
        var s = PlayRules.reduce(nil, PlayRules.invite(kind, gid: "g1"), from: a)
        s = PlayRules.reduce(s, PlayRules.accept(try XCTUnwrap(s)), from: b)
        s = PlayRules.reduce(s, PlayRules.start(try XCTUnwrap(s), acceptor: b, inviterFirst: true), from: a)
        return try XCTUnwrap(s)
    }
    /// Plays a move as `who` through the real session rules.
    private func go(_ s: inout PlaySession, _ from: Int, _ to: Int, as who: String, promotion: String? = nil) {
        s = PlayRules.reduce(s, PlayRules.boardMove(s, from: from, to: to, promotion: promotion), from: who) ?? s
    }
    private func put(_ pieces: [Int: Character]) -> [Character] {
        var board = [Character](repeating: ".", count: 64)
        for (sq, ch) in pieces { board[sq] = ch }
        return board
    }

    // MARK: Chess

    func testFoolsMateEndsTheGameWithTheRightWinner() throws {
        var s = try started(.chess)
        go(&s, 53, 45, as: a); go(&s, 12, 28, as: b); go(&s, 54, 38, as: a); go(&s, 3, 39, as: b)
        XCTAssertEqual(s.status, .finished)
        XCTAssertEqual(s.chess.outcome, "checkmate")
        XCTAssertEqual(s.winner, b)
        let before = s
        go(&s, 52, 36, as: a)
        XCTAssertEqual(s, before, "no moves after checkmate")
    }

    func testTurnsAndIllegalMovesAreRefused() throws {
        var s = try started(.chess)
        go(&s, 12, 28, as: b)
        XCTAssertEqual(s.chess.moves, 0, "black can't go first")
        go(&s, 52, 28, as: a)
        XCTAssertEqual(s.chess.moves, 0, "a pawn can't jump three squares")
        go(&s, 60, 52, as: a)
        XCTAssertEqual(s.chess.moves, 0, "a king can't take its own pawn")
        go(&s, 57, 40, as: a)
        XCTAssertEqual(s.chess.moves, 1, "the knight b1-a3 is fine")
        go(&s, 40, 25, as: a)
        XCTAssertEqual(s.chess.moves, 1, "alice can't move twice in a row")
        XCTAssertEqual(PlayRules.parse(PlayMessage(g: "ch", op: "move", gid: "g1", r: 0, n: 1, a: 64, b: 3)), nil, "squares are 0...63")
        XCTAssertEqual(PlayRules.parse(PlayMessage(g: "ch", op: "move", gid: "g1", r: 0, n: 1, a: 8, b: 0, s: "k")), nil, "a pawn can't become a king")
    }

    func testAPinnedPieceCannotMoveAndAKingCannotWalkIntoCheck() {
        var c = Chess()
        c.board = put([60: "K", 52: "N", 4: "r", 0: "k"])
        c.castle = [false, false, false, false]
        XCTAssertTrue(c.legalTargets(52).isEmpty, "the knight is pinned to its king by the rook")
        c.board = put([60: "K", 3: "r", 0: "k"])
        XCTAssertFalse(c.legalTargets(60).contains(59), "d1 is covered by the rook on d8")
        XCTAssertTrue(c.legalTargets(60).contains(61))
    }

    func testCastlingEnPassantAndPromotion() throws {
        // Kingside castling: e4 e5 Nf3 Nc6 Bc4 Nf6, then O-O.
        var s = try started(.chess)
        go(&s, 52, 36, as: a); go(&s, 12, 28, as: b); go(&s, 62, 45, as: a); go(&s, 1, 18, as: b); go(&s, 61, 34, as: a); go(&s, 6, 21, as: b)
        go(&s, 60, 62, as: a)
        XCTAssertEqual(s.chess.board[62], "K")
        XCTAssertEqual(s.chess.board[61], "R")
        XCTAssertEqual(s.chess.board[63], ".")
        XCTAssertFalse(s.chess.castle[0] || s.chess.castle[1])
        // En passant: e4 a6 e5 d5, exd6.
        var t = try started(.chess)
        go(&t, 52, 36, as: a); go(&t, 8, 16, as: b); go(&t, 36, 28, as: a); go(&t, 11, 27, as: b)
        XCTAssertEqual(t.chess.enPassant, 19)
        go(&t, 28, 19, as: a)
        XCTAssertEqual(t.chess.board[19], "P")
        XCTAssertEqual(t.chess.board[27], ".", "the passed pawn is taken")
        // Promotion: a knight when asked, a queen when not.
        var p = try started(.chess)
        p.chess.board = put([8: "P", 60: "K", 7: "k"]); p.chess.castle = [false, false, false, false]
        var q = p
        go(&p, 8, 0, as: a, promotion: "n")
        XCTAssertEqual(p.chess.board[0], "N")
        go(&q, 8, 0, as: a)
        XCTAssertEqual(q.chess.board[0], "Q")
    }

    func testCannotCastleOutOfOrThroughCheck() throws {
        var c = Chess()
        c.board = put([60: "K", 63: "R", 4: "r", 7: "k"])
        c.castle = [true, false, false, false]
        c.check = c.attacked(60, by: 1)
        XCTAssertTrue(c.check)
        XCTAssertFalse(c.legalTargets(60).contains(62), "no castling out of check")
        c.board = put([60: "K", 63: "R", 5: "r", 7: "k"])
        c.check = false
        XCTAssertFalse(c.legalTargets(60).contains(62), "no castling through an attacked square (f1)")
    }

    func testStalemateAndInsufficientMaterialAreDraws() throws {
        var s = try started(.chess)
        s.chess.board = put([18: "Q", 63: "K", 0: "k"]); s.chess.castle = [false, false, false, false]
        go(&s, 18, 10, as: a)
        XCTAssertEqual(s.status, .finished)
        XCTAssertEqual(s.chess.outcome, "stalemate")
        XCTAssertNil(s.winner, "a stalemate is a draw")
        var m = try started(.chess)
        m.chess.board = put([60: "K", 4: "k", 36: "N", 19: "r"]); m.chess.castle = [false, false, false, false]
        go(&m, 36, 19, as: a)   // the knight takes the last rook: king and knight against a king
        XCTAssertEqual(m.chess.outcome, "material")
        XCTAssertNil(m.winner)
    }

    func testRematchSwapsColoursAndResetsTheBoard() throws {
        var s = try started(.chess)
        go(&s, 53, 45, as: a); go(&s, 12, 28, as: b); go(&s, 54, 38, as: a); go(&s, 3, 39, as: b)
        s = PlayRules.reduce(s, PlayRules.rematch(s), from: a) ?? s
        s = PlayRules.reduce(s, PlayRules.rematch(s), from: b) ?? s
        XCTAssertEqual(s.status, .playing)
        XCTAssertEqual(s.p1, b)
        XCTAssertEqual(s.chess, Chess())
        go(&s, 52, 36, as: a)
        XCTAssertEqual(s.chess.moves, 0, "bob is white now")
        go(&s, 52, 36, as: b)
        XCTAssertEqual(s.chess.moves, 1)
    }

    func testAMoveThatArrivesEarlyWaitsForTheOneBeforeIt() throws {
        var s = try started(.chess)
        let first = PlayRules.boardMove(s, from: 52, to: 36)
        var ahead = s; ahead = PlayRules.reduce(ahead, first, from: a) ?? ahead
        let second = PlayRules.boardMove(ahead, from: 12, to: 28)
        s = PlayRules.reduce(s, second, from: b) ?? s
        XCTAssertEqual(s.chess.moves, 0, "black's reply can't be played yet")
        s = PlayRules.reduce(s, first, from: a) ?? s
        XCTAssertEqual(s.chess.moves, 2, "once white has moved, the stashed reply is played")
    }

    // MARK: Rocket League (only the lobby is in the session; the match runs live between the two web views)

    func testRocketLeagueHasALobbyButNoMovesInTheSession() throws {
        var s = try started(.rocket)
        XCTAssertEqual(s.status, .playing)
        XCTAssertEqual(s.p1, a)
        XCTAssertEqual(PlayKind.rocket.title, "Rocket League")
        XCTAssertEqual(PlayKind(rawValue: "rl"), .rocket)
        let before = s
        go(&s, 1, 2, as: a)
        XCTAssertEqual(s.chess, before.chess, "a stray move changes no board")
        XCTAssertEqual(s.status, .playing)
        s = PlayRules.reduce(s, PlayRules.quit(s), from: b) ?? s
        XCTAssertEqual(s.status, .ended)
        XCTAssertEqual(s.leaver, b)
    }

    func testTheGameIdAlphabetMatchesTheRoomCodeAlphabetSoAnyIdMakesAValidCode() {
        for _ in 0..<200 {
            let code = String(PlayRules.newGameID().prefix(6)).uppercased()
            XCTAssertTrue(code.allSatisfy { "ABCDEFGHJKMNPQRSTUVWXYZ23456789".contains($0) }, code)
            XCTAssertEqual(code.count, 6)
        }
    }

    // MARK: Checkers

    func testCheckersOpeningMovesAndTurns() throws {
        var s = try started(.checkers)
        XCTAssertEqual(s.checkers.board.filter { $0 == "a" }.count, 12)
        XCTAssertEqual(s.checkers.board.filter { $0 == "b" }.count, 12)
        go(&s, 17, 24, as: b)
        XCTAssertEqual(s.checkers.moves, 0, "the second player can't go first")
        go(&s, 40, 32, as: a)
        XCTAssertEqual(s.checkers.moves, 0, "pieces move diagonally")
        go(&s, 40, 33, as: a)
        XCTAssertEqual(s.checkers.moves, 1)
        XCTAssertEqual(s.checkers.turn, 1)
        go(&s, 33, 24, as: a)
        XCTAssertEqual(s.checkers.moves, 1, "not alice's turn")
    }

    func testCapturingIsCompulsoryAndJumpsContinue() throws {
        var s = try started(.checkers)
        s.checkers.board = put([49: "a", 33: "a", 42: "b", 28: "b", 8: "b", 26: "b"])
        // alice may not make a plain move while a capture is available.
        XCTAssertTrue(s.checkers.mustCapture(0))
        go(&s, 33, 24, as: a)
        XCTAssertEqual(s.checkers.moves, 0, "a plain move is refused while a jump exists")
        go(&s, 49, 35, as: a)               // jumps the piece on 42
        XCTAssertEqual(s.checkers.moves, 1)
        XCTAssertEqual(s.checkers.turn, 0, "the same piece must keep jumping")
        XCTAssertEqual(s.checkers.chain, 35)
        go(&s, 33, 24, as: a)
        XCTAssertEqual(s.checkers.moves, 1, "another piece can't move in the middle of a jump")
        go(&s, 35, 21, as: a)               // jumps the piece on 28
        XCTAssertEqual(s.checkers.moves, 2)
        XCTAssertEqual(s.checkers.turn, 1)
        XCTAssertNil(s.checkers.chain)
        XCTAssertEqual(s.checkers.board.filter { $0 == "b" }.count, 2)
    }

    func testCrowningEndsTheJumpAndKingsMoveBackwards() throws {
        var s = try started(.checkers)
        s.checkers.board = put([17: "a", 10: "b", 5: "b"])
        go(&s, 17, 3, as: a)                // jumps 10 and lands on the back row: crowned, and the turn ends there
        XCTAssertEqual(s.checkers.board[3], "A")
        XCTAssertEqual(s.checkers.turn, 1)
        go(&s, 5, 14, as: b)
        XCTAssertEqual(s.checkers.turn, 0)
        XCTAssertTrue(s.checkers.legalTargets(3).contains(12), "a king may move backwards (down the board)")
    }

    func testCheckersWinsWhenTheOpponentCannotMove() throws {
        var s = try started(.checkers)
        s.checkers.board = put([33: "a", 26: "b"])
        go(&s, 33, 19, as: a)
        XCTAssertEqual(s.status, .finished)
        XCTAssertEqual(s.winner, a)
        var t = try started(.checkers)
        t.checkers.board = put([40: "a", 33: "b", 26: "b", 5: "b"])   // alice's last piece has nowhere to go
        go(&t, 40, 33, as: a)
        XCTAssertEqual(t.checkers.moves, 0, "40 can only go to 33 and that is taken, with no jump either")
    }
}

// Big files in an anonymous room (FileChunks.swift): cutting into pieces and putting them back together.
final class RoomFileTests: XCTestCase {
    private func bytes(_ n: Int) -> Data { Data((0..<n).map { UInt8($0 % 251) }) }

    func testAFileIsCutIntoPiecesThatRebuildIt() {
        let data = bytes(2_000_000)
        let pieces = RoomFiles.split(data)
        XCTAssertEqual(pieces.count, 250)
        XCTAssertTrue(pieces.allSatisfy { $0.count <= RoomFiles.chunkSize })
        var asm = FileAssembly()
        var done: (name: String, data: Data)?
        for (i, p) in pieces.enumerated().reversed() { done = asm.add(key: "a|f", name: "big.bin", n: pieces.count, i: i, bytes: p) ?? done }   // arriving back to front
        XCTAssertEqual(done?.data, data)
        XCTAssertEqual(done?.name, "big.bin")
        XCTAssertTrue(asm.parts.isEmpty, "a finished file is forgotten")
    }

    func testBadPiecesAreRefused() {
        var asm = FileAssembly()
        XCTAssertNil(asm.add(key: "k", name: "x", n: 251, i: 0, bytes: bytes(8000)), "more pieces than the limit")
        XCTAssertNil(asm.add(key: "k", name: "x", n: 3, i: 3, bytes: bytes(8000)), "piece number out of range")
        XCTAssertNil(asm.add(key: "k", name: "x", n: 3, i: 0, bytes: bytes(8001)), "piece too big")
        XCTAssertNil(asm.add(key: "k", name: "x", n: 3, i: 0, bytes: bytes(100)), "only the last piece may be short")
        XCTAssertNil(asm.add(key: "k", name: "x", n: 1, i: 0, bytes: bytes(10)), "one piece is just a normal message")
        XCTAssertTrue(asm.parts.isEmpty)
        _ = asm.add(key: "k", name: "x", n: 3, i: 0, bytes: bytes(8000))
        XCTAssertNil(asm.add(key: "k", name: "x", n: 4, i: 1, bytes: bytes(8000)), "a piece that disagrees on the count is ignored")
        XCTAssertEqual(asm.parts["k"]?.chunks.count, 1)
    }

    func testLimitsOnFilesInFlightAndOnStalledFiles() {
        var asm = FileAssembly()
        let start = Date()
        for k in 0..<FileAssembly.maxParts { _ = asm.add(key: "s\(k)", name: "f\(k)", n: 3, i: 0, bytes: bytes(8000), now: start) }
        XCTAssertNil(asm.add(key: "extra", name: "e", n: 3, i: 0, bytes: bytes(8000), now: start))
        XCTAssertEqual(asm.parts.count, FileAssembly.maxParts, "a seventh file is not started")
        XCTAssertEqual(asm.expire(now: start.addingTimeInterval(10)).count, 0)
        XCTAssertEqual(asm.expire(now: start.addingTimeInterval(FileAssembly.patience + 1)).count, FileAssembly.maxParts)
        XCTAssertTrue(asm.parts.isEmpty)
    }

    func testFileNamesAreMadeSafe() {
        XCTAssertEqual(RoomFiles.cleanName("../../etc/passwd"), "passwd")
        XCTAssertEqual(RoomFiles.cleanName("a/b/photo.png"), "photo.png")
        XCTAssertNil(RoomFiles.cleanName(".."))
        XCTAssertNil(RoomFiles.cleanName(""))
        XCTAssertNil(RoomFiles.cleanName(nil))
        XCTAssertEqual(RoomFiles.cleanName(String(repeating: "n", count: 300))?.count, 100)
    }
}
