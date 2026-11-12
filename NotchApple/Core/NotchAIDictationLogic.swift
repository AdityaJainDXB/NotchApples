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
