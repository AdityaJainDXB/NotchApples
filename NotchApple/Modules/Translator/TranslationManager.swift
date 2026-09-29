//
//  TranslationManager.swift
//  Notch apple
//
//  Seven-language translation with a phonetic line for non-Latin scripts.
//
//  Translation comes from the free MyMemory web service (no account or key),
//  so the text you type is sent to it while you translate. That is the only
//  network use of this tab and it is off unless you use the Translator.
//  The phonetic line is generated on your Mac with Core Foundation's
//  string transform (pinyin for Mandarin, Latin letters for Arabic and Hindi).
//

import Foundation
import AVFoundation

enum TranslationLanguage: String, CaseIterable, Identifiable {
    case english, arabic, french, spanish, hindi, mandarin, german

    var id: String { rawValue }

    var name: String {
        switch self {
        case .english: "English"
        case .arabic: "Arabic"
        case .french: "French"
        case .spanish: "Spanish"
        case .hindi: "Hindi"
        case .mandarin: "Mandarin"
        case .german: "German"
        }
    }

    /// Code used by the translation service.
    var serviceCode: String {
        switch self {
        case .english: "en"
        case .arabic: "ar"
        case .french: "fr"
        case .spanish: "es"
        case .hindi: "hi"
        case .mandarin: "zh-CN"
        case .german: "de"
        }
    }

    /// Voice language for text-to-speech.
    var voiceCode: String {
        switch self {
        case .english: "en-US"
        case .arabic: "ar-SA"
        case .french: "fr-FR"
        case .spanish: "es-ES"
        case .hindi: "hi-IN"
        case .mandarin: "zh-CN"
        case .german: "de-DE"
        }
    }

    /// Scripts that need a phonetic (Latin-letter) line.
    var needsTransliteration: Bool { self == .arabic || self == .hindi || self == .mandarin }

    var phoneticTitle: String {
        switch self {
        case .mandarin: "Pinyin"
        case .arabic, .hindi: "Pronunciation (Latin letters)"
        default: "Pronunciation"
        }
    }
}

@MainActor
final class TranslationManager: ObservableObject {
    static let shared = TranslationManager()

    /// The service accepts at most 500 characters per request.
    static let characterLimit = 500

    @Published var source: TranslationLanguage = .english { didSet { if oldValue != source { scheduleTranslation(immediately: true) } } }
    @Published var target: TranslationLanguage = .spanish { didSet { if oldValue != target { scheduleTranslation(immediately: true) } } }
    @Published var input = "" { didSet { if oldValue != input { scheduleTranslation() } } }
    @Published private(set) var output = ""
    @Published private(set) var phonetic = ""
    @Published private(set) var isTranslating = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var isSpeaking = false

    private var pending: Task<Void, Never>?
    private let synthesizer = AVSpeechSynthesizer()
    private var speechDelegate: SpeechDelegate?

    init() {
        let delegate = SpeechDelegate { [weak self] speaking in self?.isSpeaking = speaking }
        speechDelegate = delegate
        synthesizer.delegate = delegate
    }

    // MARK: Translating

    /// Waits for a pause in typing (0.6 s), then translates.
    func scheduleTranslation(immediately: Bool = false) {
        pending?.cancel()
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            output = ""; phonetic = ""; errorMessage = nil; isTranslating = false
            return
        }
        pending = Task { [weak self] in
            if !immediately { try? await Task.sleep(for: .milliseconds(600)) }
            guard !Task.isCancelled, let self else { return }
            await self.translate(text)
        }
    }

    func swapLanguages() {
        let old = output
        pending?.cancel()
        (source, target) = (target, source)
        if !old.isEmpty { input = old }
    }

    private func translate(_ text: String) async {
        guard source != target else {
            output = text; phonetic = Self.transliterate(text, for: target); errorMessage = nil
            return
        }
        isTranslating = true
        defer { isTranslating = false }
        do {
            let result = try await Self.request(String(text.prefix(Self.characterLimit)), from: source, to: target)
            guard !Task.isCancelled else { return }
            output = result
            phonetic = Self.transliterate(result, for: target)
            errorMessage = nil
        } catch is CancellationError {
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
    }

    private struct Response: Decodable {
        struct Data: Decodable { let translatedText: String }
        let responseData: Data
        let responseStatus: FlexibleInt
    }

    /// The service returns the status as a number or a string.
    private struct FlexibleInt: Decodable {
        let value: Int
        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            value = (try? c.decode(Int.self)) ?? Int((try? c.decode(String.self)) ?? "") ?? 0
        }
    }

    private static func request(_ text: String, from: TranslationLanguage, to: TranslationLanguage) async throws -> String {
        var components = URLComponents(string: "https://api.mymemory.translated.net/get")!
        components.queryItems = [URLQueryItem(name: "q", value: text),
                                 URLQueryItem(name: "langpair", value: "\(from.serviceCode)|\(to.serviceCode)")]
        var request = URLRequest(url: components.url!, timeoutInterval: 15)
        request.setValue("NotchApple", forHTTPHeaderField: "User-Agent")
        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(Response.self, from: data)
        guard response.responseStatus.value == 200 else {
            throw NSError(domain: "Translation", code: response.responseStatus.value, userInfo: [
                NSLocalizedDescriptionKey: response.responseStatus.value == 429
                    ? "The free translation limit for today has been reached. Try again later."
                    : "The translation service couldn't translate that."])
        }
        // The service HTML-escapes some characters.
        return response.responseData.translatedText
            .replacingOccurrences(of: "&#39;", with: "'").replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&amp;", with: "&")
    }

    // MARK: Phonetics

    /// Latin-letter reading of `text` for Arabic, Hindi and Mandarin (pinyin with tone marks); empty otherwise.
    static func transliterate(_ text: String, for language: TranslationLanguage) -> String {
        guard language.needsTransliteration else { return "" }
        let mutable = NSMutableString(string: text)
        guard CFStringTransform(mutable, nil, kCFStringTransformToLatin, false) else { return "" }
        let result = mutable as String
        return result == text ? "" : result
    }

    // MARK: Speech

    func speakOutput() {
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate); return }
        guard !output.isEmpty else { return }
        let utterance = AVSpeechUtterance(string: output)
        utterance.voice = AVSpeechSynthesisVoice(language: target.voiceCode)
        synthesizer.speak(utterance)
    }

    /// True when this Mac has a voice for the target language installed.
    var hasVoiceForTarget: Bool { AVSpeechSynthesisVoice(language: target.voiceCode) != nil }

    private final class SpeechDelegate: NSObject, AVSpeechSynthesizerDelegate {
        let onChange: @MainActor (Bool) -> Void
        init(_ onChange: @escaping @MainActor (Bool) -> Void) { self.onChange = onChange }
        func speechSynthesizer(_ s: AVSpeechSynthesizer, didStart u: AVSpeechUtterance) { Task { @MainActor in onChange(true) } }
        func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) { Task { @MainActor in onChange(false) } }
        func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) { Task { @MainActor in onChange(false) } }
    }
}
