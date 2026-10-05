//
//  GameEngineTests.swift
//  Notch apple tests
//
//  The mini-game rules: Snake's turn queue (the fix for dropped keys), walls and growth,
//  Breakout's bounces, bricks and lives, and the Memory pattern game.
//

import XCTest

final class SnakeEngineTests: XCTestCase {
    func testQuickTapsKeepTheirOrder() {
        var s = SnakeEngine()
        XCTAssertTrue(s.enqueue(.up))
        XCTAssertTrue(s.enqueue(.left))           // up then left, both within one tick
        XCTAssertEqual(s.pending, [.up, .left])
        XCTAssertEqual(s.step(), .moved)
        XCTAssertEqual(s.direction, .up)
        XCTAssertEqual(s.step(), .moved)
        XCTAssertEqual(s.direction, .left)        // the second tap is not lost
    }

    func testQueueHoldsTwoAndDropsTheThird() {
        var s = SnakeEngine()
        XCTAssertTrue(s.enqueue(.up))
        XCTAssertTrue(s.enqueue(.left))
        XCTAssertFalse(s.enqueue(.down), "a third turn in one tick is dropped")
        XCTAssertEqual(s.pending.count, 2)
    }

    func testReversingAndRepeatsAreIgnored() {
        var s = SnakeEngine()
        XCTAssertFalse(s.enqueue(.left), "straight back into yourself")
        XCTAssertFalse(s.enqueue(.right), "already going right")
        XCTAssertTrue(s.enqueue(.up))
        XCTAssertFalse(s.enqueue(.down), "reverse of the turn already waiting")
    }

    func testWallEndsTheGame() {
        var s = SnakeEngine()
        s.start()
        var events: [SnakeEngine.Event] = []
        for _ in 0..<40 { events.append(s.step()); if !s.alive { break } }
        XCTAssertEqual(events.last, .died)
        XCTAssertFalse(s.alive)
        XCTAssertEqual(s.step(), .idle)
    }

    func testEatingGrowsAndMovesTheFood() {
        var s = SnakeEngine()
        s.start()
        var g = SystemRandomNumberGenerator()
        var ate = false
        for _ in 0..<12 where !ate { ate = s.step(&g) == .ate }
        XCTAssertTrue(ate)
        XCTAssertEqual(s.score, 1)
        XCTAssertFalse(s.body.contains(s.food))
    }

    func testNothingMovesBeforeStart() {
        var s = SnakeEngine()
        XCTAssertEqual(s.step(), .idle)
        XCTAssertEqual(s.body.first, SnakeEngine.Cell(x: 5, y: 6))
    }
}

final class BreakoutEngineTests: XCTestCase {
    func testBallWaitsOnThePaddleUntilLaunched() {
        var b = BreakoutEngine()
        b.movePaddle(to: 100)
        XCTAssertEqual(b.ball.x, 100)
        XCTAssertTrue(b.step(0.016).isEmpty)
        b.launch()
        XCTAssertTrue(b.launched)
    }

    func testPaddleStaysInsideTheField() {
        var b = BreakoutEngine()
        b.movePaddle(to: -50)
        XCTAssertEqual(b.paddleX, BreakoutEngine.paddleWidth / 2)
        b.movePaddle(to: 9999)
        XCTAssertEqual(b.paddleX, BreakoutEngine.width - BreakoutEngine.paddleWidth / 2)
    }

    func testBrickIsRemovedAndScored() {
        var b = BreakoutEngine()
        b.launch()
        var got: [BreakoutEngine.Event] = []
        for _ in 0..<600 { got += b.step(1.0 / 60); if got.contains(.brick) || b.over { break }; b.movePaddle(to: b.ball.x) }
        XCTAssertTrue(got.contains(.brick))
        XCTAssertGreaterThan(b.score, 0)
        XCTAssertEqual(b.bricks.count, BreakoutEngine.brickCols * BreakoutEngine.brickRows - 1)
    }

    func testMissingTheBallCostsALifeThenEndsTheGame() {
        var b = BreakoutEngine()
        var events: [BreakoutEngine.Event] = []
        for _ in 0..<3 {
            b.movePaddle(to: BreakoutEngine.paddleWidth / 2)           // paddle in the far corner
            b.launch()
            for _ in 0..<2000 { events += b.step(1.0 / 60); if !b.launched { break } }
        }
        XCTAssertEqual(b.lives, 0)
        XCTAssertTrue(b.over)
        XCTAssertTrue(events.contains(.lifeLost))
        XCTAssertEqual(events.last, .gameOver)
    }

    func testALongStallDoesNotTeleportTheBall() {
        var b = BreakoutEngine()
        b.launch()
        let y0 = b.ball.y
        _ = b.step(5)                                                   // clamped to 1/30 s
        XCTAssertLessThan(abs(b.ball.y - y0), 20)
    }
}

final class MemoryEngineTests: XCTestCase {
    func testRepeatingThePatternAdvancesTheRound() {
        var m = MemoryEngine()
        var g = SystemRandomNumberGenerator()
        m.nextRound(&g)
        XCTAssertEqual(m.round, 1)
        XCTAssertEqual(m.press(m.sequence[0]), .roundComplete)
        m.nextRound(&g)
        XCTAssertEqual(m.round, 2)
        XCTAssertEqual(m.press(m.sequence[0]), .correct)
        XCTAssertEqual(m.press(m.sequence[1]), .roundComplete)
    }

    func testAWrongPadEndsTheRunAndScoresCompletedRounds() {
        var m = MemoryEngine()
        var g = SystemRandomNumberGenerator()
        m.nextRound(&g); _ = m.press(m.sequence[0])
        m.nextRound(&g)
        let wrong = (m.sequence[0] + 1) % MemoryEngine.pads
        XCTAssertEqual(m.press(wrong), .wrong)
        XCTAssertEqual(m.score, 1)
        m.reset()
        XCTAssertEqual(m.round, 0)
    }
}
