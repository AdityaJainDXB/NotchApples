//
//  ClaudeCodeStatusLogic.swift
//  Notch apple
//
//  The pure rules for the Claude Code status dot, kept free of UI so they can be unit-tested:
//   • which words mean a green dot (finished fine) and which mean yellow (needs you, or warnings/errors),
//   • how long the dot shows, and
//   • how the two hooks are merged into Claude Code's own settings.json without touching anything else.
//

import Foundation

enum ClaudeCodeDot: Equatable {
    case green, yellow
}

enum ClaudeCodeStatusLogic {
    /// The dot shows this long, then fades out.
    static let seconds: Double = 4

    /// notchapple://claude-code?status=… (and the hook commands below).
    static func dot(for status: String?) -> ClaudeCodeDot? {
        switch status?.trimmingCharacters(in: .whitespaces).lowercased() {
        case "done", "success", "ok", "complete", "completed", "finished", "passed": return .green
        case "attention", "input", "approval", "permission", "waiting", "warning", "warn", "warnings", "error", "errors", "failed", "fail": return .yellow
        default: return nil
        }
    }

    static let doneCommand = #"open -g "notchapple://claude-code?status=done""#
    static let attentionCommand = #"open -g "notchapple://claude-code?status=attention""#

    /// Claude Code event → the command that tells Notch apple. Stop = a task finished; Notification = it needs your input or approval.
    static let hooks: [(event: String, command: String)] = [("Stop", doneCommand), ("Notification", attentionCommand)]

    /// Adds the two hooks to a Claude Code settings dictionary. Idempotent, and leaves every other setting and hook alone.
    static func merging(into settings: [String: Any]) -> [String: Any] {
        var result = settings
        var allHooks = (result["hooks"] as? [String: Any]) ?? [:]
        for (event, command) in hooks {
            var entries = (allHooks[event] as? [[String: Any]]) ?? []
            let already = entries.contains { entry in
                ((entry["hooks"] as? [[String: Any]]) ?? []).contains { ($0["command"] as? String) == command }
            }
            if !already { entries.append(["hooks": [["type": "command", "command": command]]]) }
            allHooks[event] = entries
        }
        result["hooks"] = allHooks
        return result
    }

    static func isInstalled(in settings: [String: Any]) -> Bool {
        let allHooks = (settings["hooks"] as? [String: Any]) ?? [:]
        return hooks.allSatisfy { event, command in
            ((allHooks[event] as? [[String: Any]]) ?? []).contains { entry in
                ((entry["hooks"] as? [[String: Any]]) ?? []).contains { ($0["command"] as? String) == command }
            }
        }
    }

    /// The snippet to paste by hand.
    static func snippet() -> String {
        let data = (try? JSONSerialization.data(withJSONObject: merging(into: [:]), options: [.prettyPrinted, .sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }
}
