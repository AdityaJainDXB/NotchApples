//
//  SnippetVariables.swift
//  Notch apple
//
//  Placeholders in snippets: {date}, {time}, {datetime}, {weekday}, {year}, {clipboard} and {uuid} become today's
//  values when the snippet is pasted or expanded. Anything else in braces is left exactly as typed. The Windows app has
//  the same rule in services/snippetvars.js and the same test cases.
//

import AppKit
import Foundation

enum SnippetVariables {
    /// Replaces each {name} with `values[name]` (names are matched in lower case); unknown ones stay as they were.
    static func expand(_ text: String, values: [String: String]) -> String {
        guard text.contains("{"), let re = try? NSRegularExpression(pattern: #"\{([A-Za-z]+)\}"#) else { return text }
        var out = "", last = text.startIndex
        for m in re.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let whole = Range(m.range, in: text), let name = Range(m.range(at: 1), in: text) else { continue }
            out += text[last..<whole.lowerBound]
            out += values[text[name].lowercased()] ?? String(text[whole])
            last = whole.upperBound
        }
        return out + text[last...]
    }

    /// The values for right now. {clipboard} is read only if the snippet uses it.
    @MainActor
    static func values(for text: String, now: Date = Date()) -> [String: String] {
        var v = [
            "date": now.formatted(date: .abbreviated, time: .omitted),
            "time": now.formatted(date: .omitted, time: .shortened),
            "datetime": now.formatted(date: .abbreviated, time: .shortened),
            "weekday": now.formatted(.dateTime.weekday(.wide)),
            "year": now.formatted(.dateTime.year()),
            "uuid": UUID().uuidString.lowercased(),
        ]
        if text.lowercased().contains("{clipboard}") { v["clipboard"] = NSPasteboard.general.string(forType: .string) ?? "" }
        return v
    }

    @MainActor
    static func render(_ text: String) -> String { expand(text, values: values(for: text)) }
}
