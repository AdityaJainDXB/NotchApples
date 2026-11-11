//
//  DoItPolicyTests.swift
//  Notch Apple
//
//  The Do It agent's reliability decisions (NotchApple/Core/DoItPolicy.swift): stuck detection, screen-change judging,
//  retry policy, progress budget, scroll chunking and element trimming. The Windows twin runs the same cases
//  (NotchWindows/tests/doitpolicy.test.mjs).
//

import XCTest

final class DoItPolicyTests: XCTestCase {
    func testRunEndsAfterNoProgressOrCeilingNotBefore() {
        XCTAssertNil(DoItPolicy.shouldEnd(noProgress: 0, totalSteps: 0))
        XCTAssertNil(DoItPolicy.shouldEnd(noProgress: 14, totalSteps: 80), "step 80 alone no longer ends a run")
        XCTAssertEqual(DoItPolicy.shouldEnd(noProgress: 15, totalSteps: 80), .noProgress)
        XCTAssertEqual(DoItPolicy.shouldEnd(noProgress: 0, totalSteps: 300), .ceiling)
        XCTAssertNil(DoItPolicy.shouldEnd(noProgress: 0, totalSteps: 299))
    }

    func testNoProgressCounterResetsOnChangeAskAndZoom() {
        XCTAssertEqual(DoItPolicy.updateNoProgress(4, action: "click", changed: false), 5)
        XCTAssertEqual(DoItPolicy.updateNoProgress(4, action: "click", changed: true), 0)
        XCTAssertEqual(DoItPolicy.updateNoProgress(4, action: "ask", changed: false), 0)
        XCTAssertEqual(DoItPolicy.updateNoProgress(4, action: "zoom", changed: false), 0)
        XCTAssertEqual(DoItPolicy.updateNoProgress(0, action: "wait", changed: false), 1)
    }

    func testScreenChangeIsJudgedByFractionOfMovedCells() {
        let a = [UInt8](repeating: 100, count: 100)
        XCTAssertEqual(DoItPolicy.changedFraction(a, a), 0)
        var b = a
        b[0] = 200; b[1] = 200
        XCTAssertEqual(DoItPolicy.changedFraction(a, b), 0.02, accuracy: 0.0001)
        XCTAssertTrue(DoItPolicy.screenChanged(a, b))
        var c = a
        c[0] = 108
        XCTAssertFalse(DoItPolicy.screenChanged(a, c), "a tiny luma wobble is not a change")
        XCTAssertEqual(DoItPolicy.changedFraction([], []), 0, "two failed captures are not a change")
        XCTAssertEqual(DoItPolicy.changedFraction(a, []), 1, "mismatched signatures count as fully changed")
        XCTAssertEqual(DoItPolicy.changedFraction(a, Array(a.prefix(50))), 1)
    }

    func testNearIdenticalActionsShareOneKey() {
        XCTAssertEqual(DoItPolicy.actionKey(action: "click", x: 312, y: 448), DoItPolicy.actionKey(action: "click", x: 318, y: 442))
        XCTAssertNotEqual(DoItPolicy.actionKey(action: "click", x: 312, y: 448), DoItPolicy.actionKey(action: "click", x: 600, y: 448))
        XCTAssertNotEqual(DoItPolicy.actionKey(action: "click", x: 10, y: 10), DoItPolicy.actionKey(action: "right_click", x: 10, y: 10))
        XCTAssertEqual(DoItPolicy.actionKey(action: "key", key: "Return"), DoItPolicy.actionKey(action: "key", key: "return"))
        XCTAssertEqual(DoItPolicy.actionKey(action: "menu", path: ["File", "Export…"]), "menu File>Export…")
        XCTAssertEqual(DoItPolicy.actionKey(action: "click_element", id: 7), "click_element#7 ")
    }

    private func o(_ key: String, _ changed: Bool) -> DoItStepOutcome { DoItStepOutcome(key: key, changed: changed) }

