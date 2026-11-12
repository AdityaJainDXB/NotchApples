//
//  ResearchLogic.swift
//  Notch Apple
//
//  The pure side of NotchAI's research and file reading: turning a web page's HTML into readable text, finding URLs
//  in a question, and building the question for the model so every claim can be tied to a numbered source.
//
//  The model is told to use ONLY the sources given, to cite them as [1], [2], and to say when the sources do not
//  answer. NotchAI never invents a source: the source list shown to the user is exactly what was fetched or read.
//
//  SearchProvider is the interface a search engine plugs into later (no paid search API is built in); until then
//  research works on pages the user names.
//

import Foundation

/// One thing the answer can cite: a web page that was fetched, or a file that was read.
struct ResearchSource: Equatable {
    var title: String
    /// The URL, or the file's name.
    var location: String
    var text: String
    var truncated: Bool
}

struct WebSearchResult: Equatable {
    var title: String
    var url: URL
    var snippet: String
}

/// A web search engine. None is built in; a paid or free search API can conform later.
protocol SearchProvider {
    var name: String { get }
    /// True when queries leave this Mac (every web search does).
    var sendsQueryOffDevice: Bool { get }
    func search(_ query: String, limit: Int) async throws -> [WebSearchResult]
}

enum ResearchLogic {
    // MARK: HTML to text

    struct Page: Equatable {
        var title: String
        var text: String
    }

    /// Readable text from HTML: the title, the main text without scripts, styles, navigation chrome and tags, with
    /// entities decoded and blank space tidied. Block elements become line breaks.
    static func readablePage(fromHTML html: String) -> Page {
        var h = html
        let title = firstMatch(in: h, pattern: "<title[^>]*>([\\s\\S]*?)</title>").map { decode(strip($0)) } ?? ""
        for tag in ["script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form", "iframe"] {
            h = h.replacingOccurrences(of: "<\(tag)\\b[\\s\\S]*?</\(tag)>", with: " ", options: [.regularExpression, .caseInsensitive])
        }
        h = h.replacingOccurrences(of: "<!--[\\s\\S]*?-->", with: " ", options: .regularExpression)
        h = h.replacingOccurrences(of: "<(br|/p|/div|/li|/tr|/h[1-6]|/section|/article|/pre|/blockquote)\\b[^>]*>", with: "\n", options: [.regularExpression, .caseInsensitive])
        h = h.replacingOccurrences(of: "<li\\b[^>]*>", with: "\n- ", options: [.regularExpression, .caseInsensitive])
        let text = decode(strip(h))
            .replacingOccurrences(of: "[ \\t\\u{00A0}]+", with: " ", options: .regularExpression)
            .replacingOccurrences(of: " ?\\n ?", with: "\n", options: .regularExpression)
            .replacingOccurrences(of: "\\n{3,}", with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return Page(title: title.isEmpty ? "(untitled page)" : title, text: text)
    }

    private static func strip(_ s: String) -> String { s.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression) }

