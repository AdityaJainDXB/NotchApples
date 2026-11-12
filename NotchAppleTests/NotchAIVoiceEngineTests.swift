//
//  NotchAIVoiceEngineTests.swift
//  Notch Apple tests
//
//  The rules behind the extra voice engines (OpenAI TTS, Piper, Whisper), hands-free listening and the wake word.
//

import XCTest

final class NotchAIVoiceEngineTests: XCTestCase {
    // MARK: OpenAI TTS

    func testOpenAIBodyHasTheTextVoiceAndWavFormat() {
        let b = OpenAITTS.body(text: "Hello", voice: "nova", model: "", speed: 1.2)
        XCTAssertEqual(b["input"] as? String, "Hello")
        XCTAssertEqual(b["voice"] as? String, "nova")
        XCTAssertEqual(b["model"] as? String, OpenAITTS.defaultModel)
        XCTAssertEqual(b["response_format"] as? String, "wav")
        XCTAssertEqual(b["speed"] as? Double, 1.2)
    }

    func testOpenAIUnknownVoiceAndWildSpeedAreMadeSafe() {
        let b = OpenAITTS.body(text: "x", voice: "../etc", model: "tts-1", speed: 9)
        XCTAssertEqual(b["voice"] as? String, "alloy")
        XCTAssertEqual(b["model"] as? String, "tts-1")
        XCTAssertEqual(b["speed"] as? Double, 2.0)
        XCTAssertEqual(OpenAITTS.speed(0.1), 0.5)
    }

    // MARK: Local engines

    func testFindsTheFirstInstalledProgram() {
        let found = LocalEngineLogic.find(["piper", "piper-tts"], home: "/Users/a") { $0 == "/Users/a/.local/bin/piper" }
        XCTAssertEqual(found, "/Users/a/.local/bin/piper")
        XCTAssertNil(LocalEngineLogic.find(["piper"], home: "/Users/a") { _ in false })
        XCTAssertEqual(LocalEngineLogic.candidates(["x"], home: "/h").first, "/opt/homebrew/bin/x")
    }

    func testAUserPathIsTrimmedUnquotedAndExpanded() {
        XCTAssertEqual(LocalEngineLogic.path("  ~/voices/en.onnx \n", home: "/Users/a"), "/Users/a/voices/en.onnx")
        XCTAssertEqual(LocalEngineLogic.path("\"/opt/my voices/en.onnx\"", home: "/Users/a"), "/opt/my voices/en.onnx")
        XCTAssertEqual(LocalEngineLogic.path("~", home: "/Users/a"), "/Users/a")
        XCTAssertEqual(LocalEngineLogic.path("", home: "/Users/a"), "")
        XCTAssertEqual(LocalEngineLogic.path("~other/x", home: "/Users/a"), "~other/x")
    }

    func testProblemsAreNamedInOrder() {
        func problem(_ binary: String, _ model: String, exe: Bool = true, exists: Bool = true) -> String? {
            LocalEngineLogic.problem(engine: "Piper", binary: binary, model: model, modelKind: "voice file", installHint: "Install it.",
                                     isExecutable: { _ in exe }, exists: { _ in exists })
        }
        XCTAssertTrue(problem("", "")!.contains("not installed"))
        XCTAssertTrue(problem("/x/piper", "/m", exe: false)!.contains("was not found at /x/piper"))
        XCTAssertTrue(problem("/x/piper", "")!.contains("Choose a voice file"))
        XCTAssertTrue(problem("/x/piper", "/m.onnx", exists: false)!.contains("/m.onnx"))
        XCTAssertNil(problem("/x/piper", "/m.onnx"))
    }

    func testPiperArgumentsNeverGoThroughAShell() {
        let a = PiperLogic.arguments(model: "/v/en voice.onnx", output: "/tmp/o.wav", speed: 2)
        XCTAssertEqual(a, ["--model", "/v/en voice.onnx", "--output_file", "/tmp/o.wav", "--length_scale", "0.50"])
        XCTAssertEqual(PiperLogic.arguments(model: "m", output: "o", speed: 0.1).last, "2.00")
        XCTAssertEqual(PiperLogic.voiceName("/v/en_US-lessac-medium.onnx"), "en_US-lessac-medium")
    }

