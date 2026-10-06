//
//  DevToolkitLogic.swift
//  Notch apple
//
//  Small developer tools for the Tools tab: format and minify JSON, base64 and URL encoding, case changes,
//  a JWT decoder, hashes, UUIDs, lorem ipsum, timestamps, a regex tester and a colour contrast checker.
//  Everything runs on this Mac and nothing is sent anywhere. No screens here, so it can be tested; the
//  Windows app has the same rules in services/devkit.js and the same test cases.
//

import CryptoKit
import Foundation

enum DevToolkit {
    // MARK: JSON

    /// Valid JSON, re-indented with 2 spaces and every key left where it was. nil when it isn't JSON.
    static func formatJSON(_ s: String) -> String? {
        guard isJSON(s) else { return nil }
        var out = "", depth = 0, inString = false, escaped = false
        func newline() { out += "\n" + String(repeating: "  ", count: depth) }
        let chars = Array(s.trimmingCharacters(in: .whitespacesAndNewlines))
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if inString {
                out.append(c)
                if escaped { escaped = false } else if c == "\\" { escaped = true } else if c == "\"" { inString = false }
            } else {
                switch c {
                case "\"": inString = true; out.append(c)
                case "{", "[":
                    // Empty containers stay on one line.
                    var j = i + 1
                    while j < chars.count, chars[j].isWhitespace { j += 1 }
                    if j < chars.count, chars[j] == (c == "{" ? "}" : "]") { out.append(c); out.append(chars[j]); i = j }
                    else { out.append(c); depth += 1; newline() }
                case "}", "]": depth -= 1; newline(); out.append(c)
                case ",": out.append(c); newline()
                case ":": out += ": "
                case " ", "\n", "\t", "\r": break
                default: out.append(c)
                }
            }
            i += 1
        }
        return out
    }

    static func minifyJSON(_ s: String) -> String? {
        guard isJSON(s) else { return nil }
        var out = "", inString = false, escaped = false
        for c in s.trimmingCharacters(in: .whitespacesAndNewlines) {
            if inString {
                out.append(c)
                if escaped { escaped = false } else if c == "\\" { escaped = true } else if c == "\"" { inString = false }
            } else if c == "\"" { inString = true; out.append(c) }
            else if !c.isWhitespace { out.append(c) }
        }
        return out
    }

    static func isJSON(_ s: String) -> Bool {
        guard let d = s.data(using: .utf8), !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        return (try? JSONSerialization.jsonObject(with: d, options: [.fragmentsAllowed])) != nil
    }

    // MARK: Encoding

    static func base64Encode(_ s: String) -> String { Data(s.utf8).base64EncodedString() }

    /// Accepts normal and URL-safe base64, with or without padding. nil if it isn't valid text.
    static func base64Decode(_ s: String) -> String? {
        var t = s.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while t.count % 4 != 0 { t += "=" }
        guard let d = Data(base64Encoded: t) else { return nil }
        return String(data: d, encoding: .utf8)
    }

    private static let unreserved = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    /// Everything except letters, digits and - . _ ~ is %-encoded (as UTF-8).
    static func urlEncode(_ s: String) -> String {
        s.unicodeScalars.map { u in
            let ch = Character(u)
            if unreserved.contains(ch) { return String(ch) }
            return String(ch).utf8.map { String(format: "%%%02X", $0) }.joined()
        }.joined()
    }

    static func urlDecode(_ s: String) -> String? { s.removingPercentEncoding }

    // MARK: Case

    /// "helloWorld foo-bar2" → ["hello", "World", "foo", "bar", "2"]
    static func words(_ s: String) -> [String] {
        guard let re = try? NSRegularExpression(pattern: "[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+") else { return [] }
        return re.matches(in: s, range: NSRange(s.startIndex..., in: s)).compactMap { Range($0.range, in: s).map { String(s[$0]) } }
    }

    enum CaseStyle: String, CaseIterable { case upper = "UPPER", lower = "lower", title = "Title Case", snake = "snake_case", kebab = "kebab-case", camel = "camelCase", pascal = "PascalCase" }

    static func convert(_ s: String, to style: CaseStyle) -> String {
        let w = words(s).map { $0.lowercased() }
        func cap(_ x: String) -> String { x.prefix(1).uppercased() + x.dropFirst() }
        switch style {
        case .upper: return s.uppercased()
        case .lower: return s.lowercased()
        case .title: return w.map(cap).joined(separator: " ")
        case .snake: return w.joined(separator: "_")
        case .kebab: return w.joined(separator: "-")
        case .camel: return w.enumerated().map { $0.offset == 0 ? $0.element : cap($0.element) }.joined()
        case .pascal: return w.map(cap).joined()
        }
    }

    // MARK: JWT

    struct JWT: Equatable {
        let header: String
        let payload: String
        let hasSignature: Bool
        let issued: Date?, expires: Date?, notBefore: Date?
        func isExpired(now: Date = Date()) -> Bool { expires.map { $0 < now } ?? false }
    }

    /// Reads a JSON Web Token. It does NOT check the signature (that needs the secret); it only shows what's inside.
    static func decodeJWT(_ token: String) -> JWT? {
        let parts = token.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 3, let h = base64Decode(parts[0]), let p = base64Decode(parts[1]),
              let header = formatJSON(h), let payload = formatJSON(p) else { return nil }
        let claims = (try? JSONSerialization.jsonObject(with: Data(p.utf8))) as? [String: Any] ?? [:]
        func date(_ k: String) -> Date? { (claims[k] as? Double).map { Date(timeIntervalSince1970: $0) } }
        return JWT(header: header, payload: payload, hasSignature: !parts[2].isEmpty, issued: date("iat"), expires: date("exp"), notBefore: date("nbf"))
    }

    // MARK: Hashes and ids

    enum Hash: String, CaseIterable { case sha1 = "SHA-1", sha256 = "SHA-256", sha512 = "SHA-512" }

    static func hash(_ s: String, _ kind: Hash) -> String {
        let d = Data(s.utf8)
        switch kind {
        case .sha1: return Insecure.SHA1.hash(data: d).map { String(format: "%02x", $0) }.joined()
        case .sha256: return SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined()
        case .sha512: return SHA512.hash(data: d).map { String(format: "%02x", $0) }.joined()
        }
    }

    static func uuid() -> String { UUID().uuidString.lowercased() }

    private static let lorem = ("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua "
        + "ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in "
        + "reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa "
        + "qui officia deserunt mollit anim id est laborum").split(separator: " ").map(String.init)

    /// `count` words of lorem ipsum, starting with "Lorem ipsum", ending in a full stop.
    static func loremIpsum(words count: Int) -> String {
        let n = max(1, min(count, 2000))
        let w = (0..<n).map { lorem[$0 % lorem.count] }
        let text = w.joined(separator: " ")
        return text.prefix(1).uppercased() + text.dropFirst() + "."
    }

    // MARK: Timestamps

    struct Stamp: Equatable { let seconds: Double; let isoUTC: String }

    /// "1516239022" (seconds), "1516239022000" (milliseconds) or "2018-01-18T01:30:22Z" → one moment in time.
    static func parseStamp(_ input: String) -> Stamp? {
        let s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        let secs: Double
        if let n = Double(s), s.allSatisfy({ $0.isNumber || $0 == "-" || $0 == "." }) {
            secs = abs(n) >= 100_000_000_000 ? n / 1000 : n     // 12+ digits means milliseconds
        } else {
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard let d = f.date(from: s) ?? { f.formatOptions = [.withInternetDateTime]; return f.date(from: s) }() else { return nil }
            secs = d.timeIntervalSince1970
        }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return Stamp(seconds: secs, isoUTC: f.string(from: Date(timeIntervalSince1970: secs)))
    }

    // MARK: Regex

    struct RegexMatch: Equatable { let text: String; let groups: [String] }
    enum RegexResult: Equatable { case matches([RegexMatch]), invalid(String) }

    static func regexTest(pattern: String, text: String, ignoreCase: Bool = false, multiline: Bool = false, dotAll: Bool = false) -> RegexResult {
        var o: NSRegularExpression.Options = []
        if ignoreCase { o.insert(.caseInsensitive) }
        if multiline { o.insert(.anchorsMatchLines) }
        if dotAll { o.insert(.dotMatchesLineSeparators) }
        do {
            let re = try NSRegularExpression(pattern: pattern, options: o)
            let ns = text as NSString
            let found = re.matches(in: text, range: NSRange(location: 0, length: ns.length)).prefix(200).map { m -> RegexMatch in
                let groups = (1..<max(1, m.numberOfRanges)).map { m.range(at: $0).location == NSNotFound ? "" : ns.substring(with: m.range(at: $0)) }
                return RegexMatch(text: ns.substring(with: m.range), groups: m.numberOfRanges > 1 ? groups : [])
            }
            return .matches(Array(found))
        } catch { return .invalid("That pattern isn't valid.") }
    }

    // MARK: Colour contrast (WCAG)

    /// "#fff", "#ffffff" or "ffffff" → red, green, blue 0...1.
    static func rgb(hex: String) -> (r: Double, g: Double, b: Double)? {
        var h = hex.trimmingCharacters(in: .whitespaces).lowercased()
        if h.hasPrefix("#") { h.removeFirst() }
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count == 6, let v = Int(h, radix: 16) else { return nil }
        return (Double((v >> 16) & 255) / 255, Double((v >> 8) & 255) / 255, Double(v & 255) / 255)
    }

    static func luminance(_ c: (r: Double, g: Double, b: Double)) -> Double {
        func lin(_ x: Double) -> Double { x <= 0.03928 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
    }

    struct Contrast: Equatable { let ratio: Double; let aaNormal: Bool; let aaLarge: Bool; let aaaNormal: Bool; let aaaLarge: Bool }

    static func contrast(_ a: String, _ b: String) -> Contrast? {
        guard let x = rgb(hex: a), let y = rgb(hex: b) else { return nil }
        let l1 = luminance(x), l2 = luminance(y)
        let ratio = (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)
        return Contrast(ratio: ratio, aaNormal: ratio >= 4.5, aaLarge: ratio >= 3, aaaNormal: ratio >= 7, aaaLarge: ratio >= 4.5)
    }
}
