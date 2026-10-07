//
//  LinkShelfLogic.swift
//  Notch apple
//
//  The links shelf: save a link now, read it later. This turns what you paste or type into a clean web
//  address (adding https:// when it's missing) and refuses anything that isn't a web link, so a saved
//  "link" can never be a script or a local file. Nothing is fetched. The Windows app (linkshelf.js) runs
//  the same vectors.
//

import Foundation

enum LinkShelfLogic {
    /// "example.com/a" → "https://example.com/a". nil unless it is a web address.
    static func normalize(_ input: String) -> String? {
        let s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let m = try? NSRegularExpression(pattern: #"^(?:([hH][tT][tT][pP][sS]?)://)?([^\s/?#@]+)([/?#]\S*)?$"#)
            .firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        func g(_ i: Int) -> String? { Range(m.range(at: i), in: s).map { String(s[$0]) } }
        guard let hostPart = g(2) else { return nil }
        let scheme = g(1)?.lowercased()
        let host = hostPart.lowercased()
        let bare = host.replacingOccurrences(of: #":\d{1,5}$"#, with: "", options: .regularExpression)
        let domain = bare.range(of: #"^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$"#, options: .regularExpression) != nil
        let local = scheme != nil && bare.range(of: #"^(localhost|(\d{1,3}\.){3}\d{1,3})$"#, options: .regularExpression) != nil
        guard domain || local else { return nil }
        return (scheme ?? "https") + "://" + host + (g(3) ?? "")
    }

    /// "https://www.example.com/a/b" → "example.com/a/b" (40 characters at most).
    static func label(_ url: String) -> String {
        var s = url.replacingOccurrences(of: #"^https?://"#, with: "", options: [.regularExpression, .caseInsensitive])
        if s.hasPrefix("www.") { s.removeFirst(4) }
        while s.hasSuffix("/") { s.removeLast() }
        return s.count > 40 ? String(s.prefix(39)) + "…" : s
    }
}
