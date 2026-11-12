//
//  SpeechProvider.swift
//  Notch Apple
//
//  NotchAI's text-to-speech, independent of the AI model that wrote the text. Every engine implements
//  SpeechProvider (speak, stop, pause, resume, previewVoice, listVoices, setVoice, setSpeed, plus pitch and volume):
//
//   • AppleSpeechProvider: AVSpeechSynthesizer, on this Mac, offline, the default. Long text is cut into sentence
//     chunks so speech starts at once and Stop works between them.
//   • GeminiSpeechProvider: Gemini TTS, a cloud voice, OFF unless the user turned on "Allow cloud and unverified
//     models" (Local first). It sends the text to Google, so it is never used as a fallback and never used silently.
//
//  Piper (local neural TTS) and OpenAI TTS are not built yet; they would be two more conformers of this protocol.
//  OpenRouter is not a TTS provider and is not offered here.
//

import AVFoundation
import Foundation

struct SpeechVoice: Identifiable, Equatable {
    let id: String
    let name: String
    let language: String
    let isCloud: Bool
    var detail: String { language }
}

enum SpeechError: LocalizedError {
    case cloudNotAllowed(String)
    case missingKey
    case badResponse(String)

    var errorDescription: String? {
        switch self {
        case .cloudNotAllowed(let name):
            "\(name) is a cloud voice: it sends the text to its servers. Local first is on, so nothing was sent. Allow cloud models in Settings → AI, or use the on-device voice."
        case .missingKey: "Add your Gemini key in Settings → AI to use Gemini TTS."
        case .badResponse(let m): "The voice service didn't return audio: \(m)"
        }
    }
}

@MainActor
protocol SpeechProvider: AnyObject {
    var id: String { get }
    var displayName: String { get }
    /// True when the text never leaves this Mac.
    var runsLocally: Bool { get }
    var isSpeaking: Bool { get }
    /// Called with true when speech starts and false when it ends or is stopped.
    var onSpeakingChange: ((Bool) -> Void)? { get set }

    func speak(_ text: String) throws
    func stop()
    func pause()
    func resume()
    func previewVoice()
    func listVoices() -> [SpeechVoice]
    func setVoice(_ id: String)
    func setSpeed(_ speed: Double)
    func setPitch(_ pitch: Double)
    func setVolume(_ volume: Double)
}

// MARK: - Apple (on-device)

@MainActor
final class AppleSpeechProvider: NSObject, SpeechProvider, AVSpeechSynthesizerDelegate {
    let id = "apple"
    let displayName = "Apple voice (on this Mac)"
    let runsLocally = true
    var onSpeakingChange: ((Bool) -> Void)?

    private let synth = AVSpeechSynthesizer()
    private var voiceID: String?
    private var speed = 1.0
    private var pitch = 1.0
    private var volume = 1.0
    private var pending = 0

    var isSpeaking: Bool { pending > 0 }

    override init() { super.init(); synth.delegate = self }

    func speak(_ text: String) throws {
        stop()
        let chunks = NotchAIVoiceLogic.chunks(NotchAIVoiceLogic.spokenText(fromMarkdown: text))
        guard !chunks.isEmpty else { return }
        for c in chunks { synth.speak(utterance(c)) }   // the synthesizer queues them; the first starts at once
        pending = chunks.count
        onSpeakingChange?(true)
    }

    private func utterance(_ text: String) -> AVSpeechUtterance {
        let u = AVSpeechUtterance(string: text)
        if let voiceID, let v = AVSpeechSynthesisVoice(identifier: voiceID) { u.voice = v }
        u.rate = NotchAIVoiceLogic.utteranceRate(speed: speed)
        u.pitchMultiplier = Float(min(max(pitch, 0.5), 2))
        u.volume = Float(min(max(volume, 0), 1))
        return u
    }

    func stop() {
        let wasSpeaking = pending > 0
        pending = 0
        synth.stopSpeaking(at: .immediate)
        if wasSpeaking { onSpeakingChange?(false) }
    }

    func pause() { synth.pauseSpeaking(at: .word) }
    func resume() { synth.continueSpeaking() }

    func previewVoice() { try? speak("Hello, this is how I sound.") }

    func listVoices() -> [SpeechVoice] {
        AVSpeechSynthesisVoice.speechVoices()
            .map { SpeechVoice(id: $0.identifier, name: $0.name, language: $0.language, isCloud: false) }
            .sorted { ($0.language, $0.name) < ($1.language, $1.name) }
    }

    func setVoice(_ id: String) { voiceID = id.isEmpty ? nil : id }
    func setSpeed(_ speed: Double) { self.speed = speed }
    func setPitch(_ pitch: Double) { self.pitch = pitch }
    func setVolume(_ volume: Double) { self.volume = volume }

