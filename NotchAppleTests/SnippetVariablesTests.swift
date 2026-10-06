//
//  SnippetVariablesTests.swift
//  Notch apple tests
//
//  Placeholders in snippets. The Windows app runs the same cases against services/snippetvars.js.
//

import XCTest

final class SnippetVariablesTests: XCTestCase {
    private let v = ["date": "6 Oct 2026", "time": "3:45 PM", "clipboard": "pasted text"]

    func testKnownPlaceholdersAreReplaced() {
        XCTAssertEqual(SnippetVariables.expand("Hi, today is {date} at {time}.", values: v), "Hi, today is 6 Oct 2026 at 3:45 PM.")
        XCTAssertEqual(SnippetVariables.expand("Re: {clipboard}", values: v), "Re: pasted text")
    }

    func testNamesAreCaseInsensitiveAndRepeatable() {
        XCTAssertEqual(SnippetVariables.expand("{DATE} {Date} {date}", values: v), "6 Oct 2026 6 Oct 2026 6 Oct 2026")
    }

    func testUnknownBracesStayExactlyAsTyped() {
        XCTAssertEqual(SnippetVariables.expand("function() { return {name}; }", values: v), "function() { return {name}; }")
        XCTAssertEqual(SnippetVariables.expand("{ date }", values: v), "{ date }")
        XCTAssertEqual(SnippetVariables.expand("{date", values: v), "{date")
    }

    func testPlainTextAndEmptyAreUntouched() {
        XCTAssertEqual(SnippetVariables.expand("no variables here", values: v), "no variables here")
        XCTAssertEqual(SnippetVariables.expand("", values: v), "")
    }

    func testReplacementTextIsNotExpandedAgain() {
        XCTAssertEqual(SnippetVariables.expand("{clipboard}", values: ["clipboard": "{date}"]), "{date}")
    }

    func testEmojiAndAccentsSurvive() {
        XCTAssertEqual(SnippetVariables.expand("Café ☕ {date} 🎉", values: v), "Café ☕ 6 Oct 2026 🎉")
    }
}
