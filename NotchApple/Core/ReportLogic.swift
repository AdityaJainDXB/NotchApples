//
//  ReportLogic.swift
//  Notch Apple
//
//  Settings → Report: a bug, an idea or a question turned into a GitHub issue that already says which app it is about
//  (Mac or Windows), which version, and which plan (Free, Pro or Ultimate). Nothing is sent by the app: it opens the
//  issue form in the browser with everything filled in, and the person reviews and submits it themselves. No GitHub
//  token is stored anywhere. Pure, unit tested; the Windows app has the same rules in reportlogic.js.
//

import Foundation

enum ReportLogic {
    enum Kind: String, CaseIterable, Identifiable {
        case bug, idea, question
        var id: String { rawValue }
        var title: String { switch self { case .bug: "Bug"; case .idea: "Idea"; case .question: "Question" } }
        /// The GitHub label this kind maps to (the repository's own labels).
        var label: String { switch self { case .bug: "bug"; case .idea: "enhancement"; case .question: "question" } }
        var prompt: String {
            switch self {
            case .bug: "What happened, and what did you expect? Steps to repeat it help."
            case .idea: "What would you like Notch Apple to do?"
            case .question: "What would you like to know?"
            }
        }
    }

    static let repository = "AdityaJainDXB/NotchApples"
    static let maxTitleText = 70
    static let maxDescription = 4_000

    /// "[Mac][Pro] Bug: the first line…"
    static func title(kind: Kind, platform: String, tier: String, text: String) -> String {
        let first = text.split(whereSeparator: \.isNewline).first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
        let short = first.count > maxTitleText ? String(first.prefix(maxTitleText)).trimmingCharacters(in: .whitespaces) + "…" : first
        return "[\(platform)][\(tier)] \(kind.title): \(short.isEmpty ? "(no summary)" : short)"
    }

    static func labels(kind: Kind, platform: String) -> String { "\(kind.label),\(platform.lowercased())" }

    static func body(description: String, environment: [String]) -> String {
        let d = description.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = d.count > maxDescription ? String(d.prefix(maxDescription)) + "\n(cut: it was very long)" : d
        return "**Details**\n\(text.isEmpty ? "(nothing written)" : text)\n\n**About this install**\n" + environment.map { "- \($0)" }.joined(separator: "\n")
    }

    /// The fixed lines every report carries: platform, app version, plan, and the system version. No keys, no personal data.
    static func environment(platform: String, version: String, tier: String, system: String, extra: [String] = []) -> [String] {
        ["Platform: \(platform)", "Notch Apple version: \(version)", "Plan: \(tier)", "System: \(system)"] + extra
    }

    static func issueURL(kind: Kind, platform: String, version: String, tier: String, system: String, description: String, extra: [String] = []) -> URL? {
        var c = URLComponents(string: "https://github.com/\(repository)/issues/new")!
        c.queryItems = [
            URLQueryItem(name: "title", value: title(kind: kind, platform: platform, tier: tier, text: description)),
            URLQueryItem(name: "labels", value: labels(kind: kind, platform: platform)),
            URLQueryItem(name: "body", value: body(description: description, environment: environment(platform: platform, version: version, tier: tier, system: system, extra: extra))),
        ]
        return c.url
    }

    /// Enough written to be worth a report.
    static func isReady(_ description: String) -> Bool { description.trimmingCharacters(in: .whitespacesAndNewlines).count >= 10 }
}