    nonisolated func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) {
        Task { @MainActor in
            guard self.pending > 0 else { return }
            self.pending -= 1
            if self.pending == 0 { self.onSpeakingChange?(false) }
        }
    }

    nonisolated func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) {}
}

// MARK: - Gemini TTS (cloud, opt-in)

@MainActor
final class GeminiSpeechProvider: NSObject, SpeechProvider, AVAudioPlayerDelegate {
    let id = "gemini"
    let displayName = "Gemini voice (cloud)"
    let runsLocally = false
    var onSpeakingChange: ((Bool) -> Void)?

    /// The model that makes the audio. A setting, because Google renames these; this is the documented TTS model.
    static let defaultModel = "gemini-2.5-flash-preview-tts"
    static let voices = ["Kore", "Puck", "Charon", "Aoede", "Leda", "Zephyr", "Fenrir", "Orus"]

    private var voiceName = "Kore"
    private var volume = 1.0
    private var player: AVAudioPlayer?
    private var task: Task<Void, Never>?
    private(set) var isSpeaking = false

    func speak(_ text: String) throws {
        // Local first: a cloud voice only runs if the user allowed cloud, and never as a silent fallback.
        guard ModelLocality.allowCloud else { throw SpeechError.cloudNotAllowed(displayName) }
        guard let key = AIProvider.gemini.apiKey else { throw SpeechError.missingKey }
        stop()
        let spoken = NotchAIVoiceLogic.spokenText(fromMarkdown: text)
        guard !spoken.isEmpty else { return }
        let model = UserDefaults.standard.string(forKey: "notchai.voice.geminiModel") ?? Self.defaultModel
        isSpeaking = true
        onSpeakingChange?(true)
        let voice = voiceName
        task = Task { [weak self] in
            do {
                // Chunked: the first sentence group is requested and played while the rest are fetched.
                for chunk in NotchAIVoiceLogic.chunks(spoken, maxCharacters: 400) {
                    try Task.checkCancellation()
                    let wav = try await Self.fetch(chunk, voice: voice, model: model, key: key)
                    try Task.checkCancellation()
                    await self?.play(wav)
                }
            } catch {}
            self?.finish()
        }
    }

    private static func fetch(_ text: String, voice: String, model: String, key: String) async throws -> Data {
        let escaped = model.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? model
        var r = URLRequest(url: URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(escaped):generateContent")!)
        r.httpMethod = "POST"
        r.timeoutInterval = 60
        r.setValue(key, forHTTPHeaderField: "x-goog-api-key")
        r.setValue("application/json", forHTTPHeaderField: "content-type")
        let body: [String: Any] = [
            "contents": [["parts": [["text": text]]]],
            "generationConfig": ["responseModalities": ["AUDIO"],
                                 "speechConfig": ["voiceConfig": ["prebuiltVoiceConfig": ["voiceName": voice]]]],
        ]
        r.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: r)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw SpeechError.badResponse("HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)")
        }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let parts = (((json?["candidates"] as? [[String: Any]])?.first?["content"] as? [String: Any])?["parts"] as? [[String: Any]]) ?? []
        guard let b64 = parts.compactMap({ ($0["inlineData"] as? [String: Any])?["data"] as? String }).first,
              let pcm = Data(base64Encoded: b64) else { throw SpeechError.badResponse("no audio in the answer") }
        return NotchAIVoiceLogic.wav(pcm: pcm)
    }

    private func play(_ wav: Data) async {
        guard let p = try? AVAudioPlayer(data: wav) else { return }
        p.volume = Float(volume)
        player = p
        p.play()
        while p.isPlaying, !Task.isCancelled { try? await Task.sleep(nanoseconds: 80_000_000) }
    }

    private func finish() {
        guard isSpeaking else { return }
        isSpeaking = false
        player = nil
        onSpeakingChange?(false)
    }

    func stop() {
        task?.cancel(); task = nil
        player?.stop()
        finish()
    }

    func pause() { player?.pause() }
    func resume() { player?.play() }
    func previewVoice() { try? speak("Hello, this is how I sound.") }
    func listVoices() -> [SpeechVoice] { Self.voices.map { SpeechVoice(id: $0, name: $0, language: "Gemini", isCloud: true) } }
    func setVoice(_ id: String) { if Self.voices.contains(id) { voiceName = id } }
    func setSpeed(_ speed: Double) {}      // Gemini TTS has no speed control; the style is set by the text
    func setPitch(_ pitch: Double) {}
    func setVolume(_ volume: Double) { self.volume = volume }
}
