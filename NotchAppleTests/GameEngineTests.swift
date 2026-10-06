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

final class CookieEngineTests: XCTestCase {
    func testClickingMakesCookiesAndCounts() {
        var c = CookieEngine()
        XCTAssertEqual(c.click(), 1)
        XCTAssertEqual(c.cookies, 1)
        XCTAssertEqual(c.clicks, 1)
    }

    func testBuyingNeedsEnoughCookiesAndRaisesThePrice() {
        var c = CookieEngine()
        XCTAssertFalse(c.buy(.cursor), "no cookies yet")
        c.cookies = 1000
        let first = c.cost(.cursor)
        XCTAssertEqual(first, 15)
        XCTAssertTrue(c.buy(.cursor))
        XCTAssertEqual(c.count(.cursor), 1)
        XCTAssertEqual(c.cookies, 985)
        XCTAssertGreaterThan(c.cost(.cursor), first, "each one costs more")
    }

    func testAutoClickersBakeOverTime() {
        var c = CookieEngine()
        c.cookies = 10_000
        XCTAssertTrue(c.buy(.grandma))
        XCTAssertEqual(c.cps, 1, accuracy: 1e-9)
        let before = c.cookies
        c.tick(10)
        XCTAssertEqual(c.cookies - before, 10, accuracy: 1e-9)
        XCTAssertEqual(c.baked, 10, accuracy: 1e-9, "baked counts only what was made, not what was spent")
    }

    func testClickUpgradesDoubleEachClickInOrder() {
        var c = CookieEngine()
        XCTAssertFalse(c.buyClickUpgrade())
        c.cookies = 100
        XCTAssertTrue(c.buyClickUpgrade())
        XCTAssertEqual(c.clickValue, 2)
        XCTAssertEqual(c.click(), 2)
        XCTAssertEqual(c.nextClickUpgradeCost, 500)
        c.cookies = 1e9
        while c.buyClickUpgrade() {}
        XCTAssertNil(c.nextClickUpgradeCost, "there is a last upgrade")
        XCTAssertEqual(c.clickValue, pow(2, Double(CookieEngine.clickUpgradeCosts.count)))
    }

    func testBadTimeStepsAreIgnored() {
        var c = CookieEngine()
        c.cookies = 10_000; c.buy(.grandma)
        let before = c.cookies
        c.tick(-5); c.tick(.nan); c.tick(0)
        XCTAssertEqual(c.cookies, before)
    }

    func testAwayTimeIsCappedAtAnHourAtHalfSpeed() {
        var c = CookieEngine()
        c.cookies = 10_000; c.buy(.grandma)
        let start = c.cookies
        let saved = Date(timeIntervalSince1970: 1_000_000)
        c.savedAt = saved
        c.applyOffline(now: saved.addingTimeInterval(10 * 3600))    // ten hours away
        XCTAssertEqual(c.cookies - start, 1800, accuracy: 1e-6, "one grandma, an hour, half speed")
    }

    func testSaveAndLoadKeepProgress() throws {
        var c = CookieEngine()
        c.cookies = 5_000; c.buy(.farm); c.click()
        let data = try JSONEncoder().encode(c)
        XCTAssertEqual(try JSONDecoder().decode(CookieEngine.self, from: data), c)
    }

    func testNumbersAreShortened() {
        XCTAssertEqual(CookieEngine.format(999), "999")
        XCTAssertEqual(CookieEngine.format(12_300), "12.3K")
        XCTAssertEqual(CookieEngine.format(4_560_000), "4.56M")
        XCTAssertEqual(CookieEngine.format(-5), "0")
    }
}

final class RunnerEngineTests: XCTestCase {
    private func settle(_ r: inout RunnerEngine, seconds: Double) {
        var g = SystemRandomNumberGenerator()
        var t = 0.0
        while t < seconds { _ = r.step(1.0 / 60, &g); t += 1.0 / 60 }
    }

    func testNothingMovesUntilItStarts() {
        var r = RunnerEngine()
        XCTAssertEqual(r.step(0.1), .none)
        XCTAssertEqual(r.distance, 0)
    }

    func testJumpingLeavesTheGroundAndLandsAgain() {
        var r = RunnerEngine()
        XCTAssertEqual(r.jump(), .jumped)
        var g = SystemRandomNumberGenerator()
        _ = r.step(1.0 / 60, &g)
        XCTAssertFalse(r.onGround, "one step after the jump the cube is in the air")
        var sawAir = false
        for _ in 0..<120 { _ = r.step(1.0 / 60, &g); if !r.onGround { sawAir = true }; if r.over { break } }
        XCTAssertTrue(sawAir)
        // Whatever happened, the cube never sinks below the floor.
        XCTAssertLessThanOrEqual(r.playerY, RunnerEngine.groundY - RunnerEngine.playerSize + 0.001)
    }

    func testYouCannotJumpTwiceInTheAir() {
        var r = RunnerEngine()
        XCTAssertEqual(r.jump(), .jumped)
        var g = SystemRandomNumberGenerator()
        _ = r.step(0.05, &g)
        XCTAssertEqual(r.jump(), .none)
    }

    func testRunningIntoASpikeEndsTheRun() {
        var r = RunnerEngine()
        r.start()
        r.place(.spike, at: RunnerEngine.playerX + 4)
        var g = SystemRandomNumberGenerator()
        XCTAssertEqual(r.step(1.0 / 60, &g), .died)
        XCTAssertTrue(r.over)
        XCTAssertEqual(r.step(1.0 / 60, &g), .none, "nothing moves after the end")
    }

    func testJumpingOverASpikeSurvivesIt() {
        var r = RunnerEngine()
        r.start()
        r.place(.spike, at: RunnerEngine.playerX + 70)
        var g = SystemRandomNumberGenerator()
        var jumped = false
        for _ in 0..<90 {
            if !jumped, let o = r.obstacles.first, o.x - (RunnerEngine.playerX + RunnerEngine.playerSize) < 40 { _ = r.jump(); jumped = true }
            _ = r.step(1.0 / 60, &g)
        }
        XCTAssertFalse(r.over, "a well-timed jump clears a spike")
    }

    func testSpeedRisesButIsCapped() {
        var r = RunnerEngine()
        let slow = r.speed
        r.restart()
        var g = SystemRandomNumberGenerator()
        for _ in 0..<5 { _ = r.step(1.0 / 60, &g) }
        XCTAssertGreaterThanOrEqual(r.speed, slow)
        XCTAssertLessThanOrEqual(r.speed, 330)
    }

    func testTheMinimumGapAlwaysLeavesRoomForAJump() {
        for speed in stride(from: CGFloat(150), through: 330, by: 20) {
            let gap = RunnerEngine.minimumGap(speed: speed)
            let airTime = 2 * RunnerEngine.jumpSpeed / RunnerEngine.gravity
            XCTAssertGreaterThan(gap, speed * airTime * 0.8, "at \(speed) px/s the next obstacle must not come before the cube lands")
        }
    }

    func testObstaclesAreGeneratedAndOldOnesRemoved() {
        var r = RunnerEngine()
        r.start()
        var g = SystemRandomNumberGenerator()
        var seen = 0
        for _ in 0..<600 {
            _ = r.step(1.0 / 60, &g)
            if r.over { r.restart() }
            seen = max(seen, r.obstacles.count)
        }
        XCTAssertGreaterThan(seen, 0)
        XCTAssertLessThan(seen, 8, "off-screen obstacles are dropped")
    }
}
