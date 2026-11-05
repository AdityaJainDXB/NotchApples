import XCTest

// Connect Four, Rock Paper Scissors and Battleship in Messenger: rules only (TwoPlayerGames.swift), no screen and no network.
final class PlayGamesTests: XCTestCase {
    private let a = "alice", b = "bob"

    /// A started game between alice (first) and bob.
    private func started(_ kind: PlayKind) throws -> PlaySession {
        var s = PlayRules.reduce(nil, PlayRules.invite(kind, gid: "g1"), from: a)
        s = PlayRules.reduce(s, PlayRules.accept(try XCTUnwrap(s)), from: b)
        s = PlayRules.reduce(s, PlayRules.start(try XCTUnwrap(s), acceptor: b, inviterFirst: true), from: a)
        XCTAssertEqual(s?.status, .playing)
        return try XCTUnwrap(s)
    }
    private func send(_ s: inout PlaySession, _ m: PlayMessage, from: String) { s = PlayRules.reduce(s, m, from: from) ?? s }

    func testTheLobbyRulesAreEnforced() throws {
        var s = try XCTUnwrap(PlayRules.reduce(nil, PlayRules.invite(.connect4, gid: "g1"), from: a))
        XCTAssertEqual(s.status, .invited)
        XCTAssertEqual(PlayRules.reduce(s, PlayRules.accept(s), from: a), s, "the inviter can't accept their own invite")
        s = try XCTUnwrap(PlayRules.reduce(s, PlayRules.accept(s), from: b))
        let bogus = PlayMessage(g: "c4", op: "start", gid: "g1", x: "eve", o: b)
        XCTAssertEqual(PlayRules.reduce(s, bogus, from: a), s, "start must name the inviter and the acceptor")
        XCTAssertEqual(PlayRules.reduce(s, PlayRules.start(s, acceptor: b), from: b), s, "only the inviter can start")
        XCTAssertEqual(PlayRules.reduce(s, PlayMessage(g: "nope", op: "invite", gid: "z"), from: a), s, "unknown games are ignored")
        let cancelled = try XCTUnwrap(PlayRules.reduce(s, PlayRules.cancel(s), from: a))
        XCTAssertEqual(cancelled.status, .cancelled)
    }

    func testConnectFourWinsAndTakesTurns() throws {
        var s = try started(.connect4)
        send(&s, PlayRules.move(s, column: 0), from: b)
        XCTAssertEqual(s.c4.moves, 0, "bob can't go first")
        // alice stacks column 0, bob column 1: alice wins on her fourth disc.
        for _ in 0..<3 {
            send(&s, PlayRules.move(s, column: 0), from: a)
            send(&s, PlayRules.move(s, column: 1), from: b)
        }
        send(&s, PlayRules.move(s, column: 0), from: a)
        XCTAssertEqual(s.status, .finished)
        XCTAssertEqual(s.winner, a)
        XCTAssertEqual(s.c4.line?.count, 4)
        let before = s
        send(&s, PlayRules.move(s, column: 2), from: b)
        XCTAssertEqual(s, before, "no moves after the game is over")
    }

    func testConnectFourDiagonalColumnsFullAndOutOfOrder() throws {
        var s = try started(.connect4)
        // Fill column 0 (6 discs) alternately: the 7th disc there is illegal.
        for i in 0..<6 { send(&s, PlayRules.move(s, column: 0), from: i % 2 == 0 ? a : b) }
        XCTAssertNil(s.c4.lowestEmptyRow(0))
        XCTAssertFalse(PlayRules.canDrop(s, id: a, column: 0))
        let n = s.c4.moves
        send(&s, PlayRules.move(s, column: 0), from: a)
        XCTAssertEqual(s.c4.moves, n)
        // A move that overtakes the one before it waits and is applied after it.
        var t = try started(.connect4)
        let first = PlayRules.move(t, column: 3)
        var t2 = t; send(&t2, first, from: a)
        let second = PlayRules.move(t2, column: 4)       // bob's reply (move number 1)
        send(&t, second, from: b)                        // arrives first
        XCTAssertEqual(t.c4.moves, 0)
        send(&t, first, from: a)
        XCTAssertEqual(t.c4.moves, 2, "the early move is applied once its predecessor arrives")
    }

    func testRematchSwapsWhoGoesFirst() throws {
        var s = try started(.connect4)
        for _ in 0..<3 { send(&s, PlayRules.move(s, column: 0), from: a); send(&s, PlayRules.move(s, column: 1), from: b) }
        send(&s, PlayRules.move(s, column: 0), from: a)
        XCTAssertEqual(s.status, .finished)
        send(&s, PlayRules.rematch(s), from: a)
        XCTAssertEqual(s.status, .finished, "one person asking is not enough")
        send(&s, PlayRules.rematch(s), from: b)
        XCTAssertEqual(s.status, .playing)
        XCTAssertEqual(s.p1, b)
        XCTAssertEqual(s.round, 1)
        XCTAssertEqual(s.c4.moves, 0)
    }

