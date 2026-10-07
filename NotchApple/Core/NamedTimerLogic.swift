//
//  NamedTimerLogic.swift
//  Notch apple
//
//  Reads what you type for a named timer: "Pasta 10m", "Tea 3 min", "Egg 1:30", "Laundry for 45",
//  "1h30m". A bare number is minutes. No screens, so it can be tested; the Windows app
//  (namedtimers.js) runs the same vectors.
//

import Foundation

enum NamedTimerLogic {
    static let maxSeconds = 24 * 3600
    static let defaultName = "Timer"

    /// "Pasta 10m" → ("Pasta", 600). nil when there is no usable time (none, zero, or over 24 hours).
    static func parse(_ input: String) -> (name: String, seconds: Int)? {
        let s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        let boundary = #"(?<![\p{L}\p{N}:.])"#
        let unit = #"(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)"#
        let patterns: [(String, (NSTextCheckingResult, String) -> Int?)] = [
            (boundary + #"(\d{1,2}):(\d{2})(?::(\d{2}))?$"#, { m, str in
                func g(_ i: Int) -> Int? { Range(m.range(at: i), in: str).flatMap { Int(str[$0]) } }
                guard let a = g(1), let b = g(2) else { return nil }
                if let c = g(3) { return a * 3600 + b * 60 + c }     // h:mm:ss
                return a * 60 + b                                     // m:ss
            }),
            (boundary + #"((?:\d+(?:\.\d+)?\s*"# + unit + #"\s*)+)$"#, { m, str in
                guard let r = Range(m.range(at: 1), in: str) else { return nil }
                let part = String(str[r]).lowercased()
                let re = try! NSRegularExpression(pattern: #"(\d+(?:\.\d+)?)\s*([a-z]+)"#)
                var total = 0.0
                for t in re.matches(in: part, range: NSRange(part.startIndex..., in: part)) {
                    guard let n = Range(t.range(at: 1), in: part).flatMap({ Double(part[$0]) }), let u = Range(t.range(at: 2), in: part).map({ String(part[$0]) }) else { return nil }
                    total += n * (u.hasPrefix("h") ? 3600 : u.hasPrefix("m") ? 60 : 1)
                }
                return Int(total.rounded())
            }),
            (boundary + #"(\d+)$"#, { m, str in Range(m.range(at: 1), in: str).flatMap { Int(str[$0]) }.map { $0 * 60 } }),
        ]
        for (pattern, seconds) in patterns {
            guard let re = try? NSRegularExpression(pattern: pattern), let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
                  let total = seconds(m, s) else { continue }
            guard total > 0, total <= maxSeconds, let whole = Range(m.range, in: s) else { return nil }
            var name = String(s[..<whole.lowerBound]).trimmingCharacters(in: .whitespaces)
            for tail in [" for", " -", " –", ":"] where name.lowercased().hasSuffix(tail) { name = String(name.dropLast(tail.count)).trimmingCharacters(in: .whitespaces) }
            if name.lowercased() == "for" { name = "" }
            return (name.isEmpty ? defaultName : String(name.prefix(30)), total)
        }
        return nil
    }

    /// "2:05", "59:59", "1:02:03": for the list.
    static func clock(_ seconds: Int) -> String {
        let s = max(0, seconds)
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }
}
