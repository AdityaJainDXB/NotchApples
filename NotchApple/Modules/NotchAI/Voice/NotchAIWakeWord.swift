//
//  NotchAIWakeWord.swift
//  Notch Apple
//
//  The optional wake word ("Hey Notch"). OFF by default.
//
//  While it is on, the microphone is open and Apple's speech recogniser listens for the phrase ON THIS MAC ONLY:
//  the request requires on-device recognition, and if this Mac cannot recognise speech on the device the wake word
//  refuses to start rather than send audio anywhere. Nothing heard is stored or sent; the transcript is thrown away
//  each time it is checked. macOS shows its own orange microphone light, and the Voice section and the NotchAI header
//  show "Listening for the wake word" for as long as the microphone is open.
//
//  It pauses whenever anything else uses the microphone (Talk, dictation) or NotchAI is speaking, and starts again
//  when NotchAI is idle. Hearing the phrase starts one hands-free Talk turn, exactly as if Talk had been pressed.
//

import AVFoundation
import Foundation
import Speech

@MainActor
final class NotchAIWakeWord: ObservableObject {
    static let shared = NotchAIWakeWord()

    /// True only while the microphone is open for the wake word.
    @Published private(set) var listening = false
    @Published private(set) var problem: String?

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var restart: DispatchWorkItem?
    private var phrase = WakeWordLogic.defaultPhrase
    private var onWake: (() -> Void)?
    /// The user's setting; `listening` is false while paused even if this is true.
    private var wanted = false
    private var paused = false

    func set(on: Bool, phrase: String, onWake: @escaping () -> Void) {
        self.phrase = phrase
        self.onWake = onWake
        wanted = on
        if !on { problem = nil }
        apply()
    }

    /// Pause while something else needs the microphone or NotchAI is busy; resume afterwards.
    func setPaused(_ p: Bool) {
        guard paused != p else { return }
        paused = p
        apply()
    }

    private func apply() {
        let should = wanted && !paused
        if should, !listening { authoriseAndStart() }
        if !should, listening { stopListening() }
    }

    private func authoriseAndStart() {
        if let p = WakeWordLogic.problem(phrase: phrase) { problem = p; return }
        SFSpeechRecognizer.requestAuthorization { status in
            Task { @MainActor in
                guard status == .authorized else {
                    self.problem = "Allow Speech Recognition in System Settings → Privacy & Security to use the wake word."
                    return
                }
                guard self.wanted, !self.paused, !self.listening else { return }
                self.start()
            }
        }
    }

    private func start() {
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else { problem = "Speech recognition isn't available right now."; return }
        // Never off this Mac: without on-device recognition there is no wake word.
        guard recognizer.supportsOnDeviceRecognition else {
            problem = "This Mac cannot recognise speech on the device for the current language, so the wake word stays off (it never sends audio anywhere)."
            return
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.requiresOnDeviceRecognition = true
        let input = engine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in req.append(buffer) }
        do { engine.prepare(); try engine.start() } catch {
            input.removeTap(onBus: 0)
            problem = "Couldn't use the microphone: \(error.localizedDescription)"; return
        }
        request = req
        problem = nil
        listening = true
        let phrase = phrase
        task = recognizer.recognitionTask(with: req) { result, error in
            let heard = result?.bestTranscription.formattedString
            let ended = error != nil || result?.isFinal == true
            Task { @MainActor in
                guard self.listening else { return }
                if let heard, WakeWordLogic.match(transcript: heard, phrase: phrase) != nil {
                    self.stopListening()
                    self.onWake?()                 // the owner pauses us while it talks, and resumes after
                } else if ended {
                    self.cycle()
                }
            }
        }
        // Start a fresh request regularly so the transcript stays short and old audio is dropped.
        let work = DispatchWorkItem { [weak self] in self?.cycle() }
        restart = work
        DispatchQueue.main.asyncAfter(deadline: .now() + WakeWordLogic.restartEvery, execute: work)
    }

    private func cycle() {
        guard listening else { return }
        stopListening()
        apply()
    }

    private func stopListening() {
        restart?.cancel(); restart = nil
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil; task = nil
        listening = false
    }
}
