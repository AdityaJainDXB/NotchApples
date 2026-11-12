//
//  NotchAIVoiceLogic.swift
//  Notch Apple
//
//  The pure rules of NotchAI's voice loop (speech in, AI, speech out), kept free of audio frameworks so they are
//  unit tested: the conversation state machine, how a reply is cleaned and cut into short spoken chunks (so speech
//  starts quickly and can be stopped between them), the speed-to-rate mapping, and the WAV wrapper for raw PCM audio
//  from a cloud voice.
//

import Foundation

/// IDLE, LISTENING, TRANSCRIBING, THINKING, EXECUTING, SPEAKING, INTERRUPTED, ERROR.
enum NotchAIVoiceState: String, CaseIterable {
    case idle, listening, transcribing, thinking, executing, speaking, interrupted, error

    var title: String { rawValue.uppercased() }
}

enum NotchAIVoiceEvent: Equatable {
    case startListening          // push-to-talk pressed
    case heardWords              // the recogniser has partial text
    case speechEnded             // listening stopped with text
    case cancelled               // user cancelled, or nothing was heard
    case aiStarted               // the question went to the model
    case toolsRunning            // an agent is doing something (later milestones)
    case aiReplied(speak: Bool)  // the answer arrived; speak it or not
    case speakingStarted
    case speakingFinished
    case interrupt               // the user spoke or pressed stop while NotchAI was speaking
    case failed
    case reset
}

enum NotchAIVoiceLogic {
    // MARK: State machine

    static func next(_ s: NotchAIVoiceState, _ e: NotchAIVoiceEvent) -> NotchAIVoiceState {
        switch (s, e) {
        case (_, .reset): return .idle
        case (_, .failed): return .error
        // Starting to talk always wins: it interrupts speech, a running request's display, or an error.
        case (.speaking, .startListening): return .interrupted
        case (_, .startListening): return .listening
        // An interrupted state is a listening state: the speech was cut off and the mic is already open.
        case (.interrupted, .heardWords), (.listening, .heardWords): return .transcribing
        case (.interrupted, .speechEnded), (.listening, .speechEnded), (.transcribing, .speechEnded): return .thinking
        case (.listening, .cancelled), (.transcribing, .cancelled), (.interrupted, .cancelled): return .idle
        case (.thinking, .toolsRunning): return .executing
        case (.thinking, .aiStarted), (.executing, .aiStarted): return s
        case (.thinking, .aiReplied(let speak)), (.executing, .aiReplied(let speak)): return speak ? .speaking : .idle
        case (.speaking, .speakingFinished), (.speaking, .cancelled): return .idle
        case (.speaking, .interrupt): return .interrupted
        case (.interrupted, .speakingFinished): return .interrupted
        case (.idle, .speakingStarted), (.thinking, .speakingStarted): return .speaking
        default: return s
        }
    }

    /// How the green dot looks in each state.
    enum DotLook: Equatable { case idle, listening, thinking, speaking }

    static func dotLook(_ s: NotchAIVoiceState) -> DotLook {
        switch s {
        case .idle, .error, .interrupted: return .idle
        case .listening: return .listening
        case .transcribing, .thinking, .executing: return .thinking
        case .speaking: return .speaking
        }
    }

    /// States where microphone audio is being captured, for the visible listening indicator.
    static func isCapturingAudio(_ s: NotchAIVoiceState) -> Bool { s == .listening || s == .transcribing }

    // MARK: Text to speak