    func testRockPaperScissorsCommitRevealAndCheating() throws {
        var s = try started(.rps)
        let salt1 = "s1", salt2 = "s2"
        send(&s, PlayRules.commit(s, pick: 1, salt: salt1), from: a)         // alice: paper
        send(&s, PlayRules.commit(s, pick: 0, salt: salt2), from: b)         // bob: rock
        // Bob tries to change his pick after seeing alice's: the hash doesn't match.
        let cheat = s
        send(&s, PlayRules.reveal(s, pick: 2, salt: salt2), from: b)
        XCTAssertEqual(s, cheat.withStashOf(PlayRules.reveal(s, pick: 2, salt: salt2), from: b), "a changed pick is not accepted")
        s = cheat
        send(&s, PlayRules.reveal(s, pick: 1, salt: salt1), from: a)
        send(&s, PlayRules.reveal(s, pick: 0, salt: salt2), from: b)
        XCTAssertEqual(s.rps.score, [1, 0])
        XCTAssertEqual(s.rps.last, [1, 0])
        XCTAssertEqual(s.rps.n, 1)
        // Alice wins the second game too: first to two.
        send(&s, PlayRules.commit(s, pick: 2, salt: "x"), from: a)
        send(&s, PlayRules.commit(s, pick: 1, salt: "y"), from: b)
        send(&s, PlayRules.reveal(s, pick: 2, salt: "x"), from: a)
        send(&s, PlayRules.reveal(s, pick: 1, salt: "y"), from: b)
        XCTAssertEqual(s.status, .finished)
        XCTAssertEqual(s.winner, a)
    }

    func testRockPaperScissorsTiesAndEarlyReveals() throws {
        var s = try started(.rps)
        let reveal = PlayRules.reveal(s, pick: 0, salt: "p")
        send(&s, reveal, from: a)                                   // before her own commit: kept, not applied
        XCTAssertNil(s.rps.reveal[0])
        send(&s, PlayRules.commit(s, pick: 0, salt: "p"), from: a)
        XCTAssertEqual(s.rps.reveal[0], 0, "the early reveal is applied once the commit is in")
        send(&s, PlayRules.commit(s, pick: 0, salt: "q"), from: b)
        send(&s, PlayRules.reveal(s, pick: 0, salt: "q"), from: b)
        XCTAssertEqual(s.rps.score, [0, 0], "a tie scores nothing")
        XCTAssertNil(s.rps.lastWinner)
        XCTAssertEqual(s.rps.n, 1)
    }

    // MARK: Battleship

    func testFleetsAreLegalAndAnswersAreRight() {
        for _ in 0..<50 { XCTAssertTrue(Battleship.isLegalFleet(Battleship.randomFleet())) }
        XCTAssertFalse(Battleship.isLegalFleet(String(repeating: "0", count: 100)))
        var broken = Array(Battleship.randomFleet()); broken.swapAt(broken.firstIndex { $0 == "A" }!, broken.firstIndex { $0 == "0" }!)
        // (moving one cell of a ship away from the others usually breaks the shape; the check must never crash)
        _ = Battleship.isLegalFleet(String(broken))
        // A fleet in the top-left corner, row by row: A on row 0, B row 1, ...
        var rows = [Character](repeating: "0", count: 100)
        for (i, f) in Battleship.fleet.enumerated() { for c in 0..<f.length { rows[i * 10 + c] = f.id } }
        let board = String(rows)
        XCTAssertTrue(Battleship.isLegalFleet(board))
        XCTAssertEqual(Battleship.answer(board: board, shot: [0], cell: 0), 1)
        XCTAssertEqual(Battleship.answer(board: board, shot: [99], cell: 99), 0)
        XCTAssertEqual(Battleship.answer(board: board, shot: [40, 41], cell: 41), 12, "sinking the 2-long ship answers 10 + 2")
    }

