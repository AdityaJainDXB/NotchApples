//
//  NotchAITests.swift
//  Notch Apple tests
//
//  NotchAI's green dot maths (follow rule, smoothing, settling, trail) and the custom OpenAI-compatible provider.
//

import XCTest

final class NotchAITests: XCTestCase {
    func testDotStaysPutWhilePointerIsWithinFollowDistance() {
        let g = CompanionMotion.goal(pointer: CGPoint(x: 110, y: 100), dot: CGPoint(x: 100, y: 100), followDistance: 26)
        XCTAssertEqual(g, CGPoint(x: 100, y: 100))
    }

    func testDotStopsFollowDistanceShortOfPointer() {
        let g = CompanionMotion.goal(pointer: CGPoint(x: 200, y: 0), dot: .zero, followDistance: 30)
        XCTAssertEqual(g.x, 170, accuracy: 0.001)
        XCTAssertEqual(g.y, 0, accuracy: 0.001)
    }

    func testDotNeverBacksAwayFromPointer() {
        // Pointer walks onto the dot: the goal is the dot itself, so it stays clickable.
        let dot = CGPoint(x: 50, y: 50)
        XCTAssertEqual(CompanionMotion.goal(pointer: CGPoint(x: 52, y: 50), dot: dot, followDistance: 26), dot)
    }

    func testStepMovesTowardGoalWithoutOvershoot() {
        var p = CGPoint.zero
        let goal = CGPoint(x: 100, y: 40)
        for _ in 0..<600 {
            let n = CompanionMotion.step(from: p, to: goal, speed: 0.5, dt: 1.0 / 60)
            XCTAssertLessThanOrEqual(n.x, goal.x + 0.0001)
            XCTAssertGreaterThanOrEqual(n.x, p.x - 0.0001)
            p = n
        }
        XCTAssertTrue(CompanionMotion.isSettled(pos: p, goal: goal))
    }

    func testFasterSpeedCatchesUpSooner() {
        let slow = CompanionMotion.step(from: .zero, to: CGPoint(x: 100, y: 0), speed: 0.1, dt: 0.1)
        let fast = CompanionMotion.step(from: .zero, to: CGPoint(x: 100, y: 0), speed: 1.0, dt: 0.1)
        XCTAssertGreaterThan(fast.x, slow.x)
    }

    func testSmoothingIsFrameRateIndependent() {
        var a = CGPoint.zero, b = CGPoint.zero
        let goal = CGPoint(x: 100, y: 0)
        for _ in 0..<30 { a = CompanionMotion.step(from: a, to: goal, speed: 0.5, dt: 1.0 / 60) }
        for _ in 0..<15 { b = CompanionMotion.step(from: b, to: goal, speed: 0.5, dt: 1.0 / 30) }
        XCTAssertEqual(a.x, b.x, accuracy: 0.01)
    }

    func testHoverRadius() {
        XCTAssertTrue(CompanionMotion.isOver(pointer: CGPoint(x: 5, y: 0), dot: .zero, radius: 10))
        XCTAssertFalse(CompanionMotion.isOver(pointer: CGPoint(x: 20, y: 0), dot: .zero, radius: 10))
    }

    func testTrailOnlyOnFastMovement() {
        XCTAssertEqual(CompanionMotion.trailStrength(velocity: 100), 0)
        XCTAssertEqual(CompanionMotion.trailStrength(velocity: 5000), 1)
        XCTAssertGreaterThan(CompanionMotion.trailStrength(velocity: 900), 0)
    }

    // MARK: Quick Ask and the dot

    func testQuickAskOpensWhenClosed() {
        XCTAssertTrue(QuickAskRule.shouldOpen(isOpen: false, lastFocusLossClose: nil, now: 100))
    }

    func testClickingTheDotWhileOpenClosesItInsteadOfOpeningAgain() {
        XCTAssertFalse(QuickAskRule.shouldOpen(isOpen: true, lastFocusLossClose: nil, now: 100))
    }

    func testTheClickThatTookFocusAwayDoesNotReopenIt() {
        XCTAssertFalse(QuickAskRule.shouldOpen(isOpen: false, lastFocusLossClose: 100, now: 100.05))
        XCTAssertFalse(QuickAskRule.shouldOpen(isOpen: false, lastFocusLossClose: 100, now: 100 + QuickAskRule.reopenGuard - 0.01))
    }

    func testALaterClickOpensItAgain() {
        XCTAssertTrue(QuickAskRule.shouldOpen(isOpen: false, lastFocusLossClose: 100, now: 100 + QuickAskRule.reopenGuard + 0.01))
        XCTAssertTrue(QuickAskRule.shouldOpen(isOpen: false, lastFocusLossClose: 100, now: 99))   // clock went backwards
    }

    func testTrailNeverShowsUnderReduceMotion() {
        XCTAssertTrue(CompanionMotion.showsTrail(user: true, reduceMotion: false, velocity: 3000))
        XCTAssertFalse(CompanionMotion.showsTrail(user: true, reduceMotion: true, velocity: 3000))
        XCTAssertFalse(CompanionMotion.showsTrail(user: false, reduceMotion: false, velocity: 3000))
        XCTAssertFalse(CompanionMotion.showsTrail(user: true, reduceMotion: false, velocity: 100))
    }
}
