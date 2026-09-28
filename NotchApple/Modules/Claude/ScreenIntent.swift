//
//  ScreenIntent.swift
//  Notch apple
//
//  Decides whether a question to the AI is about what's on the screen
//  ("what's on my screen?", "explain this error", "summarise this page"),
//  so a screenshot can be attached automatically.
//

import Foundation

enum ScreenIntent {
    /// Phrases that clearly refer to the screen or the thing being looked at.
    private static let patterns: [String] = [
        #"\b(on|in|at) (my|the) (screen|display|monitor)\b"#,
        #"\bmy (screen|display|monitor|desktop)\b"#,
        #"\bwhat('?s| is| am i)( i'?m)? (looking at|seeing|reading|watching)\b"#,
        #"\bwhat (do|can) you see\b"#,
        #"\b(look|see|glance) at (this|my|the) \w+"#,
        #"\b(read|check|explain|describe|summari[sz]e|translate|fix|debug|solve|answer) (this|that|the) (screen|page|window|tab|app|error|message|code|image|picture|photo|chart|graph|question|problem|email|doc(ument)?|article|site|website|form|table|diagram|slide|video)\b"#,
        #"\bwhat('?s| is| does) (this|that) (screen|page|window|app|error|message|code|image|chart|graph|diagram|button|icon|popup|dialog)\b"#,
        #"\bwhat'?s (this|that|here|going on here)\??$"#,
        #"\b(take a |take |grab a )?screenshot\b"#,
        #"\bscreen ?shot\b"#,
    ]

    private static let regexes: [NSRegularExpression] = patterns.compactMap {
        try? NSRegularExpression(pattern: $0, options: [.caseInsensitive])
    }

    /// True when the prompt is asking about what's on the user's screen.
    static func matches(_ prompt: String) -> Bool {
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = NSRange(text.startIndex..., in: text)
        return regexes.contains { $0.firstMatch(in: text, range: range) != nil }
    }
}
