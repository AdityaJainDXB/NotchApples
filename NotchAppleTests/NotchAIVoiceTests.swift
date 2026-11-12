//
//  NotchAIVoiceTests.swift
//  Notch Apple tests
//
//  The voice loop's rules: the state machine, what gets spoken, how it is chunked, the speed mapping and the WAV wrapper.
//

import XCTest

final class NotchAIVoiceTests: XCTestCase {
    typealias L = NotchAIVoiceLogic

    private func run(_ events: [NotchAIVoiceEvent], from s: NotchAIVoiceState = .idle) -> NotchAIVoiceState {
        events.reduce(s) { L.next($0, $1) }
    }

    // MARK: State machine

    func testAFullVoiceTurn() {
        var s = NotchAIVoiceState.idle
        for (e, want) in [(NotchAIVoiceEvent.startListening, NotchAIVoiceState.listening), (.heardWords, .transcribing),
                          (.speechEnded, .thinking), (.aiReplied(speak: true), .speaking), (.speakingFinished, .idle)] {
            s = L.next(s, e)
            XCTAssertEqual(s, want, "after \(e)")
        }
    }

    func testToolsMoveThinkingToExecutingAndBack() {
        XCTAssertEqual(run([.toolsRunning], from: .thinking), .executing)
        XCTAssertEqual(run([.aiReplied(speak: false)], from: .executing), .idle)
    }

    func testTalkingWhileSpeakingInterruptsThenListens() {
        XCTAssertEqual(run([.startListening], from: .speaking), .interrupted)
        XCTAssertEqual(run([.startListening, .heardWords], from: .speaking), .transcribing)
        XCTAssertEqual(run([.startListening, .speechEnded], from: .speaking), .thinking)
    }

    func testCancellingGoesBackToIdle() {
        XCTAssertEqual(run([.cancelled], from: .listening), .idle)
        XCTAssertEqual(run([.cancelled], from: .transcribing), .idle)
        XCTAssertEqual(run([.cancelled], from: .interrupted), .idle)
    }

    func testFailureAnywhereIsAnErrorThatTalkingClears() {
        for s in NotchAIVoiceState.allCases { XCTAssertEqual(L.next(s, .failed), .error) }
        XCTAssertEqual(run([.startListening], from: .error), .listening)
        XCTAssertEqual(run([.reset], from: .error), .idle)
    }

    func testIrrelevantEventsChangeNothing() {
        XCTAssertEqual(run([.speakingFinished, .heardWords, .speechEnded], from: .idle), .idle)
    }

    func testDotLookAndMicrophoneIndicator() {
        XCTAssertEqual(L.dotLook(.listening), .listening)
        XCTAssertEqual(L.dotLook(.transcribing), .thinking)
        XCTAssertEqual(L.dotLook(.executing), .thinking)
        XCTAssertEqual(L.dotLook(.speaking), .speaking)
        XCTAssertEqual(L.dotLook(.error), .idle)
        XCTAssertTrue(L.isCapturingAudio(.listening))
        XCTAssertTrue(L.isCapturingAudio(.transcribing))
        XCTAssertFalse(L.isCapturingAudio(.thinking))
        XCTAssertFalse(L.isCapturingAudio(.speaking))
    }

    // MARK: Spoken text

    func testMarkdownIsNotReadAloud() {
        let md = "# Title\n\nUse **bold** and `code` here, see [the docs](https://example.com/x).\n\n- one\n- two\n\n```swift\nlet a = 1\n```\nDone."
        let spoken = L.spokenText(fromMarkdown: md)
        XCTAssertFalse(spoken.contains("#"))
        XCTAssertFalse(spoken.contains("**"))
        XCTAssertFalse(spoken.contains("```"))
        XCTAssertFalse(spoken.contains("let a = 1"))
        XCTAssertFalse(spoken.contains("https://"))
        XCTAssertTrue(spoken.contains("the docs"))
        XCTAssertTrue(spoken.contains("(code omitted)"))
        XCTAssertTrue(spoken.contains("one"))
    }

    func testBareLinksAreShortened() {
        XCTAssertEqual(L.spokenText(fromMarkdown: "Go to https://example.com/a/b?c=d now"), "Go to a link now")
    }

    // MARK: Chunking

    func testShortTextIsOneChunk() {
        XCTAssertEqual(L.chunks("Hello there. How are you?"), ["Hello there. How are you?"])
    }

    func testSentencesAreGroupedUpToTheLimit() {
        let text = "One two three. Four five six. Seven eight nine. Ten eleven twelve."
        let c = L.chunks(text, maxCharacters: 32)
        XCTAssertTrue(c.allSatisfy { $0.count <= 32 })
        XCTAssertEqual(c.joined(separator: " "), text)
        XCTAssertGreaterThan(c.count, 1)
    }

    func testAVeryLongSentenceIsCutAtACommaOrSpace() {
        let s = (1...60).map { "word\($0)" }.joined(separator: " ") + "."
        let c = L.chunks(s, maxCharacters: 80)
        XCTAssertTrue(c.allSatisfy { $0.count <= 80 })
        XCTAssertEqual(c.joined(separator: " "), s)
    }

    func testEmptyTextMakesNoChunks() {
        XCTAssertEqual(L.chunks("   \n "), [])
    }

    // MARK: Speed and audio

    func testSpeedMapsToAVSpeechRate() {
        XCTAssertEqual(L.utteranceRate(speed: 1), 0.5, accuracy: 0.0001)
        XCTAssertEqual(L.utteranceRate(speed: 0.5), 0.25, accuracy: 0.0001)
        XCTAssertEqual(L.utteranceRate(speed: 2), 0.75, accuracy: 0.0001)
        XCTAssertEqual(L.utteranceRate(speed: 9), 0.75, accuracy: 0.0001)   // clamped
        XCTAssertLessThan(L.utteranceRate(speed: 1.2), L.utteranceRate(speed: 1.6))
    }

    func testWavHeader() {
        let pcm = Data(repeating: 1, count: 100)
        let wav = L.wav(pcm: pcm)
        XCTAssertEqual(wav.count, 144)
        XCTAssertEqual(String(decoding: wav.prefix(4), as: UTF8.self), "RIFF")
        XCTAssertEqual(String(decoding: wav[8..<12], as: UTF8.self), "WAVE")
        XCTAssertEqual(String(decoding: wav[36..<40], as: UTF8.self), "data")
        XCTAssertEqual(Int(wav[40]) | Int(wav[41]) << 8, 100)                  // data length
        XCTAssertEqual(Int(wav[24]) | Int(wav[25]) << 8 | Int(wav[26]) << 16, 24_000)   // sample rate
    }
}
