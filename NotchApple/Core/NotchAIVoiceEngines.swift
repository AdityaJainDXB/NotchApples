//
//  NotchAIVoiceEngines.swift
//  Notch Apple
//
//  The pure rules behind NotchAI's extra voice engines and its hands-free modes. No audio, no network and no process
//  is touched here, so all of it is unit tested:
//   • OpenAI TTS: the request body (cloud voice; the provider itself refuses to run while Local first is on).
//   • Piper: a local neural voice the user installs. The command line, where to look for it, and what is missing.
//   • Whisper (whisper.cpp): local speech to text the user installs. The command line and cleaning its output.
//   • Hands-free: when a sentence is over (a pause after speech), and when to give up (nobody spoke).
//   • Wake word: whether a transcript contains the wake phrase. Off by default; recognition is on this Mac only.
//

import Foundation

// MARK: - OpenAI TTS

enum OpenAITTS {
    static let defaultModel = "gpt-4o-mini-tts"
    static let voices = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"]
    static let endpoint = "https://api.openai.com/v1/audio/speech"

    /// The service accepts 0.25 to 4; NotchAI's own slider is 0.5 to 2.
    static func speed(_ s: Double) -> Double { min(max(s, 0.5), 2.0) }

    static func voice(_ id: String) -> String { voices.contains(id) ? id : "alloy" }

    static func body(text: String, voice: String, model: String, speed: Double) -> [String: Any] {
        ["model": model.isEmpty ? defaultModel : model, "input": text, "voice": Self.voice(voice),
         "response_format": "wav", "speed": Self.speed(speed)]
    }
}

// MARK: - Local command-line engines (Piper, Whisper)

enum LocalEngineLogic {
    /// Places a command-line tool is usually installed, most likely first.
    static func candidates(_ names: [String], home: String) -> [String] {
        let dirs = ["/opt/homebrew/bin", "/usr/local/bin", "\(home)/.local/bin", "\(home)/bin", "/usr/bin"]
        return dirs.flatMap { d in names.map { "\(d)/\($0)" } }
    }

    /// The first candidate that exists and can be run, if any.
    static func find(_ names: [String], home: String, isExecutable: (String) -> Bool) -> String? {
        candidates(names, home: home).first(where: isExecutable)
    }

    /// A path typed by the user: trimmed, "~" expanded, quotes removed. Never a shell string: it is passed as one argument.
    static func path(_ raw: String, home: String) -> String {
        var p = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if p.count >= 2, let f = p.first, let l = p.last, f == l, f == "\"" || f == "'" { p = String(p.dropFirst().dropLast()) }
        if p == "~" { return home }
        if p.hasPrefix("~/") { p = home + String(p.dropFirst(1)) }
        return p
    }

    /// What is missing before the engine can run, in words for the user. nil when it is ready.
    static func problem(engine: String, binary: String, model: String, modelKind: String, installHint: String,
                        isExecutable: (String) -> Bool, exists: (String) -> Bool) -> String? {
        if binary.isEmpty { return "\(engine) is not installed, or NotchAI could not find it. \(installHint)" }
        if !isExecutable(binary) { return "\(engine) was not found at \(binary). \(installHint)" }
        if model.isEmpty { return "Choose a \(modelKind) for \(engine)." }
        if !exists(model) { return "The \(modelKind) was not found at \(model)." }
        return nil
    }
}

enum PiperLogic {
    static let binaryNames = ["piper", "piper-tts"]
    static let installHint = "Install Piper (for example: pip install piper-tts) and download a voice (.onnx), then set both paths here."

    /// Piper reads the text on standard input and writes one WAV file. `speed` 1 is normal; Piper's length scale is its inverse.
    static func arguments(model: String, output: String, speed: Double) -> [String] {
        let s = min(max(speed, 0.5), 2.0)
        return ["--model", model, "--output_file", output, "--length_scale", String(format: "%.2f", 1 / s)]
    }

    /// A voice file's name without its folder or ending, for the voice list.
    static func voiceName(_ modelPath: String) -> String {
        let file = modelPath.split(separator: "/").last.map(String.init) ?? modelPath
        return file.hasSuffix(".onnx") ? String(file.dropLast(5)) : file
    }
}

enum WhisperLogic {
    static let binaryNames = ["whisper-cli", "whisper-cpp", "whisper"]
    static let installHint = "Install whisper.cpp (for example: brew install whisper-cpp) and download a model (ggml-base.bin), then set both paths here."
    /// The longest recording sent to Whisper, so a forgotten microphone cannot fill the disk.
    static let maxSeconds: TimeInterval = 120

