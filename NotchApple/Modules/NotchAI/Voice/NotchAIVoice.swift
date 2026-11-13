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
//  Speech to text is a choice: Apple Speech (default, live text) or Whisper (whisper.cpp the user installed; the words
//  arrive when the recording stops). Hands-free (off by default) ends a sentence by itself after a pause and listens
//  again after each spoken answer; it stops listening when nobody speaks. The wake word (off by default) is in
//  NotchAIWakeWord.swift.
//

import AppKit
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

    /// Speech to text: "apple" (Apple Speech, on this Mac when supported) or "whisper" (whisper.cpp, on this Mac).
    @Published var inputID: String { didSet { save(inputID, "notchai.voice.input") } }
    /// A pause ends the sentence, and NotchAI listens again after each spoken answer.
    @Published var handsFree: Bool { didSet { save(handsFree, "notchai.voice.handsFree") } }
    /// Listen for the wake phrase while idle. Off by default; on-device recognition only.
    @Published var wakeWordOn: Bool { didSet { save(wakeWordOn, "notchai.voice.wakeWord"); refreshWakeWord() } }
    @Published var wakePhrase: String { didSet { save(wakePhrase, "notchai.voice.wakePhrase"); refreshWakeWord() } }

    let providers: [SpeechProvider] = [AppleSpeechProvider(), PiperSpeechProvider(), GeminiSpeechProvider(), OpenAISpeechProvider()]
    var provider: SpeechProvider { providers.first { $0.id == providerID } ?? providers[0] }

    private var heard = ""
    /// The answer to the question being asked by voice is spoken even if "speak replies" is off.
    private var voiceTurn = false
    /// Which recogniser the current turn uses, so the other one closing its microphone is ignored.
    private var activeInput = "apple"
    /// This turn ends by itself after a pause (hands-free, or started by the wake word).
    private var silenceEnds = false
    private var turnStart = Date()
    private var lastHeardChange = Date()
    private var silenceTimer: Timer?
    /// The answer being spoken belongs to a spoken question, so hands-free may listen again after it.
    private var followUp = false
    private var bag = Set<AnyCancellable>()

    private init() {
        let d = UserDefaults.standard
        providerID = d.string(forKey: "notchai.voice.provider") ?? "apple"
        voiceID = d.string(forKey: "notchai.voice.voice") ?? ""
        speed = d.object(forKey: "notchai.voice.speed") as? Double ?? 1
        pitch = d.object(forKey: "notchai.voice.pitch") as? Double ?? 1
        volume = d.object(forKey: "notchai.voice.volume") as? Double ?? 1
        speakReplies = d.bool(forKey: "notchai.voice.speakReplies")
        inputID = d.string(forKey: "notchai.voice.input") ?? "apple"
        handsFree = d.bool(forKey: "notchai.voice.handsFree")
        wakeWordOn = d.bool(forKey: "notchai.voice.wakeWord")
        wakePhrase = d.string(forKey: "notchai.voice.wakePhrase") ?? WakeWordLogic.defaultPhrase
        for p in providers {
            p.onChunkStart = { [weak self, weak p] text in
                guard let self, let p, p.id == self.providerID else { return }
                self.caption = text
            }
            p.onSpeakingChange = { [weak self, weak p] speaking in
                guard let self, let p, p.id == self.providerID else { return }
                self.handle(speaking ? .speakingStarted : .speakingFinished)
            }
        }
        for p in providers {
            (p as? ChunkedAudioSpeechProvider)?.onProblem = { [weak self] message in self?.fail(message) }
        }
        applySettings()
        // The microphone closed (end of sentence, error, or Stop): decide what happens to what was heard.
        VoiceInput.shared.$isListening.dropFirst().removeDuplicates().sink { [weak self] listening in
            self?.updateWakePause()
            guard !listening, self?.activeInput == "apple" else { return }
            self?.microphoneClosed()
        }.store(in: &bag)
        VoiceInput.shared.$problem.compactMap { $0 }.sink { [weak self] message in
            guard self?.activeInput == "apple" else { return }
            self?.fail(message)
        }.store(in: &bag)
        WhisperInput.shared.$isListening.dropFirst().removeDuplicates().sink { [weak self] listening in
            self?.updateWakePause()
            guard !listening, self?.activeInput == "whisper" else { return }
            self?.microphoneClosed()
        }.store(in: &bag)
        WhisperInput.shared.$problem.compactMap { $0 }.sink { [weak self] message in
            self?.fail(message)
        }.store(in: &bag)
        if wakeWordOn { DispatchQueue.main.async { [weak self] in self?.refreshWakeWord() } }
    }

    // MARK: Wake word

    private func refreshWakeWord() {
        NotchAIWakeWord.shared.set(on: wakeWordOn, phrase: wakePhrase) { [weak self] in
            guard let self else { return }
            if !NotchAINotifier.shared.quietManual { NSSound(named: "Tink")?.play() }
            self.talk(auto: true)
            self.updateWakePause()
        }
        updateWakePause()
    }

    /// The wake word only listens while NotchAI is idle and nothing else has the microphone.
    private func updateWakePause() {
        // These publishers fire before the value is stored, so read the state on the next turn of the run loop.
        DispatchQueue.main.async {
            let busy = self.state != .idle && self.state != .error
            NotchAIWakeWord.shared.setPaused(busy || VoiceInput.shared.isListening || WhisperInput.shared.isListening || NotchAIDictation.shared.listening)
        }
    }

    private func save(_ v: Any, _ key: String) { UserDefaults.standard.set(v, forKey: key) }

    private func applySettings() {
        let p = provider
        p.setVoice(voiceID); p.setSpeed(speed); p.setPitch(pitch); p.setVolume(volume)
    }

    // MARK: Push to talk

    /// Press once to start listening, press again to finish. Pressing while NotchAI is speaking interrupts it.
    /// `auto` is a turn NotchAI started itself (the wake word, or listening again in hands-free): a pause ends it.
    func talk(auto: Bool = false) {
        switch state {
        case .listening, .transcribing:
            endSentence()                        // microphoneClosed() carries on
        default:
            if auto, NotchAIConversation.shared.busy { return }
            if state == .speaking { followUp = false; provider.stop(); handle(.startListening) }   // -> INTERRUPTED
            else { handle(.startListening) }
            problem = nil; caption = ""; heard = ""; voiceTurn = true
            silenceEnds = auto || handsFree
            turnStart = Date(); lastHeardChange = Date()
            if inputID == "whisper" {
                activeInput = "whisper"
                WhisperInput.shared.start(onRecordingEnded: { [weak self] in self?.handle(.heardWords) }) { [weak self] text in
                    self?.heard = text; self?.caption = text
                }
            } else {
                activeInput = "apple"
                VoiceInput.shared.start { [weak self] text in
                    guard let self else { return }
                    if text != self.heard { self.lastHeardChange = Date() }
                    self.heard = text; self.caption = text
                    if !text.isEmpty { self.handle(.heardWords) }
                }
            }
            startSilenceTimer()
        }
    }

    private func endSentence() {
        stopSilenceTimer()
        if activeInput == "whisper" { WhisperInput.shared.stop() } else { VoiceInput.shared.stop() }
    }

    /// Cancel listening without sending anything.
    func cancelListening() {
        guard NotchAIVoiceLogic.isCapturingAudio(state) || state == .interrupted else { return }
        heard = ""
        stopSilenceTimer()
        if activeInput == "whisper" {
            if WhisperInput.shared.isTranscribing { return }      // the words are already on their way
            WhisperInput.shared.stop(discard: true)
        } else {
            VoiceInput.shared.stop()
        }
    }

    // MARK: Hands-free

    private func startSilenceTimer() {
        stopSilenceTimer()
        guard silenceEnds else { return }
        silenceTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.checkSilence() }
        }
    }

    private func stopSilenceTimer() { silenceTimer?.invalidate(); silenceTimer = nil }

    private func checkSilence() {
        guard NotchAIVoiceLogic.isCapturingAudio(state) || state == .interrupted else { stopSilenceTimer(); return }
        let now = Date()
        let heardSomething: Bool, sinceActivity: TimeInterval
        if activeInput == "whisper" {
            let w = WhisperInput.shared
            guard w.isListening, !w.isTranscribing else { return }
            w.sampleLevel()
            heardSomething = w.lastSpeechAt != nil
            sinceActivity = now.timeIntervalSince(w.lastSpeechAt ?? turnStart)
        } else {
            guard VoiceInput.shared.isListening else { return }     // still waiting for permission
            heardSomething = !heard.trimmingCharacters(in: .whitespaces).isEmpty
            sinceActivity = now.timeIntervalSince(lastHeardChange)
        }
        switch HandsFreeLogic.decide(heardSomething: heardSomething, sinceActivity: sinceActivity, sinceStart: now.timeIntervalSince(turnStart)) {
        case .keepListening: break
        case .finish: endSentence()
        case .giveUp: cancelListening()
        }
    }

    func stopSpeaking() {
        followUp = false
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
        stopSilenceTimer()
        guard !text.isEmpty else { voiceTurn = false; handle(.cancelled); if state != .idle { handle(.reset) }; return }
        handle(.speechEnded)                      // -> THINKING
        NotchAIConversation.shared.send(text)
    }

    /// Called by NotchAIConversation when an answer (or an error) arrives.
    func conversationFinished(reply: String?, error: Error?) {
        let wantsSpeech = voiceTurn || speakReplies
        followUp = voiceTurn && handsFree
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
        let old = state
        state = new
        updateWakePause()
        // Hands-free: after the answer to a spoken question has been read out, listen for the next one.
        if old == .speaking, new == .idle, event == .speakingFinished, followUp, handsFree {
            followUp = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
                guard let self, self.state == .idle, self.handsFree else { return }
                self.talk(auto: true)
            }
        }
        switch NotchAIVoiceLogic.dotLook(new) {
        case .idle: CursorCompanion.shared.setState(.idle)
        case .listening: CursorCompanion.shared.setState(.listening)
        case .thinking: CursorCompanion.shared.setState(.thinking)
        case .speaking: CursorCompanion.shared.setState(.speaking)
        }
        if new == .idle { caption = "" }
    }
}
