//
//  LocalVoiceEngines.swift
//  Notch Apple
//
//  NotchAI's extra voice engines. The rules (command lines, request bodies, what is missing) are in
//  Core/NotchAIVoiceEngines.swift and are unit tested; this file is the part that touches audio, the network and
//  local programs.
//
//   • OpenAISpeechProvider: OpenAI's text to speech. A CLOUD voice: it sends the text of each answer to OpenAI, so it
//     refuses to run while Local first is on and is never a fallback.
//   • PiperSpeechProvider: Piper, a neural voice that runs on this Mac. The user installs Piper and a voice file;
//     NotchAI runs it once per sentence group and plays the result. Nothing leaves the Mac.
//   • WhisperInput: whisper.cpp, speech to text on this Mac. The user installs it and a model; NotchAI records the
//     question to a temporary file, runs Whisper on it, and deletes the file. Nothing leaves the Mac.
//
//  Piper and Whisper are programs the user chose and installed; NotchAI starts one only for a sentence and it ends
//  with that sentence. There is no helper app, server or background process.
//

import AVFoundation
import Foundation

// MARK: - Running a local program once

enum LocalProgram {
    struct Failure: LocalizedError { let message: String; var errorDescription: String? { message } }

    /// Runs `binary` with `arguments` (never through a shell), optionally writing `input` to it, and returns what it
    /// printed. Stops it after `timeout` seconds.
    static func run(_ binary: String, _ arguments: [String], input: Data? = nil, timeout: TimeInterval = 120) async throws -> String {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<String, Error>) in
            DispatchQueue.global(qos: .userInitiated).async {
                let p = Process()
                p.executableURL = URL(fileURLWithPath: binary)
                p.arguments = arguments
                let out = Pipe(), err = Pipe(), stdin = Pipe()
                p.standardOutput = out; p.standardError = err; p.standardInput = stdin
                do { try p.run() } catch { c.resume(throwing: Failure(message: "Could not start \(binary): \(error.localizedDescription)")); return }
                let killer = DispatchWorkItem { if p.isRunning { p.terminate() } }
                DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)
                // Drain the error pipe on the side so a chatty program cannot block on a full pipe.
                var errData = Data()
                let errQueue = DispatchQueue(label: "notchapple.localprogram.err")
                errQueue.async { errData = err.fileHandleForReading.readDataToEndOfFile() }
                if let input { stdin.fileHandleForWriting.write(input) }
                try? stdin.fileHandleForWriting.close()
                let data = out.fileHandleForReading.readDataToEndOfFile()
                p.waitUntilExit()
                killer.cancel()
                errQueue.sync {}
                if p.terminationStatus == 0 { c.resume(returning: String(decoding: data, as: UTF8.self)) }
                else {
                    let why = String(decoding: errData, as: UTF8.self).split(separator: "\n").last.map(String.init) ?? "exit code \(p.terminationStatus)"
                    c.resume(throwing: Failure(message: "\(URL(fileURLWithPath: binary).lastPathComponent) failed: \(why)"))
                }
            }
        }
    }

    static var home: String { NSHomeDirectory() }
    static func isExecutable(_ path: String) -> Bool { FileManager.default.isExecutableFile(atPath: path) }
    static func exists(_ path: String) -> Bool { FileManager.default.fileExists(atPath: path) }
}

/// Paths the user set for the local engines (Settings are plain text; "" means "look in the usual places").
enum LocalVoicePaths {
    static func value(_ key: String) -> String { LocalEngineLogic.path(UserDefaults.standard.string(forKey: key) ?? "", home: LocalProgram.home) }

    static var piperBinary: String {
        let p = value("notchai.voice.piperBinary")
        return p.isEmpty ? (LocalEngineLogic.find(PiperLogic.binaryNames, home: LocalProgram.home, isExecutable: LocalProgram.isExecutable) ?? "") : p
    }
    static var piperModel: String { value("notchai.voice.piperModel") }
    static var whisperBinary: String {
        let p = value("notchai.voice.whisperBinary")
        return p.isEmpty ? (LocalEngineLogic.find(WhisperLogic.binaryNames, home: LocalProgram.home, isExecutable: LocalProgram.isExecutable) ?? "") : p
    }
    static var whisperModel: String { value("notchai.voice.whisperModel") }

    static var piperProblem: String? {
        LocalEngineLogic.problem(engine: "Piper", binary: piperBinary, model: piperModel, modelKind: "voice file (.onnx)", installHint: PiperLogic.installHint,
                                 isExecutable: LocalProgram.isExecutable, exists: LocalProgram.exists)
    }
    static var whisperProblem: String? {
        LocalEngineLogic.problem(engine: "Whisper", binary: whisperBinary, model: whisperModel, modelKind: "model file (ggml .bin)", installHint: WhisperLogic.installHint,
                                 isExecutable: LocalProgram.isExecutable, exists: LocalProgram.exists)
    }
}