    /// The words to read aloud: no Markdown marks, code blocks replaced by a short phrase, links shortened.
    static func spokenText(fromMarkdown md: String) -> String {
        var t = md
        t = t.replacingOccurrences(of: "```[\\s\\S]*?```", with: " (code omitted) ", options: .regularExpression)
        t = t.replacingOccurrences(of: "`([^`]*)`", with: "$1", options: .regularExpression)
        t = t.replacingOccurrences(of: "!?\\[([^\\]]*)\\]\\([^)]*\\)", with: "$1", options: .regularExpression)
        t = t.replacingOccurrences(of: "https?://\\S+", with: "a link", options: .regularExpression)
        t = t.replacingOccurrences(of: "(?m)^\\s{0,3}(#{1,6}|[-*+>]|\\d+\\.)\\s+", with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: "[*_~|]+", with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: "[ \\t]+", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "\\n{2,}", with: "\n", options: .regularExpression)
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Cuts text into sentence-sized chunks of at most `maxCharacters` (a long sentence is cut at a comma or space),
    /// so the first chunk can start speaking while the rest wait, and Stop takes effect between chunks.
    static func chunks(_ text: String, maxCharacters: Int = 220) -> [String] {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return [] }
        var sentences: [String] = []
        var current = ""
        for ch in clean {
            current.append(ch)
            if ".!?…\n".contains(ch) {
                sentences.append(current.trimmingCharacters(in: .whitespacesAndNewlines))
                current = ""
            }
        }
        if !current.trimmingCharacters(in: .whitespaces).isEmpty { sentences.append(current.trimmingCharacters(in: .whitespacesAndNewlines)) }
        var out: [String] = []
        var buffer = ""
        func flush() { if !buffer.isEmpty { out.append(buffer); buffer = "" } }
        for s in sentences where !s.isEmpty {
            if s.count > maxCharacters {
                flush()
                out.append(contentsOf: split(long: s, maxCharacters: maxCharacters))
            } else if buffer.isEmpty {
                buffer = s
            } else if buffer.count + 1 + s.count <= maxCharacters {
                buffer += " " + s
            } else {
                flush(); buffer = s
            }
        }
        flush()
        return out
    }

    private static func split(long s: String, maxCharacters: Int) -> [String] {
        var parts: [String] = []
        var rest = Substring(s)
        while rest.count > maxCharacters {
            let window = rest.prefix(maxCharacters)
            let cut = window.lastIndex(of: ",") ?? window.lastIndex(of: " ") ?? window.index(before: window.endIndex)
            let piece = rest[...cut].trimmingCharacters(in: .whitespaces)
            if !piece.isEmpty { parts.append(piece) }
            rest = rest[rest.index(after: cut)...]
        }
        let tail = rest.trimmingCharacters(in: .whitespaces)
        if !tail.isEmpty { parts.append(tail) }
        return parts
    }

    // MARK: Speed

    /// Maps a friendly speed (0.5x ... 2x, 1 = normal) onto AVSpeechUtterance's rate (0 ... 1, normal 0.5).
    static func utteranceRate(speed: Double) -> Float {
        let s = min(max(speed, 0.5), 2.0)
        return Float(s <= 1 ? 0.5 * s : 0.5 + (s - 1) * 0.25)
    }

    // MARK: Cloud audio

    /// Wraps raw little-endian PCM (what Gemini TTS returns: 24 kHz, 16-bit, mono) in a WAV header so it can be played.
    static func wav(pcm: Data, sampleRate: Int = 24_000, channels: Int = 1, bitsPerSample: Int = 16) -> Data {
        func le32(_ v: Int) -> [UInt8] { (0..<4).map { UInt8((v >> (8 * $0)) & 0xFF) } }
        func le16(_ v: Int) -> [UInt8] { (0..<2).map { UInt8((v >> (8 * $0)) & 0xFF) } }
        let byteRate = sampleRate * channels * bitsPerSample / 8
        var h = [UInt8]()
        h += Array("RIFF".utf8); h += le32(36 + pcm.count); h += Array("WAVE".utf8)
        h += Array("fmt ".utf8); h += le32(16); h += le16(1); h += le16(channels)
        h += le32(sampleRate); h += le32(byteRate); h += le16(channels * bitsPerSample / 8); h += le16(bitsPerSample)
        h += Array("data".utf8); h += le32(pcm.count)
        return Data(h) + pcm
    }
}
