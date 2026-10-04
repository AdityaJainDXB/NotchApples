//
//  AIPure.swift
//  Notch apple
//
//  The AI tab's plain logic, kept free of UI so the tests can check it:
//  slash commands, reading web search results, and when automations are due.
//

import Foundation

// MARK: - Slash commands

enum SlashCommand {
    case mode(AIMode, text: String, note: String)
    case web(String)
    case persona(String)
    case help

    static let helpText = "/summarize, /explain, /eli5, /fix, /translate fr: text, /code, /web question, /persona name (or off), /help"

    /// nil when the text isn't a command.
    static func parse(_ raw: String) -> SlashCommand? {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard s.hasPrefix("/"), let space = s.firstIndex(where: \.isWhitespace) ?? Optional(s.endIndex) else { return nil }
        let cmd = s[s.index(after: s.startIndex)..<space].lowercased()
        let rest = String(s[space...]).trimmingCharacters(in: .whitespacesAndNewlines)
        switch cmd {
        case "summarize", "summarise", "sum", "tldr": return .mode(.summarize, text: rest, note: "")
        case "explain": return .mode(.explain, text: rest, note: "")
        case "eli5", "simple": return .mode(.simple, text: rest, note: "")
        case "fix", "grammar": return .mode(.rewrite, text: rest, note: "Only fix grammar, spelling and punctuation; keep the wording, meaning and tone.")
        case "rewrite": return .mode(.rewrite, text: rest, note: "")
        case "code": return .mode(.code, text: rest, note: "")
        case "translate", "tr":
            // "/translate fr: bonjour" or "/translate to Spanish: hello"
            if let colon = rest.firstIndex(of: ":"), rest.distance(from: rest.startIndex, to: colon) <= 20 {
                let lang = rest[..<colon].replacingOccurrences(of: "to ", with: "").trimmingCharacters(in: .whitespaces)
                return .mode(.translate, text: String(rest[rest.index(after: colon)...]).trimmingCharacters(in: .whitespaces), note: "into \(lang)")
            }
            return .mode(.translate, text: rest, note: "")
        case "web", "search": return .web(rest)
        case "persona": return .persona(rest)
        case "help", "?": return .help
        default: return nil
        }
    }
}

// MARK: - Web search

enum WebSearch {
    struct Result { let title: String; let url: String; let snippet: String }

    /// Top results from DuckDuckGo's plain HTML page (no key, no account). Only the question is sent.
    static func search(_ query: String, limit: Int = 5) async -> [Result] {
        guard let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "https://html.duckduckgo.com/html/?q=\(q)") else { return [] }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", forHTTPHeaderField: "User-Agent")
        guard let (data, r) = try? await URLSession.shared.data(for: req), (r as? HTTPURLResponse)?.statusCode == 200,
              let html = String(data: data, encoding: .utf8) else { return [] }
        return parse(html, limit: limit)
    }

    static func parse(_ html: String, limit: Int) -> [Result] {
        var out: [Result] = []
        let blocks = html.components(separatedBy: "result__body\"")
        for block in blocks.dropFirst() {
            guard let link = first(#"class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#, in: block, groups: 2) else { continue }
            var href = link[0]
            // DuckDuckGo wraps links: //duckduckgo.com/l/?uddg=<encoded>&…
            if let r = href.range(of: "uddg="), let end = href[r.upperBound...].firstIndex(of: "&") ?? Optional(href.endIndex) {
                href = String(href[r.upperBound..<end]).removingPercentEncoding ?? href
            }
            guard href.hasPrefix("http"), !href.contains("duckduckgo.com/y.js") else { continue }
            let snippet = first(#"class="result__snippet"[^>]*>(.*?)</a>"#, in: block, groups: 1)?[0] ?? ""
            out.append(Result(title: clean(link[1]), url: href, snippet: clean(snippet)))
            if out.count == limit { break }
        }
        return out
    }

    private static func first(_ pattern: String, in s: String, groups: Int) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (1...groups).compactMap { Range(m.range(at: $0), in: s).map { String(s[$0]) } }
    }

    private static func clean(_ s: String) -> String {
        var t = s.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        for (a, b) in ["&amp;": "&", "&quot;": "\"", "&#x27;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " "] { t = t.replacingOccurrences(of: a, with: b) }
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The question with numbered results for the model to cite.
    static func prompt(_ question: String, _ results: [Result]) -> String {
        let list = results.enumerated().map { "[\($0.offset + 1)] \($0.element.title) — \($0.element.url)\n\($0.element.snippet)" }.joined(separator: "\n\n")
        return "Answer using these web search results where they help, and cite them like [1]. If they don't answer it, say so.\n\nSearch results:\n\(list)\n\nQuestion: \(question)"
    }

    static func sourcesMarkdown(_ results: [Result]) -> String {
        "\n\n**Sources**\n" + results.enumerated().map { "\($0.offset + 1). [\($0.element.title.isEmpty ? $0.element.url : $0.element.title)](\($0.element.url))" }.joined(separator: "\n")
    }
}

struct Automation: Codable, Identifiable, Equatable {
    enum Context: String, Codable, CaseIterable, Identifiable {
        case none, calendar, clipboard
        var id: String { rawValue }
        var title: String {
            switch self {
            case .none: "Nothing"
            case .calendar: "Today's calendar"
            case .clipboard: "What's on the clipboard"
            }
        }
    }

    var id = UUID()
    var name = "Morning briefing"
    var prompt = "Summarise my day in three bullet points and suggest what to prepare."
    var hour = 8
    var minute = 0
    /// 1 = Sunday … 7 = Saturday.
    var weekdays: Set<Int> = [2, 3, 4, 5, 6]
    var context: Context = .calendar
    var enabled = true
    var lastRun: Date?

    /// The most recent scheduled time at or before `now`, if it's on one of the chosen days.
    func lastSlot(before now: Date = .now) -> Date? {
        let cal = Calendar.current
        for back in 0..<8 {
            guard let day = cal.date(byAdding: .day, value: -back, to: now),
                  weekdays.contains(cal.component(.weekday, from: day)),
                  let slot = cal.date(bySettingHour: hour, minute: minute, second: 0, of: day), slot <= now else { continue }
            return slot
        }
        return nil
    }

    /// Due when a slot passed in the last 6 hours (e.g. the Mac was asleep at 8:00) and hasn't run yet.
    func isDue(now: Date = .now) -> Bool {
        guard enabled, let slot = lastSlot(before: now), now.timeIntervalSince(slot) < 6 * 3600 else { return false }
        return (lastRun ?? .distantPast) < slot
    }
}