    /// whisper.cpp: no timestamps, no progress prints, text only. `language` is a code such as "en", or "auto".
    static func arguments(model: String, wav: String, language: String) -> [String] {
        let lang = language.trimmingCharacters(in: .whitespaces).lowercased()
        let ok = lang.range(of: "^[a-z]{2,3}$", options: .regularExpression) != nil
        return ["-m", model, "-f", wav, "-l", ok ? lang : "auto", "-nt", "-np"]
    }

    /// The words Whisper heard: timestamps, "[BLANK_AUDIO]", "(music)" and similar notes removed, lines joined.
    static func clean(_ output: String) -> String {
        var t = output
        t = t.replacingOccurrences(of: "\\[\\d{2}:\\d{2}[:.]\\d{2}[.,]?\\d*\\s*-->\\s*\\d{2}:\\d{2}[:.]\\d{2}[.,]?\\d*\\]", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "\\[[^\\]\\n]{0,40}\\]", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "\\([^)\\n]{0,40}\\)", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - Hands-free

enum HandsFreeDecision: Equatable {
    case keepListening
    /// The speaker paused after saying something: the sentence is over.
    case finish
    /// Nobody said anything: close the microphone and send nothing.
    case giveUp
}

enum HandsFreeLogic {
    /// A pause this long after speech ends the sentence.
    static let pause: TimeInterval = 1.6
    /// With no speech at all, the microphone closes after this long.
    static let patience: TimeInterval = 8
    /// One spoken turn is never longer than this.
    static let longest: TimeInterval = 60
    /// Microphone level (dBFS) above which sound counts as speech, for engines that give no live text.
    static let speechLevel: Float = -38

    /// `sinceActivity`: seconds since the heard text last changed (or since the level was last above `speechLevel`).
    static func decide(heardSomething: Bool, sinceActivity: TimeInterval, sinceStart: TimeInterval) -> HandsFreeDecision {
        if sinceStart >= longest { return heardSomething ? .finish : .giveUp }
        if heardSomething { return sinceActivity >= pause ? .finish : .keepListening }
        return sinceStart >= patience ? .giveUp : .keepListening
    }

    static func isSpeech(level: Float) -> Bool { level > speechLevel }
}

// MARK: - Wake word

enum WakeWordLogic {
    static let defaultPhrase = "hey notch"
    /// The recogniser is restarted this often so its transcript stays short and old audio is dropped.
    static let restartEvery: TimeInterval = 40

    /// Lower case, letters and digits only, single spaces.
    static func normalise(_ s: String) -> String {
        let folded = s.lowercased().folding(options: .diacriticInsensitive, locale: nil)
        let mapped = folded.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? Character($0) : " " }
        return String(mapped).split(separator: " ").joined(separator: " ")
    }

    /// Why a phrase cannot be used, or nil. Two to four words, so everyday speech does not trigger it by accident.
    static func problem(phrase: String) -> String? {
        let words = normalise(phrase).split(separator: " ")
        if words.count < 2 { return "Use at least two words, for example \"hey notch\", so ordinary speech does not wake NotchAI." }
        if words.count > 4 { return "Use at most four words." }
        if words.joined().count < 6 { return "That phrase is too short to tell apart from ordinary speech." }
        return nil
    }

    /// Spellings the recogniser commonly produces for the same sounds (only for the default phrase's words).
    private static let alike: [String: Set<String>] = ["hey": ["hey", "hay"], "notch": ["notch", "nosh", "notched", "knotch"]]

    private static func same(_ heard: Substring, _ wanted: Substring) -> Bool {
        heard == wanted || (alike[String(wanted)]?.contains(String(heard)) ?? false)
    }

    /// If the transcript contains the wake phrase, the words said after it (possibly empty); otherwise nil.
    /// Only the LAST occurrence counts, so words before it are never treated as a request.
    static func match(transcript: String, phrase: String) -> String? {
        let want = normalise(phrase).split(separator: " ")
        let heard = normalise(transcript).split(separator: " ")
        guard !want.isEmpty, heard.count >= want.count else { return nil }
        var start = heard.count - want.count
        while start >= 0 {
            if zip(heard[start..<(start + want.count)], want).allSatisfy({ same($0, $1) }) {
                return heard[(start + want.count)...].joined(separator: " ")
            }
            start -= 1
        }
        return nil
    }
}
