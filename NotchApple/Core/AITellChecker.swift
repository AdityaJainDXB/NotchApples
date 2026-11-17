//
//  AITellChecker.swift
//  Notch Apple
//
//  Finds the habits that make writing read like a chatbot (the patterns on Wikipedia's "Signs of AI writing" guide, in the Humanizer
//  skill's checklist) and fixes the safe ones. It runs entirely on this Mac, with no model and no network. It is a rough guide to
//  writing habits, not a detector like ZeroGPT's: plenty of people write this way, and a clean score proves nothing. Used by the
//  Humanizer (to check and tidy its own rewrite) and by Tools → AI Detector. The same rules are in
//  NotchWindows/src/js/services/aitells.js.
//

import Foundation

enum AITellChecker {
    struct Rule { let label: String; let pattern: String; let weight: Double }

    /// Each rule counts every match. Weights say how strong a tell it is.
    static let rules: [Rule] = [
        Rule(label: "AI vocabulary", pattern: #"\b(delves?|delved|delving|tapestry|testament|underscor(?:e|es|ed|ing)|pivotal|intricate|multifaceted|seamless(?:ly)?|garner(?:s|ed|ing)?|embark(?:s|ed|ing)?|elevat(?:e|es|ed|ing)|fosters?|fostered|fostering)\b"#, weight: 2),
        Rule(label: "Promotional words", pattern: #"\b(nestled|renowned|showcas(?:e|es|ed|ing)|vibrant|breathtaking|rich heritage|rich tapestry|world-class|state-of-the-art)\b"#, weight: 2),
        Rule(label: "Puffed-up importance", pattern: #"\b(plays? an? (?:vital|pivotal|crucial|key|significant) role|stands? as a|serves? as a|a testament to|leaves? a lasting|lasting legacy|in the realm of|navigat(?:e|es|ing) the (?:complexities|landscape))\b"#, weight: 3),
        Rule(label: "Trailing analysis", pattern: #",\s*(?:highlighting|underscoring|showcasing|emphasizing|reflecting|demonstrating) (?:the|its|their|how)\b|valuable insights?"#, weight: 2),
        Rule(label: "Negative parallelism", pattern: #"\bnot only\b[^.!?]{3,80}\bbut also\b|\b(?:it'?s|it is|this is|that'?s|that is) not (?:just|only|merely) [^.!?]{2,60}[,;—-] ?(?:it'?s|but)"#, weight: 3),
        Rule(label: "Stock transitions", pattern: #"(?:^|[.!?]\s+)(?:Additionally|Moreover|Furthermore|In conclusion|In summary|Overall|Ultimately|Notably),"#, weight: 1.5),
        Rule(label: "Vague authorities", pattern: #"\b(?:experts (?:argue|say|believe)|studies (?:show|suggest|indicate)|many (?:believe|argue)|some critics|researchers say)\b"#, weight: 2),
        Rule(label: "Formulaic ending", pattern: #"\b(?:the future (?:is|looks) bright|looking ahead|despite (?:its|these) (?:success|challenges)|faces several challenges)\b"#, weight: 2),
        Rule(label: "Chatbot leftovers", pattern: #"\b(?:certainly!|great question|i hope this helps|let me know if you'?d like|feel free to|as of my last (?:update|knowledge)|based on (?:the )?available information)"#, weight: 4),
        Rule(label: "Left-in placeholders", pattern: #"\[(?:Name|Date|Company|Your [A-Za-z ]+)\]|\bXX+\b"#, weight: 4),
        Rule(label: "Bold label bullets", pattern: #"(?m)^\s*(?:[-*•]|\d+\.)\s+\*\*[^*\n]+\*\*\s*:"#, weight: 2),
        Rule(label: "Markdown bold", pattern: #"\*\*[^*\n]+\*\*"#, weight: 1),
        Rule(label: "Curly quotes", pattern: #"[“”‘’]"#, weight: 0.5),
    ]

    struct Tell: Equatable { let label: String; let count: Int }

    struct Report: Equatable {
        var words: Int
        var tells: [Tell]
        var total: Int
        /// 0 to 100: how strongly the writing shows these habits. A rough guide, not proof of anything.
        var score: Int
        /// Sentences all about the same length (a rhythm tell).
        var uniformRhythm: Bool
    }

    private static func matches(_ pattern: String, in text: String, options: NSRegularExpression.Options = [.caseInsensitive]) -> Int {
        guard let re = try? NSRegularExpression(pattern: pattern, options: options) else { return 0 }
        return re.numberOfMatches(in: text, range: NSRange(text.startIndex..., in: text))
    }

    static func sentenceLengths(_ text: String) -> [Int] {
        text.components(separatedBy: CharacterSet(charactersIn: ".!?\n")).map { HumanizerLogic.wordCount($0) }.filter { $0 > 0 }
    }

    static func isUniform(_ lengths: [Int]) -> Bool {
        guard lengths.count >= 5 else { return false }
        let mean = Double(lengths.reduce(0, +)) / Double(lengths.count)
        guard mean > 0 else { return false }
        let variance = lengths.map { pow(Double($0) - mean, 2) }.reduce(0, +) / Double(lengths.count)
        return variance.squareRoot() / mean < 0.3
    }

    static func report(_ text: String) -> Report {
        let words = HumanizerLogic.wordCount(text)
        var tells: [Tell] = []
        var weighted = 0.0
        for r in rules {
            let n = matches(r.pattern, in: text)
            if n > 0 { tells.append(Tell(label: r.label, count: n)); weighted += Double(n) * r.weight }
        }
        // Em dashes: one is fine, each after the first is a tell. Emoji in running text.
        let dashes = text.filter { $0 == "—" }.count
        if dashes > 1 { tells.append(Tell(label: "Em dashes", count: dashes - 1)); weighted += Double(dashes - 1) * 1.5 }
        let emoji = text.unicodeScalars.filter { $0.properties.isEmojiPresentation }.count
        if emoji > 0 { tells.append(Tell(label: "Emoji", count: emoji)); weighted += Double(emoji) }
        let uniform = isUniform(sentenceLengths(text))
        let per100 = words > 0 ? weighted / Double(words) * 100 : 0
        let score = words == 0 ? 0 : min(100, Int((per100 * 10).rounded()) + (uniform ? 12 : 0))
        return Report(words: words, tells: tells.sorted { $0.count > $1.count }, total: tells.map(\.count).reduce(0, +), score: score, uniformRhythm: uniform)
    }

    /// Plain-language label for a score.
    static func verdict(_ score: Int) -> String {
        switch score {
        case ..<15: "Reads like a person"
        case ..<40: "A few AI habits"
        case ..<70: "Reads like a chatbot in places"
        default: "Reads like a chatbot"
        }
    }

    // MARK: Safe fixes

    /// Fixes that cannot change the meaning: stock phrases, dashes, quotes and Markdown symbols. Everything else is left to a rewrite.
    static func autoFix(_ text: String) -> String {
        var t = text
        func sub(_ pattern: String, _ with: String, _ opts: NSRegularExpression.Options = [.caseInsensitive]) {
            guard let re = try? NSRegularExpression(pattern: pattern, options: opts) else { return }
            t = re.stringByReplacingMatches(in: t, range: NSRange(t.startIndex..., in: t), withTemplate: with)
        }
        for (a, b) in [("“", "\""), ("”", "\""), ("‘", "'"), ("’", "'")] { t = t.replacingOccurrences(of: a, with: b) }
        sub(#"\*\*([^*\n]+)\*\*"#, "$1")                                              // **bold** → bold
        sub(#"(?m)^\s*(Certainly|Sure|Absolutely|Of course)[!.,]\s*"#, "")            // opening pleasantries
        sub(#"(?m)^\s*(Great question[!.]?|I hope this helps[!.]?|Let me know if you'?d like[^.\n]*[.!]?|Feel free to [^.\n]*[.!]?)\s*$"#, "")
        sub(#"\s*\b(?:Certainly!|Great question[!.]?|I hope this helps[!.]?)"#, "")                  // the same, in the middle of a paragraph
        sub(#"\b(serves?|stands?) as (an?|the)\b"#, "is $2")                           // "serves as a" → "is a"
        sub(#"\bboasts\b"#, "has")
        // Stock transitions at the start of a sentence are dropped, and the next word keeps its capital.
        if let re = try? NSRegularExpression(pattern: #"(^|[.!?]\s+)(Additionally|Moreover|Furthermore),\s+([a-z])"#) {
            while let m = re.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)),
                  let r0 = Range(m.range, in: t), let r1 = Range(m.range(at: 1), in: t), let r3 = Range(m.range(at: 3), in: t) {
                t.replaceSubrange(r0, with: String(t[r1]) + t[r3].uppercased())
            }
        }
        // Em dashes: keep the first, turn later ones into commas.
        if let first = t.firstIndex(of: "—") {
            let head = t[...first], tail = t[t.index(after: first)...]
            var tailFixed = String(tail)
            if let re = try? NSRegularExpression(pattern: #"\s*—\s*"#) {
                tailFixed = re.stringByReplacingMatches(in: tailFixed, range: NSRange(tailFixed.startIndex..., in: tailFixed), withTemplate: ", ")
            }
            t = String(head) + tailFixed
        }
        sub(#"[ \t]{2,}"#, " ", [])
        sub(#"\n{3,}"#, "\n\n", [])
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The tells still in a text, as one line for a second editing pass ("delve, tapestry, an em dash…"). Empty when there is nothing to fix.
    static func remainingHint(_ text: String) -> String {
        let r = report(text)
        return r.tells.filter { $0.label != "Curly quotes" }.map { "\($0.label) (\($0.count))" }.joined(separator: ", ")
    }
}