    private static func firstMatch(in s: String, pattern: String) -> String? {
        guard let r = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let m = r.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)), m.numberOfRanges > 1,
              let range = Range(m.range(at: 1), in: s) else { return nil }
        return String(s[range])
    }

    static func decode(_ s: String) -> String {
        var t = s
        let named = ["&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&apos;": "'", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…", "&rsquo;": "’", "&lsquo;": "‘", "&ldquo;": "“", "&rdquo;": "”"]
        for (k, v) in named { t = t.replacingOccurrences(of: k, with: v) }
        // Numeric entities: &#8217; and &#x2019;
        if let r = try? NSRegularExpression(pattern: "&#(x?)([0-9a-fA-F]+);") {
            let ns = t as NSString
            for m in r.matches(in: t, range: NSRange(location: 0, length: ns.length)).reversed() {
                let hex = ns.substring(with: m.range(at: 1)) == "x"
                if let code = UInt32(ns.substring(with: m.range(at: 2)), radix: hex ? 16 : 10), let u = Unicode.Scalar(code) {
                    t = (t as NSString).replacingCharacters(in: m.range, with: String(Character(u)))
                }
            }
        }
        return t
    }

    // MARK: URLs

    /// http(s) URLs in a piece of text, in order, without trailing punctuation, no duplicates.
    static func urls(in text: String) -> [URL] {
        guard let r = try? NSRegularExpression(pattern: "https?://[^\\s<>\"')\\]]+") else { return [] }
        var seen = Set<String>(), out: [URL] = []
        for m in r.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            var s = (text as NSString).substring(with: m.range)
            while let last = s.last, ".,;:!?".contains(last) { s.removeLast() }
            if let u = URL(string: s), u.host != nil, seen.insert(s).inserted { out.append(u) }
        }
        return out
    }

    /// Only http and https, never a local or private address: research fetches the public web, not this Mac or the LAN.
    static func isFetchable(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https", let host = url.host?.lowercased() else { return false }
        if host == "localhost" || host.hasSuffix(".local") || host.hasSuffix(".internal") || host == "::1" { return false }
        let p = host.split(separator: ".").compactMap { Int($0) }
        if p.count == 4 {
            if p[0] == 10 || p[0] == 127 || p[0] == 0 || (p[0] == 192 && p[1] == 168) || (p[0] == 172 && (16...31).contains(p[1])) || (p[0] == 169 && p[1] == 254) { return false }
        }
        return true
    }

    // MARK: The question with sources

    static func truncated(_ text: String, maxCharacters: Int) -> (text: String, wasCut: Bool) {
        guard text.count > maxCharacters else { return (text, false) }
        return (String(text.prefix(maxCharacters)), true)
    }

    /// The prompt: the question, then numbered sources, then the rules for answering from them.
    static func prompt(question: String, sources: [ResearchSource], perSourceLimit: Int = 8_000) -> String {
        var out = ["Question: \(question)", "", "Sources (numbered; use only these):"]
        for (i, s) in sources.enumerated() {
            let cut = truncated(s.text, maxCharacters: perSourceLimit)
            out.append("")
            out.append("[\(i + 1)] \(s.title) — \(s.location)")
            out.append(cut.text.isEmpty ? "(no readable text)" : cut.text)
            if cut.wasCut || s.truncated { out.append("(this source was cut short)") }
        }
        out.append("")
        out.append("Answer using ONLY the sources above. After each claim put the source number in brackets, like [1]. " +
                   "If the sources do not answer the question, say so plainly instead of guessing. " +
                   "Keep what the sources state separate from your own conclusions, and label the conclusions as yours.")
        return out.joined(separator: "\n")
    }

    /// The list shown under an answer, exactly the sources given: what was actually read.
    static func sourceList(_ sources: [ResearchSource]) -> String {
        sources.enumerated().map { "[\($0.offset + 1)] \($0.element.title) — \($0.element.location)" }.joined(separator: "\n")
    }

    // MARK: Files

    enum FileKind: String { case text, markdown, csv, json, code, pdf, image, office, unsupported }

    /// Rich text and old Word files hold formatting codes, so they are read through the system's own reader, not as plain text.
    static func needsRichReader(_ ext: String) -> Bool { ["rtf", "doc"].contains(ext.lowercased()) }

    static func kind(forExtension ext: String) -> FileKind {
        switch ext.lowercased() {
        case "txt", "log", "rtf", "doc": .text
        case "md", "markdown": .markdown
        case "csv", "tsv": .csv
        case "json", "yaml", "yml", "xml", "plist", "toml": .json
        case "swift", "js", "ts", "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "m", "sh", "html", "css", "sql": .code
        case "pdf": .pdf
        case "docx", "xlsx", "pptx": .office
        case "png", "jpg", "jpeg", "heic", "tiff", "gif", "bmp": .image
        default: .unsupported
        }
    }

    /// A CSV as a header plus the first rows and a row count, so a large table does not flood the model.
    static func csvPreview(_ csv: String, maxRows: Int = 60) -> String {
        let rows = csv.split(whereSeparator: \.isNewline).map(String.init)
        guard rows.count > maxRows + 1 else { return csv }
        return (rows.prefix(maxRows + 1) + ["… (\(rows.count - 1) data rows in all; the first \(maxRows) are shown)"]).joined(separator: "\n")
    }
}
