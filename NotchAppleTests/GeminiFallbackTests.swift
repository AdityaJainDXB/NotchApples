//
//  GeminiFallbackTests.swift
//  Notch apple tests
//
//  The order Gemini models are tried in when one fails.
//

import XCTest

final class GeminiFallbackTests: XCTestCase {
    func testTheChosenModelIsFirstThenTheLiveList() {
        let c = GeminiFallbackLogic.candidates(chosen: "gemini-x", live: ["gemini-a", "gemini-b"])
        XCTAssertEqual(Array(c.prefix(3)), ["gemini-x", "gemini-a", "gemini-b"])
    }

    func testNoRepeatsAndAtMostFourAttempts() {
        let c = GeminiFallbackLogic.candidates(chosen: "gemini-a", live: ["gemini-a", "gemini-b", "gemini-b", "gemini-c", "gemini-d", "gemini-e"])
        XCTAssertEqual(c, ["gemini-a", "gemini-b", "gemini-c", "gemini-d"])
    }

    func testStillHasKnownModelsWhenTheLiveListIsEmpty() {
        let c = GeminiFallbackLogic.candidates(chosen: "gemini-x", live: [])
        XCTAssertEqual(c.first, "gemini-x")
        XCTAssertGreaterThan(c.count, 1)
        XCTAssertEqual(Set(c).count, c.count)
    }
}