    func testHintsEscalateAndChangeClearsThem() {
        XCTAssertEqual(DoItPolicy.hintLevel([]), 0)
        XCTAssertEqual(DoItPolicy.hintLevel([o("a", true), o("b", true)]), 0)
        XCTAssertEqual(DoItPolicy.hintLevel([o("a", false), o("a", false)]), 1, "two flat steps: gentle hint")
        XCTAssertEqual(DoItPolicy.hintLevel([o("a", false), o("a", false), o("a", false), o("a", false), o("a", false)]), 2, "five flat: change method")
        XCTAssertEqual(DoItPolicy.hintLevel([DoItStepOutcome](repeating: o("a", false), count: 8)), 3, "eight flat: ask the user")
        XCTAssertEqual(DoItPolicy.hintLevel([o("a", false), o("a", false), o("a", false)]), 2, "three same flat actions: change method")
        XCTAssertEqual(DoItPolicy.hintLevel([o("a", true), o("a", true), o("a", true)]), 0, "repeating while the screen changes is fine (scrolling a long page)")
        XCTAssertEqual(DoItPolicy.repeatRun([o("a", true), o("b", true), o("b", false)]), 2)
        XCTAssertEqual(DoItPolicy.noChangeRun([o("a", false), o("b", true), o("c", false)]), 1)
    }

    func testTransientAIErrorsAreRetriedPermanentOnesAreNot() {
        XCTAssertTrue(DoItPolicy.isTransientAIError("HTTP 429: rate limit exceeded"))
        XCTAssertTrue(DoItPolicy.isTransientAIError("The model is overloaded, please try again"))
        XCTAssertTrue(DoItPolicy.isTransientAIError("network connection lost"))
        XCTAssertTrue(DoItPolicy.isTransientAIError("The AI didn't answer in 90 seconds (timed out)"))
        XCTAssertFalse(DoItPolicy.isTransientAIError("Invalid API key"))
        XCTAssertFalse(DoItPolicy.isTransientAIError("401 unauthorized"))
        XCTAssertFalse(DoItPolicy.isTransientAIError("gpt-3.5 can't see images"))
        XCTAssertEqual(DoItPolicy.retryDelayMs(attempt: 0), 2000)
        XCTAssertEqual(DoItPolicy.retryDelayMs(attempt: 4), 60000)
        XCTAssertNil(DoItPolicy.retryDelayMs(attempt: 5), "after the budget the run gives up")
        XCTAssertLessThanOrEqual(DoItPolicy.retryDelaysMs.reduce(0, +), 120_000, "the whole budget stays near two minutes")
    }

    func testScrollsAreSplitIntoSmallSignedChunks() {
        XCTAssertEqual(DoItPolicy.scrollChunks(10), [4, 4, 2])
        XCTAssertEqual(DoItPolicy.scrollChunks(-6), [-4, -2])
        XCTAssertEqual(DoItPolicy.scrollChunks(3), [3])
        XCTAssertEqual(DoItPolicy.scrollChunks(0), [])
    }

    func testElementLinesAreCompactAndTrimKeepsMenusFocusFrontFirst() {
        let e = DoItElement(id: 3, role: "button", label: "Save", value: "", x: 512.7, y: 40.2, w: 80, h: 30, focused: true)
        XCTAssertEqual(DoItPolicy.elementLine(e), "3 button \"Save\" @512,40 80x30 FOCUSED")
        func mk(_ id: Int, focused: Bool = false, menu: Bool = false, front: Bool = true) -> DoItElement {
            DoItElement(id: id, role: "button", label: "b\(id)", value: "", x: 0, y: 0, w: 10, h: 10, focused: focused, menu: menu, front: front)
        }
        let all = [mk(1, front: false), mk(2), mk(3, focused: true), mk(4, menu: true)]
        XCTAssertEqual(DoItPolicy.trimElements(all).map(\.id), [4, 3, 2, 1])
        XCTAssertEqual(DoItPolicy.trimElements(all, maxCount: 2).count, 2)
        let many = (0..<200).map { mk($0) }
        XCTAssertEqual(DoItPolicy.trimElements(many).count, DoItPolicy.maxElements)
        XCTAssertLessThan(DoItPolicy.trimElements(many, maxCount: 200, maxChars: 300).count, 20, "the character budget also caps the list")
    }
}