// MARK: - A provider that plays audio it fetched or made, chunk by chunk

@MainActor
class ChunkedAudioSpeechProvider: NSObject {
    var onSpeakingChange: ((Bool) -> Void)?
    var onChunkStart: ((String) -> Void)?
    /// Told when making the audio failed after speech had started (the caller shows it).
    var onProblem: ((String) -> Void)?
    private(set) var isSpeaking = false
    fileprivate var volume = 1.0
    private var player: AVAudioPlayer?
    private var task: Task<Void, Never>?

    /// Speaks `chunks` in order; `make` returns playable audio (a WAV) for one chunk.
    func play(chunks: [String], make: @escaping (String) async throws -> Data) {
        stop()
        guard !chunks.isEmpty else { return }
        isSpeaking = true
        onSpeakingChange?(true)
        task = Task { [weak self] in
            do {
                for chunk in chunks {
                    try Task.checkCancellation()
                    let audio = try await make(chunk)
                    try Task.checkCancellation()
                    self?.onChunkStart?(chunk)
                    await self?.playOne(audio)
                }
            } catch is CancellationError {
            } catch {
                self?.onProblem?(error.localizedDescription)
            }
            self?.finish()
        }
    }

    private func playOne(_ audio: Data) async {
        guard let p = try? AVAudioPlayer(data: audio) else { return }
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
    func setVolume(_ volume: Double) { self.volume = min(max(volume, 0), 1) }
}

// MARK: - OpenAI TTS (cloud, opt-in)

@MainActor
final class OpenAISpeechProvider: ChunkedAudioSpeechProvider, SpeechProvider {
    let id = "openai"
    let displayName = "OpenAI voice (cloud)"
    let runsLocally = false
    private var voiceName = "alloy"
    private var speed = 1.0

    func speak(_ text: String) throws {
        // Local first: a cloud voice only runs if the user allowed cloud, and never as a silent fallback.
        guard ModelLocality.allowCloud else { throw SpeechError.cloudNotAllowed(displayName) }
        guard let key = AIProvider.openAI.apiKey else { throw SpeechError.missingKeyFor("OpenAI") }
        let spoken = NotchAIVoiceLogic.spokenText(fromMarkdown: text)
        guard !spoken.isEmpty else { return }
        let model = UserDefaults.standard.string(forKey: "notchai.voice.openaiModel") ?? OpenAITTS.defaultModel
        let voice = voiceName, speed = speed
        play(chunks: NotchAIVoiceLogic.chunks(spoken, maxCharacters: 400)) { chunk in
            var r = URLRequest(url: URL(string: OpenAITTS.endpoint)!)
            r.httpMethod = "POST"
            r.timeoutInterval = 60
            r.setValue("Bearer \(key)", forHTTPHeaderField: "authorization")
            r.setValue("application/json", forHTTPHeaderField: "content-type")
            r.httpBody = try JSONSerialization.data(withJSONObject: OpenAITTS.body(text: chunk, voice: voice, model: model, speed: speed))
            let (data, response) = try await URLSession.shared.data(for: r)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                throw SpeechError.badResponse("HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)")
            }
            return data
        }
    }

    func previewVoice() { try? speak("Hello, this is how I sound.") }
    func listVoices() -> [SpeechVoice] { OpenAITTS.voices.map { SpeechVoice(id: $0, name: $0.capitalized, language: "OpenAI", isCloud: true) } }
    func setVoice(_ id: String) { voiceName = OpenAITTS.voice(id) }
    func setSpeed(_ speed: Double) { self.speed = speed }
    func setPitch(_ pitch: Double) {}
}

// MARK: - Piper (on this Mac)

@MainActor
final class PiperSpeechProvider: ChunkedAudioSpeechProvider, SpeechProvider {
    let id = "piper"
    let displayName = "Piper voice (on this Mac)"
    let runsLocally = true
    private var speed = 1.0

    func speak(_ text: String) throws {
        if let problem = LocalVoicePaths.piperProblem { throw SpeechError.notReady(problem) }
        let spoken = NotchAIVoiceLogic.spokenText(fromMarkdown: text)
        guard !spoken.isEmpty else { return }
        let binary = LocalVoicePaths.piperBinary, model = LocalVoicePaths.piperModel, speed = speed
        play(chunks: NotchAIVoiceLogic.chunks(spoken, maxCharacters: 300)) { chunk in
            let out = FileManager.default.temporaryDirectory.appendingPathComponent("notchai-piper-\(UUID().uuidString).wav")
            defer { try? FileManager.default.removeItem(at: out) }
            _ = try await LocalProgram.run(binary, PiperLogic.arguments(model: model, output: out.path, speed: speed), input: Data(chunk.utf8), timeout: 60)
            return try Data(contentsOf: out)
        }
    }

