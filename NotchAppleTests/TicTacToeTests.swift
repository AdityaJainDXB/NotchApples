//
//  TicTacToeTests.swift
//  Notch Apple tests
//
//  Tic-tac-toe in a Messenger room: win, draw, illegal moves, turn order, duplicates, out-of-order and foreign messages,
//  rematch and leaving. The same cases are in NotchWindows/tests/tictactoe.test.mjs.
//

import XCTest

final class TicTacToeTests: XCTestCase {
    private let A = "ALICE", B = "BOB", C = "CAROL"

    /// Alice invites, Bob accepts, Alice starts the game.
    private func started(_ mark: TTTMark = .x) -> TicTacToeGame {
        var s = TicTacToe.reduce(nil, TicTacToe.invite(gid: "g1", mark: mark), from: A)
        s = TicTacToe.reduce(s, TicTacToe.accept(gid: "g1"), from: B)
        s = TicTacToe.reduce(s, TicTacToe.start(s!, acceptor: B), from: A)
        return s!
    }

    /// Plays cells in turn from the right player; every move must be accepted.
    private func play(_ game: TicTacToeGame, _ cells: [Int]) -> TicTacToeGame {
        var s = game
        for cell in cells {
            let who = s.turnPlayer ?? ""
            let next = TicTacToe.reduce(s, TicTacToe.move(s, cell: cell), from: who)
            XCTAssertNotEqual(next, s, "move \(cell) by \(who) should be legal")
            s = next ?? s
        }
        return s
    }

    private func move(_ r: Int, _ n: Int, _ cell: Int, gid: String = "g1") -> TicTacToeMessage {
        TicTacToeMessage(g: "ttt", op: "move", gid: gid, r: r, n: n, cell: cell)
    }

    func testTheInviterDecidesWhoIsXAndO() {
        let x = started(.x)
        XCTAssertEqual(x.status, .playing); XCTAssertEqual(x.x, A); XCTAssertEqual(x.o, B)
        let o = started(.o)
        XCTAssertEqual(o.x, B); XCTAssertEqual(o.o, A)
        XCTAssertEqual(o.turnPlayer, B)          // X always starts
    }

