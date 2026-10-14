//
//  UpdateFeedLogic.swift
//  Notch Apple
//
//  Where the app learns about new releases without the GitHub API. The API lets an anonymous address make
//  60 requests an hour; a shared network or a few Macs on one address use that up and every check then fails
//  with "Couldn't reach GitHub". These two sources have no such limit:
//    1. latest.json, a small file on the website that every release refreshes;
//    2. GitHub's own releases.atom feed (not the API).
//  The API stays as the last resort. Pure and Foundation-only, so it is tested.
//

import Foundation

enum UpdateFeed {
    struct Entry: Equatable {
        let version: String
        let title: String
        let notes: String
        let published: Date?
        let dmgURL: URL
        let pageURL: URL
    }

    static let repo = "AdityaJainDXB/NotchApples"
    static let latestJSON = URL(string: "https://adityajaindxb.github.io/NotchApples/latest.json")!
    static let atomFeed = URL(string: "https://github.com/\(repo)/releases.atom")!

    /// A download we will install: https, github.com, this project's release downloads, a .dmg.
    static func isTrustedDMG(_ url: URL) -> Bool {
        // Exactly this project's release-download shape: no dot segments or encoded tricks, no other path.
        let raw = url.absoluteString.lowercased()
        guard url.scheme == "https", url.host == "github.com", url.port == nil, url.query == nil, url.fragment == nil,
              !raw.contains(".."), !raw.contains("%2e"), !raw.contains("%2f") else { return false }
        return url.path.range(of: "^/\(NSRegularExpression.escapedPattern(for: repo))/releases/download/v[0-9]+(\\.[0-9]+)*/NotchApple-[0-9]+(\\.[0-9]+)*\\.dmg$", options: .regularExpression) != nil
    }

    private static func isTrustedPage(_ url: URL) -> Bool {
        let raw = url.absoluteString.lowercased()
        return url.scheme == "https" && url.host == "github.com" && url.path.hasPrefix("/\(repo)/") && !raw.contains("..") && !raw.contains("%2e")
    }

    static func number(from tag: String) -> String? {
        guard let r = tag.range(of: "[0-9]+(\\.[0-9]+)*", options: .regularExpression) else { return nil }
        return String(tag[r])
    }

    /// The Mac release from latest.json: {"version","title","notes","published","dmg","page"}.
    static func parseLatestJSON(_ data: Data) -> Entry? {
        guard let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let version = json["version"] as? String, number(from: version) == version,
              let dmg = (json["dmg"] as? String).flatMap(URL.init(string:)), isTrustedDMG(dmg),
              let page = (json["page"] as? String).flatMap(URL.init(string:)), isTrustedPage(page)
        else { return nil }
        let published = (json["published"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }
        return Entry(version: version, title: json["title"] as? String ?? "Notch Apple \(version)",
                     notes: json["notes"] as? String ?? "", published: published, dmgURL: dmg, pageURL: page)
    }

    /// Mac releases from releases.atom. Windows releases are tagged `win-v…` and are skipped; the DMG address is the
    /// one every Mac release uses (NotchApple-<version>.dmg).
    static func parseAtom(_ data: Data) -> [Entry] {
        let parser = XMLParser(data: data)
        let reader = AtomReader()
        parser.delegate = reader
        parser.parse()
        return reader.entries.compactMap { raw in
            guard let page = raw.link.flatMap(URL.init(string:)), isTrustedPage(page),
                  let tag = page.path.components(separatedBy: "/tag/").last, tag.range(of: "^v[0-9]+(\\.[0-9]+)*$", options: .regularExpression) != nil,
                  let version = number(from: tag),
                  let dmg = URL(string: "https://github.com/\(repo)/releases/download/\(tag)/NotchApple-\(version).dmg"), isTrustedDMG(dmg)
            else { return nil }
            return Entry(version: version, title: raw.title.isEmpty ? "Notch Apple \(version)" : raw.title,
                         notes: plainText(raw.content), published: raw.updated.flatMap { ISO8601DateFormatter().date(from: $0) },
                         dmgURL: dmg, pageURL: page)
        }
    }

    /// Release notes arrive as escaped HTML in the feed; keep the words.
    static func plainText(_ html: String) -> String {
        var s = html.replacingOccurrences(of: "<li>", with: "\n- ").replacingOccurrences(of: "<br>", with: "\n").replacingOccurrences(of: "</p>", with: "\n")
        s = s.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        for (a, b) in [("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'")] { s = s.replacingOccurrences(of: a, with: b) }
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Newest by version number.
    static func newest(_ entries: [Entry]) -> Entry? {
        entries.max { a, b in compare(a.version, b.version) < 0 }
    }

    static func compare(_ a: String, _ b: String) -> Int {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }, y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
            if p != q { return p < q ? -1 : 1 }
        }
        return 0
    }
}

private final class AtomReader: NSObject, XMLParserDelegate {
    struct Raw { var title = "", content = "", link: String?, updated: String? }
    var entries: [Raw] = []
    private var current: Raw?
    private var text = ""

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        text = ""
        if name == "entry" { current = Raw() }
        if name == "link", current != nil, (attributes["rel"] ?? "alternate") == "alternate" { current?.link = attributes["href"] }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { text += string }
    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) { text += String(decoding: CDATABlock, as: UTF8.self) }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        guard current != nil else { return }
        switch name {
        case "title": current?.title = text.trimmingCharacters(in: .whitespacesAndNewlines)
        case "content": current?.content = text
        case "updated": current?.updated = text.trimmingCharacters(in: .whitespacesAndNewlines)
        case "entry": if let c = current { entries.append(c) }; current = nil
        default: break
        }
    }
}
