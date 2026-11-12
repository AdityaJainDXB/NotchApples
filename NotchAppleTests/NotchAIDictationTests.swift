//
//  NotchAIDictationTests.swift
//  Notch Apple tests
//
//  Dictation text rules (spoken punctuation, vocabulary, fillers, capitals) and quiet-mode / announcement rules.
//

import XCTest

final class NotchAIDictationTests: XCTestCase {
    typealias D = NotchAIDictationLogic

    func testSpokenPunctuationBecomesPunctuationWithTidySpacing() {
        XCTAssertEqual(D.clean("hello comma how are you question mark"), "Hello, how are you?")
        XCTAssertEqual(D.clean("it works period thanks exclamation mark"), "It works. Thanks!")
        XCTAssertEqual(D.clean("note colon buy milk semicolon eggs full stop"), "Note: buy milk; eggs.")
    }

    func testLineAndParagraphCommands() {
        XCTAssertEqual(D.clean("dear sam new line thanks new paragraph bye"), "Dear sam\nThanks\n\nBye")
    }

    func testFillerWordsAreDroppedButWordsContainingThemAreKept() {
        XCTAssertEqual(D.clean("um so uh the album was hmm great"), "So the album was great")
    }

    func testVocabularyCorrectionsAreWholeWordAndCaseInsensitive() {
        let v = ["note ch ai": "NotchAI", "open ai": "OpenAI"]
        XCTAssertEqual(D.clean("ask Note Ch AI about open ai", vocabulary: v), "Ask NotchAI about OpenAI")
        XCTAssertEqual(D.clean("a cannon", vocabulary: ["can": "CAN"]), "A cannon")
    }

    func testVocabularyReplacementsAreLiteral() {
        XCTAssertEqual(D.clean("my price", vocabulary: ["price": "$1 (a\\b)"]), "My $1 (a\\b)")
    }

    func testCapitalsAfterSentencesAndEmptyInput() {
        XCTAssertEqual(D.capitalised("one. two? three! four\nfive"), "One. Two? Three! Four\nFive")
        XCTAssertEqual(D.clean("   "), "")
    }

    func testCancelCommands() {
        for c in ["cancel that", "Scratch that.", "never mind", "Cancel dictation!"] { XCTAssertTrue(D.isCancelCommand(c), c) }
        XCTAssertFalse(D.isCancelCommand("please cancel that order"))
    }

    // MARK: Quiet mode

    func testQuietDuringCallsOrWhenSwitchedOn() {
        XCTAssertTrue(NotchAIQuietLogic.isQuiet(manual: false, frontmostBundleID: "us.zoom.xos"))
        XCTAssertTrue(NotchAIQuietLogic.isQuiet(manual: false, frontmostBundleID: "com.apple.FaceTime"))
        XCTAssertTrue(NotchAIQuietLogic.isQuiet(manual: true, frontmostBundleID: "com.apple.Safari"))
        XCTAssertFalse(NotchAIQuietLogic.isQuiet(manual: false, frontmostBundleID: "com.apple.Safari"))
        XCTAssertFalse(NotchAIQuietLogic.isQuiet(manual: false, frontmostBundleID: "com.obsproject.obs-studio"))   // a recorder is not a call
        XCTAssertFalse(NotchAIQuietLogic.isQuiet(manual: false, frontmostBundleID: nil))
    }

    func testSoundsAreHeldBackInQuietModeButBannersStillPost() {
        XCTAssertFalse(NotchAIQuietLogic.shouldChime(enabled: true, quiet: true))
        XCTAssertTrue(NotchAIQuietLogic.shouldChime(enabled: true, quiet: false))
        XCTAssertFalse(NotchAIQuietLogic.shouldSpeakUpdate(enabled: true, quiet: true))
        XCTAssertFalse(NotchAIQuietLogic.shouldSpeakUpdate(enabled: false, quiet: false))
        XCTAssertTrue(NotchAIQuietLogic.shouldNotify(enabled: true))
        XCTAssertFalse(NotchAIQuietLogic.shouldNotify(enabled: false))
    }

    func testAnnouncementsOnlyForStatesWorthKnowing() {
        XCTAssertEqual(NotchAIQuietLogic.announcement(title: "Research", state: .completed), "Finished: Research")
        XCTAssertEqual(NotchAIQuietLogic.announcement(title: "Research", state: .waitingApproval), "Needs your approval: Research")
        XCTAssertNotNil(NotchAIQuietLogic.announcement(title: "x", state: .failed))
        for s in [TaskState.running, .queued, .paused, .cancelled] { XCTAssertNil(NotchAIQuietLogic.announcement(title: "x", state: s)) }
    }
}