    func testTheFirstAcceptIsTheOneWhoPlays() {
        var s = TicTacToe.reduce(nil, TicTacToe.invite(gid: "g1", mark: .x), from: A)
        s = TicTacToe.reduce(s, TicTacToe.accept(gid: "g1"), from: B)
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToe.accept(gid: "g1"), from: C), s)
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToe.accept(gid: "g1"), from: A), s)
    }

    func testStartOnlyCountsFromTheInviterWithTheirChosenMark() {
        let s = TicTacToe.reduce(nil, TicTacToe.invite(gid: "g1", mark: .x), from: A)
        func start(_ x: String, _ o: String) -> TicTacToeMessage { TicTacToeMessage(g: "ttt", op: "start", gid: "g1", x: x, o: o) }
        XCTAssertEqual(TicTacToe.reduce(s, start(B, C), from: B), s)    // sent by someone else
        XCTAssertEqual(TicTacToe.reduce(s, start(B, C), from: A), s)    // the inviter isn't playing
        XCTAssertEqual(TicTacToe.reduce(s, start(B, A), from: A), s)    // wrong mark for the inviter
    }

    func testWins() {
        var s = play(started(), [0, 3, 1, 4, 2])
        XCTAssertEqual(s.status, .won); XCTAssertEqual(s.winner, .x); XCTAssertEqual(s.line, [0, 1, 2])
        s = play(started(), [0, 1, 3, 2, 6])
        XCTAssertEqual(s.line, [0, 3, 6])
        s = play(started(), [0, 1, 4, 2, 8])
        XCTAssertEqual(s.line, [0, 4, 8])
        s = play(started(), [0, 3, 1, 4, 8, 5])
        XCTAssertEqual(s.status, .won); XCTAssertEqual(s.winner, .o)
    }

    func testADrawAndAWinOnTheLastMove() {
        var s = play(started(), [0, 1, 2, 4, 3, 5, 7, 6, 8])
        XCTAssertEqual(s.status, .draw); XCTAssertNil(s.winner); XCTAssertEqual(s.moves, 9)
        s = play(started(), [0, 2, 1, 3, 5, 6, 4, 7, 8])
        XCTAssertEqual(s.moves, 9); XCTAssertEqual(s.status, .won); XCTAssertEqual(s.winner, .x)
    }

    func testIllegalMovesAreIgnored() {
        let s = play(started(), [4])
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToe.move(s, cell: 4), from: B), s)    // occupied
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToe.move(s, cell: 9), from: B), s)    // off the board
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToe.move(s, cell: -1), from: B), s)
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToe.move(s, cell: 0), from: A), s)    // Alice again on O's turn
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToe.move(s, cell: 0), from: C), s)    // Carol isn't playing
        let over = play(started(), [0, 3, 1, 4, 2])
        XCTAssertEqual(TicTacToe.reduce(over, move(0, 5, 8), from: B), over)
    }

    func testTheSamePlayerCannotMoveTwice() {
        let s = play(started(), [0])
        XCTAssertNil(TicTacToe.reduce(s, move(0, 1, 1), from: A)?.board[1])
        XCTAssertEqual(TicTacToe.reduce(s, move(0, 1, 1), from: B)?.board[1], .o)
    }

    func testARepeatedMessageChangesNothing() {
        let s = started()
        let m = TicTacToe.move(s, cell: 4)
        let once = TicTacToe.reduce(s, m, from: A)!
        XCTAssertEqual(TicTacToe.reduce(once, m, from: A), once)
        XCTAssertEqual(once.moves, 1)
        XCTAssertEqual(TicTacToe.reduce(once, TicTacToe.invite(gid: "g1", mark: .x), from: A), once)
        XCTAssertEqual(TicTacToe.reduce(once, TicTacToe.invite(gid: "g2", mark: .o), from: C), once)   // never replaces a running game
        XCTAssertEqual(TicTacToe.reduce(once, TicTacToe.start(once, acceptor: B), from: A), once)
    }

    func testMovesOutOfOrderAreHeldAndAppliedInOrder() {
        var s = started()
        s = TicTacToe.reduce(s, move(0, 2, 8), from: A)!      // the third move shows up first
        XCTAssertEqual(s.moves, 0)
        s = TicTacToe.reduce(s, move(0, 1, 0), from: B)!
        XCTAssertEqual(s.moves, 0)
        s = TicTacToe.reduce(s, move(0, 0, 4), from: A)!
        XCTAssertEqual(s.moves, 3)
        XCTAssertEqual([s.board[4], s.board[0], s.board[8]], [.x, .o, .x])
    }

    func testABogusEarlyMoveDoesNotBlockTheRealOne() {
        let s0 = started()
        XCTAssertEqual(TicTacToe.reduce(s0, move(0, 0, 4), from: C), s0)
        var s = TicTacToe.reduce(s0, move(0, 1, 4), from: A)!   // Alice sends O's move number: held, never legal
        s = TicTacToe.reduce(s, move(0, 0, 0), from: A)!
        XCTAssertEqual(s.moves, 1)
        XCTAssertEqual(s.board[0], .x)
    }

    func testAMoveThatBeatsTheStartIsAppliedWhenTheStartArrives() {
        var s = TicTacToe.reduce(nil, TicTacToe.invite(gid: "g1", mark: .x), from: A)
        s = TicTacToe.reduce(s, TicTacToe.accept(gid: "g1"), from: B)
        let start = TicTacToe.start(s!, acceptor: B)
        s = TicTacToe.reduce(s, move(0, 0, 4), from: A)
        XCTAssertEqual(s?.moves, 0)
        s = TicTacToe.reduce(s, start, from: A)
        XCTAssertEqual(s?.moves, 1)
        XCTAssertEqual(s?.board[4], .x)
    }

    func testOtherGamesAndNonsenseAreIgnored() {
        let s = started()
        XCTAssertEqual(TicTacToe.reduce(s, move(0, 0, 0, gid: "other"), from: A), s)
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToeMessage(g: "chess", op: "move", gid: "g1", r: 0, n: 0, cell: 0), from: A), s)
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToeMessage(g: "ttt", op: "explode", gid: "g1"), from: A), s)
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToe.move(s, cell: 0), from: ""), s)
        XCTAssertNil(TicTacToe.reduce(nil, TicTacToe.move(s, cell: 0), from: A))
        XCTAssertEqual(TicTacToe.reduce(s, move(0, 99, 0), from: A), s)
    }

    func testRematchNeedsBothSwapsMarksAndIgnoresRepeats() {
        var s = play(started(), [0, 3, 1, 4, 2])
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToe.rematch(s), from: C), s)
        s = TicTacToe.reduce(s, TicTacToe.rematch(s), from: A)!
        XCTAssertEqual(s.status, .won)
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToe.rematch(s), from: A), s)
        s = TicTacToe.reduce(s, TicTacToe.rematch(s), from: B)!
        XCTAssertEqual(s.status, .playing); XCTAssertEqual(s.round, 1); XCTAssertEqual(s.moves, 0)
        XCTAssertEqual(s.x, B); XCTAssertEqual(s.o, A)
        XCTAssertTrue(s.board.allSatisfy { $0 == nil })
        XCTAssertEqual(s.turnPlayer, B)
        s = play(s, [4, 0])
        XCTAssertEqual(s.board[4], .x); XCTAssertEqual(s.board[0], .o)
    }

    func testStaleRematchAndEarlyNextRoundMoves() {
        var s = play(started(), [0, 3, 1, 4, 2])
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToeMessage(g: "ttt", op: "rematch", gid: "g1", r: 5), from: A), s)
        s = TicTacToe.reduce(s, TicTacToe.rematch(s), from: A)!
        s = TicTacToe.reduce(s, move(1, 0, 4), from: B)!          // Bob, the new X, moves before Alice sees his rematch
        XCTAssertEqual(s.moves, 5)                               // still the finished board; the move is held
        s = TicTacToe.reduce(s, TicTacToeMessage(g: "ttt", op: "rematch", gid: "g1", r: 0), from: B)!
        XCTAssertEqual(s.status, .playing); XCTAssertEqual(s.round, 1); XCTAssertEqual(s.moves, 1); XCTAssertEqual(s.board[4], .x)
    }

    func testAMoveFromTheOldRoundDoesNotTouchTheNewOne() {
        var s = play(started(), [0, 3, 1, 4, 2])
        s = TicTacToe.reduce(s, TicTacToe.rematch(s), from: A)!
        s = TicTacToe.reduce(s, TicTacToe.rematch(s), from: B)!
        XCTAssertEqual(TicTacToe.reduce(s, move(0, 0, 8), from: B), s)
        XCTAssertEqual(TicTacToe.reduce(s, move(0, 0, 8), from: A), s)
    }

    func testAPlayerWhoLeavesEndsTheGame() {
        let s = play(started(), [0, 3])
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToe.quit(gid: "g1"), from: C), s)
        let ended = TicTacToe.reduce(s, TicTacToe.quit(gid: "g1"), from: B)!
        XCTAssertEqual(ended.status, .ended); XCTAssertEqual(ended.leaver, B)
        XCTAssertEqual(TicTacToe.reduce(ended, move(0, 2, 8), from: A), ended)
        XCTAssertEqual(TicTacToe.reduce(ended, TicTacToe.rematch(ended), from: A), ended)
        let done = play(started(), [0, 3, 1, 4, 2])
        XCTAssertEqual(TicTacToe.reduce(done, TicTacToe.quit(gid: "g1"), from: B)?.status, .ended)
    }

    func testInvitesCanBeCancelledAndFollowAFinishedGame() {
        let s = TicTacToe.reduce(nil, TicTacToe.invite(gid: "g1", mark: .x), from: A)
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToe.cancel(gid: "g1"), from: B), s)
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToe.quit(gid: "g1"), from: B), s)
        let cancelled = TicTacToe.reduce(s, TicTacToe.cancel(gid: "g1"), from: A)!
        XCTAssertEqual(cancelled.status, .cancelled)
        XCTAssertEqual(TicTacToe.reduce(cancelled, TicTacToe.accept(gid: "g1"), from: B), cancelled)
        let next = TicTacToe.reduce(cancelled, TicTacToe.invite(gid: "g2", mark: .o), from: B)!
        XCTAssertEqual(next.gid, "g2"); XCTAssertEqual(next.inviter, B); XCTAssertEqual(next.status, .invited)
        let done = play(started(), [0, 3, 1, 4, 2])
        XCTAssertEqual(TicTacToe.reduce(done, TicTacToe.invite(gid: "g3", mark: .x), from: C)?.gid, "g3")
        XCTAssertEqual(TicTacToe.reduce(s, TicTacToe.quit(gid: "g1"), from: A)?.status, .cancelled)
    }

    func testParseDropsBadValues() {
        XCTAssertNil(TicTacToe.parse(TicTacToeMessage(g: "ttt", op: "invite", gid: "g1", mark: "Z")))
        XCTAssertNil(TicTacToe.parse(TicTacToeMessage(g: "ttt", op: "accept", gid: String(repeating: "x", count: 65))))
        XCTAssertNil(TicTacToe.parse(TicTacToeMessage(g: "ttt", op: "start", gid: "g1", x: A, o: A)))
        XCTAssertNotNil(TicTacToe.parse(TicTacToeMessage(g: "ttt", op: "accept", gid: "g1")))
    }

    func testTheWireFormatIsTheSameJSONTheWindowsAppSends() throws {
        // Windows sends { g, op, gid, r, n, cell }; unknown keys are ignored and missing optional keys are fine.
        let json = #"{"g":"ttt","op":"move","gid":"g1","r":0,"n":3,"cell":4,"extra":true}"#
        let m = try JSONDecoder().decode(TicTacToeMessage.self, from: Data(json.utf8))
        XCTAssertEqual(m, TicTacToeMessage(g: "ttt", op: "move", gid: "g1", r: 0, n: 3, cell: 4))
    }

    func testCanMove() {
        let s = started()
        XCTAssertTrue(TicTacToe.canMove(s, id: A, cell: 0))
        XCTAssertFalse(TicTacToe.canMove(s, id: B, cell: 0))
        XCTAssertFalse(TicTacToe.canMove(nil, id: A, cell: 0))
        XCTAssertNil(TicTacToe.outcome(Array(repeating: nil, count: 9)))
    }
}