    func previewVoice() { try? speak("Hello, this is how I sound.") }
    func listVoices() -> [SpeechVoice] {
        let m = LocalVoicePaths.piperModel
        return m.isEmpty ? [] : [SpeechVoice(id: m, name: PiperLogic.voiceName(m), language: "Piper", isCloud: false)]
    }
    func setVoice(_ id: String) {}        // the voice is the chosen voice file
    func setSpeed(_ speed: Double) { self.speed = speed }
    func setPitch(_ pitch: Double) {}
}

// MARK: - Whisper (speech to text on this Mac)

/// Records the question to a temporary WAV, then runs whisper.cpp on it. Same shape as the app's VoiceInput
/// (isListening, problem, start, stop), so the voice loop treats both the same way. There is no live text: the words
/// arrive once, when the recording stops.
@MainActor
final class WhisperInput: NSObject, ObservableObject {
    static let shared = WhisperInput()
    @Published private(set) var isListening = false
    @Published private(set) var isTranscribing = false
    @Published private(set) var problem: String?

    private var recorder: AVAudioRecorder?
    private var file: URL?
    private var onText: ((String) -> Void)?
    private var onRecordingEnded: (() -> Void)?
    private var limit: DispatchWorkItem?
    private(set) var startedAt = Date()
    private(set) var lastSpeechAt: Date?

    func start(onRecordingEnded: (() -> Void)? = nil, onText: @escaping (String) -> Void) {
        problem = nil
        if let p = LocalVoicePaths.whisperProblem { problem = p; return }
        AVCaptureDevice.requestAccess(for: .audio) { ok in
            Task { @MainActor in
                guard ok else { self.problem = "Allow the microphone for Notch Apple in System Settings → Privacy & Security."; return }
                self.begin(onRecordingEnded: onRecordingEnded, onText: onText)
            }
        }
    }

    private func begin(onRecordingEnded: (() -> Void)?, onText: @escaping (String) -> Void) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("notchai-whisper-\(UUID().uuidString).wav")
        // whisper.cpp wants 16 kHz, mono, 16-bit PCM.
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16_000, AVNumberOfChannelsKey: 1,
                                       AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false]
        do {
            let r = try AVAudioRecorder(url: url, settings: settings)
            r.isMeteringEnabled = true
            guard r.record() else { problem = "Couldn't use the microphone."; return }
            recorder = r; file = url
        } catch { problem = "Couldn't use the microphone: \(error.localizedDescription)"; return }
        self.onText = onText
        self.onRecordingEnded = onRecordingEnded
        startedAt = Date(); lastSpeechAt = nil
        isListening = true
        let work = DispatchWorkItem { [weak self] in self?.stop() }
        limit = work
        DispatchQueue.main.asyncAfter(deadline: .now() + WhisperLogic.maxSeconds, execute: work)
    }

    /// Reads the microphone level; called by the hands-free timer. True when the level counts as speech right now.
    @discardableResult
    func sampleLevel() -> Bool {
        guard let r = recorder, r.isRecording else { return false }
        r.updateMeters()
        let speech = HandsFreeLogic.isSpeech(level: r.averagePower(forChannel: 0))
        if speech { lastSpeechAt = Date() }
        return speech
    }

    /// Ends the recording and transcribes it. `discard` throws the recording away instead.
    func stop(discard: Bool = false) {
        limit?.cancel(); limit = nil
        guard let r = recorder, let url = file else { isListening = false; return }
        r.stop()
        recorder = nil; file = nil
        let deliver = onText
        onText = nil
        onRecordingEnded?(); onRecordingEnded = nil
        if discard {
            try? FileManager.default.removeItem(at: url)
            isListening = false
            return
        }
        isTranscribing = true
        let binary = LocalVoicePaths.whisperBinary, model = LocalVoicePaths.whisperModel
        let language = UserDefaults.standard.string(forKey: "notchai.voice.whisperLanguage") ?? "auto"
        Task {
            defer { try? FileManager.default.removeItem(at: url) }
            do {
                let out = try await LocalProgram.run(binary, WhisperLogic.arguments(model: model, wav: url.path, language: language), timeout: 180)
                deliver?(WhisperLogic.clean(out))
            } catch {
                self.problem = error.localizedDescription
            }
            self.isTranscribing = false
            self.isListening = false          // last, so whoever watches this sees the text already delivered
        }
    }
}
