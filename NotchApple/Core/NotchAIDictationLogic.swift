//
//  NotchAIDictationLogic.swift
//  Notch Apple
//
//  Pure rules for dictation and for when NotchAI may make noise:
//   • Turning what was heard into text: spoken punctuation and line commands ("comma", "question mark", "new line"),
//     the user's own vocabulary corrections, filler words dropped, tidy spacing, sentence capitals.
//   • Quiet mode: no chimes or spoken announcements while the user is on a call (a conferencing app is in front) or has
//     switched quiet mode on. macOS Focus is honoured separately by the notification system itself.
//  Unit tested.
//

import Foundation

enum NotchAIDictationLogic {
    private static let spoken: [(phrase: String, text: String)] = [
        ("new paragraph", "\n\n"), ("new line", "\n"), ("question mark", "?"), ("exclamation mark", "!"), ("exclamation point", "!"),
        ("full stop", "."), ("period", "."), ("comma", ","), ("semicolon", ";"), ("colon", ":"),
    ]
    private static let fillers = ["um", "uh", "erm", "uhm", "hmm"]

    /// `vocabulary` maps what the recogniser tends to hear to what the user means ("note ch ai" -> "NotchAI").
    static func clean(_ transcript: String, vocabulary: [String: String] = [:]) -> String {
        var t = " " + transcript.trimmingCharacters(in: .whitespacesAndNewlines) + " "
        for (heard, meant) in vocabulary where !heard.trimmingCharacters(in: .whitespaces).isEmpty {
            t = t.replacingOccurrences(of: "(?i)(?<![A-Za-z0-9])\(NSRegularExpression.escapedPattern(for: heard))(?![A-Za-z0-9])",
                                       with: NSRegularExpression.escapedTemplate(for: meant), options: .regularExpression)
        }
        for f in fillers {
            t = t.replacingOccurrences(of: "(?i)(?<![A-Za-z0-9])\(f)(?![A-Za-z0-9])[,.]?", with: " ", options: .regularExpression)
        }
        for (phrase, text) in spoken {
            t = t.replacingOccurrences(of: "(?i)(?<![A-Za-z0-9])\(phrase)(?![A-Za-z0-9])", with: NSRegularExpression.escapedTemplate(for: text), options: .regularExpression)
        }
        // Spacing: none before punctuation, one after; trim around line breaks.
        t = t.replacingOccurrences(of: "[ \\t]+([.,!?;:])", with: "$1", options: .regularExpression)
        t = t.replacingOccurrences(of: "([.,!?;:])(?=[A-Za-z0-9])", with: "$1 ", options: .regularExpression)
        t = t.replacingOccurrences(of: "[ \\t]*\\n[ \\t]*", with: "\n", options: .regularExpression)
        t = t.replacingOccurrences(of: "[ \\t]{2,}", with: " ", options: .regularExpression)
        t = t.trimmingCharacters(in: .whitespacesAndNewlines)
        return capitalised(t)
    }

    /// Capital letter at the start and after . ? ! and line breaks.
    static func capitalised(_ s: String) -> String {
        var out = "", up = true
        for ch in s {
            if up, ch.isLetter { out.append(contentsOf: String(ch).uppercased()); up = false }
            else { out.append(ch); if ".?!\n".contains(ch) { up = true } else if !ch.isWhitespace && !"\"'(".contains(ch) { up = false } }
        }
        return out
    }

    static func isCancelCommand(_ transcript: String) -> Bool {
        let t = transcript.lowercased().trimmingCharacters(in: CharacterSet.alphanumerics.inverted.union(.whitespaces))
        return ["cancel that", "cancel dictation", "never mind", "scratch that"].contains(t)
    }
}