    func testWhisperArgumentsAndLanguage() {
        XCTAssertEqual(WhisperLogic.arguments(model: "/m.bin", wav: "/a.wav", language: "EN "), ["-m", "/m.bin", "-f", "/a.wav", "-l", "en", "-nt", "-np"])
        XCTAssertEqual(WhisperLogic.arguments(model: "m", wav: "a", language: "; rm -rf")[5], "auto")
        XCTAssertEqual(WhisperLogic.arguments(model: "m", wav: "a", language: "")[5], "auto")
    }

    func testWhisperOutputIsCleaned() {
        XCTAssertEqual(WhisperLogic.clean("\n[00:00:00.000 --> 00:00:02.500]   Hello there.\n[00:00:02.500 --> 00:00:04.000]  How are you?\n"), "Hello there. How are you?")
        XCTAssertEqual(WhisperLogic.clean(" [BLANK_AUDIO] "), "")
        XCTAssertEqual(WhisperLogic.clean("(music) Open my notes [inaudible]"), "Open my notes")
        XCTAssertEqual(WhisperLogic.clean("  What   is\n the time?  "), "What is the time?")
    }

    // MARK: Hands-free

    func testAPauseAfterSpeechEndsTheSentence() {
        XCTAssertEqual(HandsFreeLogic.decide(heardSomething: true, sinceActivity: 0.5, sinceStart: 3), .keepListening)
        XCTAssertEqual(HandsFreeLogic.decide(heardSomething: true, sinceActivity: 1.6, sinceStart: 3), .finish)
    }

    func testSilenceGivesUpAndSendsNothing() {
        XCTAssertEqual(HandsFreeLogic.decide(heardSomething: false, sinceActivity: 5, sinceStart: 5), .keepListening)
        XCTAssertEqual(HandsFreeLogic.decide(heardSomething: false, sinceActivity: 8, sinceStart: 8), .giveUp)
    }

    func testATurnIsNeverLongerThanAMinute() {
        XCTAssertEqual(HandsFreeLogic.decide(heardSomething: true, sinceActivity: 0.1, sinceStart: 60), .finish)
        XCTAssertEqual(HandsFreeLogic.decide(heardSomething: false, sinceActivity: 0.1, sinceStart: 61), .giveUp)
    }

    func testSpeechLevel() {
        XCTAssertTrue(HandsFreeLogic.isSpeech(level: -20))
        XCTAssertFalse(HandsFreeLogic.isSpeech(level: -55))
    }

    // MARK: Wake word

    func testTheWakePhraseIsFoundWithPunctuationAndCase() {
        XCTAssertEqual(WakeWordLogic.match(transcript: "Hey, Notch!", phrase: "hey notch"), "")
        XCTAssertEqual(WakeWordLogic.match(transcript: "so anyway hey notch what's the weather", phrase: "Hey Notch"), "what s the weather")
        XCTAssertEqual(WakeWordLogic.match(transcript: "Hay nosh", phrase: "hey notch"), "")
    }

    func testOrdinarySpeechDoesNotWake() {
        XCTAssertNil(WakeWordLogic.match(transcript: "take it up a notch", phrase: "hey notch"))
        XCTAssertNil(WakeWordLogic.match(transcript: "hey there", phrase: "hey notch"))
        XCTAssertNil(WakeWordLogic.match(transcript: "notch hey", phrase: "hey notch"))
        XCTAssertNil(WakeWordLogic.match(transcript: "", phrase: "hey notch"))
        XCTAssertNil(WakeWordLogic.match(transcript: "hey", phrase: "hey notch"))
    }

    func testOnlyTheLastWakePhraseCounts() {
        XCTAssertEqual(WakeWordLogic.match(transcript: "hey notch stop hey notch open mail", phrase: "hey notch"), "open mail")
    }

    func testACustomPhraseMatchesExactlyOnly() {
        XCTAssertEqual(WakeWordLogic.match(transcript: "okay computer listen", phrase: "okay computer"), "listen")
        XCTAssertNil(WakeWordLogic.match(transcript: "okay commuter", phrase: "okay computer"))
    }

    func testPhraseRules() {
        XCTAssertNil(WakeWordLogic.problem(phrase: "hey notch"))
        XCTAssertNotNil(WakeWordLogic.problem(phrase: "notch"))
        XCTAssertNotNil(WakeWordLogic.problem(phrase: "a b"))
        XCTAssertNotNil(WakeWordLogic.problem(phrase: "one two three four five"))
        XCTAssertNotNil(WakeWordLogic.problem(phrase: "   "))
        XCTAssertEqual(WakeWordLogic.normalise("  Héy,   NOTCH!! "), "hey notch")
    }
}
