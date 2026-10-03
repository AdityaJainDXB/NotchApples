//
//  AIModes.swift
//  Notch apple
//
//  What to do with a capture: each mode is an instruction added to the
//  request. Adding a mode is one case here; nothing else in the AI layer changes.
//
//  InputClassifier reads the text in a capture on this Mac (Apple's Vision
//  framework, nothing is sent anywhere) to suggest likely modes: math → Solve,
//  code or an error → Code, another language → Translate, lots of text →
//  Summarize. Suggestions are hints only and say "looks like", never more.
//

import AppKit
import NaturalLanguage
import Vision

enum AIMode: String, CaseIterable, Identifiable, Codable {
    case solve, explain, simple, answerOnly, hint, summarize, translate, extract, rewrite, code, ask

    var id: String { rawValue }

    var title: String {
        switch self {
        case .solve: "Solve"
        case .explain: "Explain"
        case .simple: "Explain simply"
        case .answerOnly: "Answer only"
        case .hint: "Hint"
        case .summarize: "Summarize"
        case .translate: "Translate"
        case .extract: "Extract text"
        case .rewrite: "Rewrite"
        case .code: "Code"
        case .ask: "Ask"
        }
    }

    var symbol: String {
        switch self {
        case .solve: "function"
        case .explain: "text.magnifyingglass"
        case .simple: "lightbulb"
        case .answerOnly: "checkmark.circle"
        case .hint: "questionmark.bubble"
        case .summarize: "list.bullet.rectangle"
        case .translate: "character.bubble"
        case .extract: "doc.text.viewfinder"
        case .rewrite: "pencil.line"
        case .code: "chevron.left.forwardslash.chevron.right"
        case .ask: "bubble.left.and.text.bubble.right"
        }
    }

    /// Extract runs on this Mac with Vision text recognition when it can.
    var isLocal: Bool { self == .extract }

    static var targetLanguage: String {
        let code = Locale.preferredLanguages.first.map { Locale(identifier: $0).language.languageCode?.identifier ?? "en" } ?? "en"
        return Locale(identifier: "en").localizedString(forLanguageCode: code) ?? "English"
    }

    /// The instruction sent with the input.
    func instruction(extra: String) -> String {
        let note = extra.trimmingCharacters(in: .whitespacesAndNewlines)
        let base: String
        switch self {
        case .solve: base = "Solve this step by step. Number the steps, keep each one short, use LaTeX for math, and finish with a line starting \"Answer:\"."
        case .explain: base = "Explain what this shows, clearly and accurately. Point out anything important."
        case .simple: base = "Explain this simply, for a beginner: plain words, short sentences and one small example."
        case .answerOnly: base = "Give only the final answer, with at most one short sentence of justification."
        case .hint: base = "Give one useful hint for the next step. Don't reveal the full solution or the final answer."
        case .summarize: base = "Summarize this in a few concise bullet points, then one line on what matters most."
        case .translate:
            let target = Self.targetLanguage
            base = "Detect the language and translate this into \(target) (into English if it's already \(target)). Say which language it was, then give the translation."
        case .extract: base = "Extract all the text and data exactly as shown. Keep the layout; use a Markdown table for tables. No commentary."
        case .rewrite: base = "Rewrite this to be clearer and more polished, keeping the meaning and tone. Reply with only the rewritten text."
        case .code: base = "Look at this code or error. Explain what it does or what's wrong, then give a fixed version in a code block."
        case .ask: base = ""
        }
        if note.isEmpty { return base.isEmpty ? "What is this?" : base }
        return base.isEmpty ? note : "\(base)\n\nAlso: \(note)"
    }
}

// MARK: - Local input check

enum InputClassifier {
    struct Result {
        var text: String
        var label: String?          // e.g. "Looks like math"
        var suggested: [AIMode]
    }

    /// Reads the text on this Mac and guesses what the input is. Runs off the main thread.
    static func classify(_ image: CGImage) async -> Result {
        let text = await recognizeText(image, fast: true)
        return classify(text: text)
    }

    static func classify(text: String) -> Result {
        let t = text
        func count(_ pattern: String) -> Int {
            (try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]))?
                .numberOfMatches(in: t, range: NSRange(t.startIndex..., in: t)) ?? 0
        }
        let errors = count(#"\b(error|exception|traceback|failed|fatal|undefined|cannot|warning:|segmentation)\b"#)
        let code = count(#"(\{|\}|;\s*$|=>|::|\bfunc\b|\bdef\b|\bclass\b|\bimport\b|\breturn\b|\bconst\b|\blet\b|\bvar\b|#include|</?\w+>)"#)
        let math = count(#"(\d\s*[\+\-×÷\*/\^=]\s*\d|[=≤≥<>]\s*-?\d|\b[xyz]\s*[\^²³=]|√|∫|∑|π|\bsin\b|\bcos\b|\btan\b|\blog\b|\bsolve\b|\bfind\b|\bderivative\b|\bintegral\b)"#)
        let tokens = t.split { $0.isWhitespace }
        let words = tokens.count
        let numeric = tokens.filter { $0.contains(where: \.isNumber) && $0.allSatisfy { $0.isNumber || ".,%$€£-:/".contains($0) } }.count

        // Another language?
        var foreign = false
        if words >= 4 {
            let r = NLLanguageRecognizer()
            r.processString(t)
            if let lang = r.dominantLanguage, let conf = r.languageHypotheses(withMaximum: 1)[lang], conf > 0.8 {
                let mine = Locale.preferredLanguages.compactMap { Locale(identifier: $0).language.languageCode?.identifier }
                foreign = !mine.contains(lang.rawValue)
            }
        }

        if errors >= 1 && (code >= 1 || errors >= 2) {
            return Result(text: t, label: "Looks like an error message", suggested: [.code, .explain, .simple])
        }
        if code >= 4 { return Result(text: t, label: "Looks like code", suggested: [.code, .explain, .extract]) }
        // Charts and tables: mostly short numeric labels (axes, values), few sentences.
        if words >= 8, Double(numeric) / Double(words) > 0.45, math < 4 {
            return Result(text: t, label: "Looks like a chart or table", suggested: [.explain, .summarize, .extract])
        }
        if math >= 2 && words < 120 { return Result(text: t, label: "Looks like math", suggested: [.solve, .hint, .simple, .answerOnly]) }
        if foreign { return Result(text: t, label: "Looks like another language", suggested: [.translate, .explain, .extract]) }
        if words >= 60 { return Result(text: t, label: "Lots of text", suggested: [.summarize, .rewrite, .translate, .extract]) }
        if words == 0 { return Result(text: t, label: nil, suggested: [.explain, .ask]) }
        return Result(text: t, label: nil, suggested: [.explain, .summarize, .extract])
    }

    /// Apple's on-device text recognition. `fast` is used for suggestions, accurate for Extract.
    static func recognizeText(_ image: CGImage, fast: Bool) async -> String {
        await Task.detached(priority: .userInitiated) {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = fast ? .fast : .accurate
            request.usesLanguageCorrection = !fast
            request.automaticallyDetectsLanguage = true
            try? VNImageRequestHandler(cgImage: image).perform([request])
            let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
            return lines.joined(separator: "\n")
        }.value
    }
}