enum NotchAIQuietLogic {
    /// Apps that mean "the user is probably on a call". Screen recorders and players are deliberately not here.
    static let callApps: Set<String> = ["us.zoom.xos", "com.microsoft.teams", "com.microsoft.teams2", "com.apple.facetime", "com.cisco.webexmeetingsapp",
                                        "com.cisco.webex.meetings", "com.google.meet", "com.skype.skype", "com.tinyspeck.slackmacgap.huddles"]

    static func isQuiet(manual: Bool, frontmostBundleID: String?) -> Bool {
        if manual { return true }
        guard let id = frontmostBundleID?.lowercased() else { return false }
        return callApps.contains(id)
    }

    static func shouldChime(enabled: Bool, quiet: Bool) -> Bool { enabled && !quiet }
    static func shouldSpeakUpdate(enabled: Bool, quiet: Bool) -> Bool { enabled && !quiet }
    /// A banner is still shown in quiet mode (the system's Focus decides whether it is delivered); only sounds are held back.
    static func shouldNotify(enabled: Bool) -> Bool { enabled }

    /// What to tell the user about a task that changed state, or nil if it is not worth a notice.
    static func announcement(title: String, state: TaskState) -> String? {
        switch state {
        case .completed: "Finished: \(title)"
        case .failed: "Something went wrong: \(title)"
        case .waitingApproval: "Needs your approval: \(title)"
        default: nil
        }
    }
}

// MARK: - Screen-aware drafting

/// Dictation that knows what you are looking at: you say what you want written ("reply that Thursday works"), NotchAI
/// reads the window you were using (only when you press the button), and the model writes the text. The draft goes
/// into the same editable box as ordinary dictation; nothing is typed until you press Insert.
enum ScreenDraftLogic {
    static let maxScreenCharacters = 6_000
    static let system = "You write the exact text a person wants to type into the app in front of them. Reply with that text only."

    static func prompt(instruction: String, appName: String, windowTitle: String?, screenText: String) -> String {
        let cut = screenText.count > maxScreenCharacters
        return """
        I am typing in \(appName)\(windowTitle.map { " (window: \($0))" } ?? "").
        What is on my screen right now\(cut ? " (cut short)" : ""):
        ---
        \(String(screenText.prefix(maxScreenCharacters)))
        ---
        Write this for me: \(instruction)

        Reply with ONLY the text to insert: no greeting to me, no explanation, no quotation marks around it. Match the language and tone of what is on screen. Do not invent facts that are not on screen or in my request.
        """
    }

    /// The text to put in the box: code fences, wrapping quotes and a leading "Here is…:" line are removed.
    static func clean(_ reply: String) -> String {
        var t = reply.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.hasPrefix("```"), let end = t.range(of: "```", options: .backwards), end.lowerBound > t.startIndex {
            var inner = String(t[t.index(t.startIndex, offsetBy: 3)..<end.lowerBound])
            if let nl = inner.firstIndex(of: "\n"), !inner[..<nl].contains(" ") { inner = String(inner[inner.index(after: nl)...]) }   // the language tag
            t = inner.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let lines = t.components(separatedBy: "\n")
        if lines.count > 1, let first = lines.first, first.hasSuffix(":"), first.count < 80,
           first.lowercased().range(of: "^(here|sure|okay|ok|certainly)\\b", options: .regularExpression) != nil {
            t = lines.dropFirst().joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        }
        for (open, close) in [("\"", "\""), ("“", "”"), ("'", "'")] where t.count >= 2 && t.hasPrefix(open) && t.hasSuffix(close) {
            let inner = String(t.dropFirst().dropLast())
            if !inner.contains(open) && !inner.contains(close) { t = inner }
        }
        return t
    }

    /// Why a draft cannot start, or nil.
    static func problem(instruction: String, proAllowed: Bool, screenOn: Bool) -> String? {
        if instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Say or type what you want written first (for example: reply that Thursday works)." }
        if !proAllowed { return "Drafting from the screen is part of Pro." }
        if !screenOn { return "Turn on Screen awareness in the Screen section first." }
        return nil
    }
}
