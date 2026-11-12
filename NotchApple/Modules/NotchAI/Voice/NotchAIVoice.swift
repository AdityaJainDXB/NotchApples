//
//  NotchAIVoice.swift
//  Notch Apple
//
//  The voice loop: push-to-talk, speech to text (the app's existing on-device VoiceInput, Apple Speech), the shared
//  NotchAI conversation (so the same Local-first guard and providers apply), and the answer spoken by the chosen
//  SpeechProvider. STT, the AI model and TTS are three separate choices.
//
//  State (NotchAIVoiceLogic): IDLE, LISTENING, TRANSCRIBING, THINKING, EXECUTING, SPEAKING, INTERRUPTED, ERROR.
//  The green dot follows it (listening glow, thinking ring, speaking pulse). The microphone is only open between
//  pressing Talk and the end of your sentence; nothing is recorded otherwise, and nothing leaves the Mac unless the
//  chosen model or voice is a cloud one that Local first has been told to allow.
//
//  Interrupting: pressing Talk while NotchAI is speaking stops the speech at once and starts listening.
//

import Combine
import Foundation

@MainActor
final class NotchAIVoice: ObservableObject {
    static let shared = NotchAIVoice()

    @Published private(set) var state: NotchAIVoiceState = .idle
    /// Live caption: what the recogniser has heard so far, then what is being spoken.
    @Published private(set) var caption = ""
    @Published private(set) var problem: String?

    // Settings (UserDefaults)
    @Published var providerID: String { didSet { save(providerID, "notchai.voice.provider"); applySettings() } }
    @Published var voiceID: String { didSet { save(voiceID, "notchai.voice.voice"); applySettings() } }
    @Published var speed: Double { didSet { save(speed, "notchai.voice.speed"); applySettings() } }
    @Published var pitch: Double { didSet { save(pitch, "notchai.voice.pitch"); applySettings() } }
    @Published var volume: Double { didSet { save(volume, "notchai.voice.volume"); applySettings() } }
    /// Speak every NotchAI answer aloud, not only the ones asked by voice.
    @Published var speakReplies: Bool { didSet { save(speakReplies, "notchai.voice.speakReplies") } }

    let providers: [SpeechProvider] = [AppleSpeechProvider(), GeminiSpeechProvider()]
    var provider: SpeechProvider { providers.first { $0.id == providerID } ?? providers[0] }

    private var heard = ""
    /// The answer to the question being asked by voice is spoken even if "speak replies" is off.
    private var voiceTurn = false
    private var bag = Set<AnyCancellable>()

    private init() {
        let d = UserDefaults.standard
        providerID = d.string(forKey: "notchai.voice.provider") ?? "apple"
        voiceID = d.string(forKey: "notchai.voice.voice") ?? ""
        speed = d.object(forKey: "notchai.voice.speed") as? Double ?? 1
        pitch = d.object(forKey: "notchai.voice.pitch") as? Double ?? 1
        volume = d.object(forKey: "notchai.voice.volume") as? Double ?? 1
        speakReplies = d.bool(forKey: "notchai.voice.speakReplies")
        for p in providers {
            p.onSpeakingChange = { [weak self, weak p] speaking in
                guard let self, let p, p.id == self.providerID else { return }
                self.handle(speaking ? .speakingStarted : .speakingFinished)
            }
        }
        applySettings()
        // The microphone closed (end of sentence, error, or Stop): decide what happens to what was heard.
        VoiceInput.shared.$isListening.dropFirst().removeDuplicates().sink { [weak self] listening in
            guard !listening else { return }
            self?.microphoneClosed()
        }.store(in: &bag)
        VoiceInput.shared.$problem.compactMap { $0 }.sink { [weak self] message in
            self?.fail(message)
        }.store(in: &bag)
    }

    private func save(_ v: Any, _ key: String) { UserDefaults.standard.set(v, forKey: key) }

    private func applySettings() {
        let p = provider
        p.setVoice(voiceID); p.setSpeed(speed); p.setPitch(pitch); p.setVolume(volume)
    }

    // MARK: Push to talk

    /// Press once to start listening, press again to finish. Pressing while NotchAI is speaking interrupts it.
    func talk() {
        switch state {
        case .listening, .transcribing:
            VoiceInput.shared.stop()             // ends the sentence; microphoneClosed() carries on
        default:
            if state == .speaking { provider.stop(); handle(.startListening) }   // -> INTERRUPTED
            else { handle(.startListening) }
            problem = nil; caption = ""; heard = ""; voiceTurn = true
            VoiceInput.shared.start { [weak self] text in
                guard let self else { return }
                self.heard = text; self.caption = text
                if !text.isEmpty { self.handle(.heardWords) }
            }
        }
    }

    /// Cancel listening without sending anything.
    func cancelListening() {
        guard NotchAIVoiceLogic.isCapturingAudio(state) || state == .interrupted else { return }
        heard = ""
        VoiceInput.shared.stop()
    }

    func stopSpeaking() {
        provider.stop()
        if state == .speaking { handle(.interrupt); handle(.cancelled); handle(.reset) }
    }

    /// Speaks text for an agent (the Voice agent's tool). Cloud voices still obey Local first.
    func speakText(_ text: String) throws {
        applySettings()
        try provider.speak(text)
    }

    func previewVoice() {
        problem = nil
        applySettings()
        do { try provider.speak("Hello, this is how I sound.") } catch { fail(error.localizedDescription) }
    }

    // MARK: Events

    private func microphoneClosed() {
        guard NotchAIVoiceLogic.isCapturingAudio(state) || state == .interrupted else { return }
        let text = heard.trimmingCharacters(in: .whitespacesAndNewlines)
        heard = ""
        guard !text.isEmpty else { voiceTurn = false; handle(.cancelled); return }
        handle(.speechEnded)                      // -> THINKING
        NotchAIConversation.shared.send(text)
    }

    /// Called by NotchAIConversation when an answer (or an error) arrives.
    func conversationFinished(reply: String?, error: Error?) {
        let wantsSpeech = voiceTurn || speakReplies
        voiceTurn = false
        if let error { if state != .idle { fail(error.localizedDescription) }; return }
        guard let reply, !reply.isEmpty else { handle(.reset); return }
        guard wantsSpeech else { if state != .idle { handle(.aiReplied(speak: false)) }; return }
        applySettings()
        do {
            caption = reply
            if state == .idle { handle(.aiStarted) }
            try provider.speak(reply)
            handle(.aiReplied(speak: true))
        } catch {
            fail(error.localizedDescription)
        }
    }

    private func fail(_ message: String) {
        problem = message
        handle(.failed)
    }

    private func handle(_ event: NotchAIVoiceEvent) {
        let new = NotchAIVoiceLogic.next(state, event)
        guard new != state else { return }
        state = new
        switch NotchAIVoiceLogic.dotLook(new) {
        case .idle: CursorCompanion.shared.setState(.idle)
        case .listening: CursorCompanion.shared.setState(.listening)
        case .thinking: CursorCompanion.shared.setState(.thinking)
        case .speaking: CursorCompanion.shared.setState(.speaking)
        }
        if new == .idle { caption = "" }
    }
}