    /// Plays two simulated players (each with their own fleet) to the end, the way the app does.
    private func playBattleship(cheat: Bool) throws -> PlaySession {
        var s = try started(.battleship)
        let fa = Battleship.randomFleet(), fb = Battleship.randomFleet()
        send(&s, PlayRules.ready(s, board: fa, salt: "sa"), from: a)
        send(&s, PlayRules.ready(s, board: fb, salt: "sb"), from: b)
        XCTAssertTrue(s.bs.bothReady)
        var shotAtA = Set<Int>(), shotAtB = Set<Int>()
        var order = Array(0..<100).shuffled()
        var order2 = Array(0..<100).shuffled()
        var guardCount = 0
        while s.status == .playing, guardCount < 300 {
            guardCount += 1
            let aMoves = s.bs.moves % 2 == 0           // alice is player 1
            let shooter = aMoves ? a : b, target = aMoves ? b : a
            let cell = aMoves ? order.removeLast() : order2.removeLast()
            XCTAssertTrue(PlayRules.canShoot(s, id: shooter, cell: cell))
            send(&s, PlayRules.shoot(s, cell: cell), from: shooter)
            XCTAssertEqual(s.bs.pendingCell, cell)
            XCTAssertFalse(PlayRules.canShoot(s, id: shooter, cell: (cell + 1) % 100), "no second shot before the answer")
            let board = aMoves ? fb : fa
            if aMoves { shotAtB.insert(cell) } else { shotAtA.insert(cell) }
            var code = Battleship.answer(board: board, shot: aMoves ? shotAtB : shotAtA, cell: cell)
            if cheat, code == 1, target == b, Bool.random() { code = 0 }      // bob lies about a hit
            send(&s, PlayRules.result(s, cell: cell, answer: code), from: target)
        }
        XCTAssertEqual(s.status, .finished)
        send(&s, PlayRules.revealFleet(s, board: fa, salt: "sa"), from: a)
        send(&s, PlayRules.revealFleet(s, board: fb, salt: "sb"), from: b)
        return s
    }

    func testAnHonestBattleshipGameEndsAndBothFleetsCheckOut() throws {
        let s = try playBattleship(cheat: false)
        XCTAssertNotNil(s.winner)
        XCTAssertEqual(s.bs.revealed, [true, true])
        let loserIndex = s.winner == a ? 1 : 0
        XCTAssertEqual(s.bs.hits[loserIndex], 17)
    }

    func testALyingOpponentIsCaughtAtTheReveal() throws {
        var caught = false
        for _ in 0..<5 where !caught {                // bob lies at random, so give it a few games
            let s = try playBattleship(cheat: true)
            if s.bs.revealed[1] == false { caught = true }
        }
        XCTAssertTrue(caught, "a fleet that doesn't match its answers is flagged")
    }

    func testBattleshipOrderAndTurnRules() throws {
        var s = try started(.battleship)
        send(&s, PlayRules.shoot(s, cell: 9), from: b)
        XCTAssertNil(s.bs.pendingCell, "no shooting before both fleets are ready")
        send(&s, PlayRules.ready(s, board: Battleship.randomFleet(), salt: "x"), from: a)
        send(&s, PlayRules.ready(s, board: Battleship.randomFleet(), salt: "y"), from: b)
        XCTAssertNil(s.bs.pendingCell, "bob isn't first, so his early shot is not played")
        send(&s, PlayRules.shoot(s, cell: 5), from: a)
        XCTAssertEqual(s.bs.pendingCell, 5)
        send(&s, PlayRules.result(s, cell: 6, answer: 0), from: b)
        XCTAssertEqual(s.bs.moves, 0, "an answer for a different cell is ignored")
        send(&s, PlayRules.result(s, cell: 5, answer: 0), from: a)
        XCTAssertEqual(s.bs.moves, 0, "only the player shot at can answer")
        send(&s, PlayRules.result(s, cell: 5, answer: 0), from: b)
        XCTAssertEqual(s.bs.moves, 1)
        XCTAssertEqual(s.bs.shots[1][5], 1)
        XCTAssertEqual(s.bs.shooter, 1, "now it's bob's turn")
        // Bob's early shot (move 0) was stale by now and is gone; he shoots again with the right move number.
        send(&s, PlayRules.shoot(s, cell: 9), from: b)
        XCTAssertEqual(s.bs.pendingCell, 9)
    }

    func testMessagesSurviveJSON() throws {
        let m = PlayRules.commit(try started(.rps), pick: 2, salt: "abc")
        XCTAssertEqual(try JSONDecoder().decode(PlayMessage.self, from: JSONEncoder().encode(m)), m)
        XCTAssertNil(PlayRules.parse(PlayMessage(g: "bs", op: "result", gid: "g", r: 0, n: 0, a: 5, b: 7)), "answers are 0, 1 or 10 + a ship length")
        XCTAssertNil(PlayRules.parse(PlayMessage(g: "c4", op: "move", gid: "g", r: 0, n: 0, a: 9)))
    }
}

private extension PlaySession {
    /// For the cheating test: the same session with this message kept in the stash (a rejected-but-possibly-early message).
    func withStashOf(_ m: PlayMessage, from: String) -> PlaySession { var c = self; c.stash.append(PlayStash(m: m, from: from)); return c }
}
