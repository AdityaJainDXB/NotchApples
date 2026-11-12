//
//  NotchAIWebSearch.swift
//  Notch Apple
//
//  The first real SearchProvider: Wikipedia's public search API (free, no key, no account, no paid service). It is an
//  encyclopaedia, not the whole web, and the app says so. The query is sent to wikipedia.org and nowhere else.
//  Building the request and reading the answer are pure and unit tested against a saved response; only `search`
//  touches the network.
//

import Foundation

struct WikipediaSearchProvider: SearchProvider {
    let name = "Wikipedia"
    let sendsQueryOffDevice = true
    var language = "en"

    static func searchURL(query: String, limit: Int, language: String = "en") -> URL? {
        var c = URLComponents()
        c.scheme = "https"; c.host = "\(language).wikipedia.org"; c.path = "/w/api.php"
        c.queryItems = [URLQueryItem(name: "action", value: "query"), URLQueryItem(name: "list", value: "search"),
                        URLQueryItem(name: "srsearch", value: query), URLQueryItem(name: "srlimit", value: String(max(1, min(limit, 10)))),
                        URLQueryItem(name: "format", value: "json"), URLQueryItem(name: "utf8", value: "1")]
        return c.url
    }

    static func articleURL(title: String, language: String = "en") -> URL? {
        let slug = title.replacingOccurrences(of: " ", with: "_")
        guard let enc = slug.addingPercentEncoding(withAllowedCharacters: CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "?#"))) else { return nil }
        return URL(string: "https://\(language).wikipedia.org/wiki/\(enc)")
    }

    static func parse(_ data: Data, language: String = "en") -> [WebSearchResult] {
        guard let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let items = (json["query"] as? [String: Any])?["search"] as? [[String: Any]] else { return [] }
        return items.compactMap { item in
            guard let title = item["title"] as? String, let url = articleURL(title: title, language: language) else { return nil }
            let snippet = ResearchLogic.decode((item["snippet"] as? String ?? "").replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression))
            return WebSearchResult(title: title, url: url, snippet: snippet)
        }
    }

    func search(_ query: String, limit: Int) async throws -> [WebSearchResult] {
        guard let url = Self.searchURL(query: query, limit: limit, language: language) else { return [] }
        var r = URLRequest(url: url); r.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: r)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw WebSearchError.status((response as? HTTPURLResponse)?.statusCode ?? 0) }
        return Self.parse(data, language: language)
    }
}

enum WebSearchError: LocalizedError {
    case status(Int), blocked(String), notConfigured(String)
    var errorDescription: String? {
        switch self {
        case .status(let c): "the search service answered \(c)"
        case .blocked(let w): w
        case .notConfigured(let w): w
        }
    }
}

// MARK: - General web search (no key, no account, no paid API)

/// Which engine the search tool uses. The choice is the user's (Research section); every one of them sends the query to
/// that service, and results are labelled with the engine's name so nothing looks local.
enum SearchEngineChoice: String, CaseIterable {
    case duckDuckGo, searxng, wikipedia

    var label: String {
        switch self {
        case .duckDuckGo: "DuckDuckGo (web, no key)"
        case .searxng: "My SearXNG server"
        case .wikipedia: "Wikipedia only"
        }
    }

    static let defaultsKey = "notchai.search.engine"
    static let searxngKey = "notchai.search.searxngURL"

    /// The provider for a choice. A SearXNG choice with no usable address yields nil: the tool says so instead of quietly
    /// searching somewhere else.
    static func provider(for choice: SearchEngineChoice, searxngURL: String) -> SearchProvider? {
        switch choice {
        case .duckDuckGo: return DuckDuckGoSearchProvider()
        case .wikipedia: return WikipediaSearchProvider()
        case .searxng:
            guard let base = SearXNGSearchProvider.normalizedBase(searxngURL) else { return nil }
            return SearXNGSearchProvider(base: base)
        }
    }

    static func current(_ d: UserDefaults = .standard) -> SearchEngineChoice {
        SearchEngineChoice(rawValue: d.string(forKey: defaultsKey) ?? "") ?? .duckDuckGo
    }
}

/// DuckDuckGo's HTML endpoint: free, keyless, no account. It is a page for people, so the parser reads the result links
/// (which go through a redirect carrying the real address in `uddg`) and snippets, and returns nothing, not a crash, when
/// the page changes shape. Only `search` touches the network.
struct DuckDuckGoSearchProvider: SearchProvider {
    let name = "DuckDuckGo"
    let sendsQueryOffDevice = true

    static func searchURL(query: String) -> URL? {
        var c = URLComponents()
        c.scheme = "https"; c.host = "html.duckduckgo.com"; c.path = "/html/"
        c.queryItems = [URLQueryItem(name: "q", value: query)]
        return c.url
    }

    /// `//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=…` → https://example.com. Direct links pass through.
    static func target(fromHref href: String) -> URL? {
        let raw = ResearchLogic.decode(href)
        let absolute = raw.hasPrefix("//") ? "https:" + raw : raw
        guard let comps = URLComponents(string: absolute) else { return nil }
        if let host = comps.host?.lowercased(), host.hasSuffix("duckduckgo.com") {
            guard comps.path.hasPrefix("/l/"), let u = comps.queryItems?.first(where: { $0.name == "uddg" })?.value,
                  let url = URL(string: u) else { return nil }        // other duckduckgo.com links are ads or navigation
            return ResearchLogic.isFetchable(url) ? url : nil
        }
        guard let url = comps.url else { return nil }
        return ResearchLogic.isFetchable(url) ? url : nil
    }

    static func parse(_ html: String, limit: Int = 10) -> [WebSearchResult] {
        guard let link = try? NSRegularExpression(pattern: #"<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#, options: [.dotMatchesLineSeparators]),
              let snip = try? NSRegularExpression(pattern: #"class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</(?:a|div|td)>"#, options: [.dotMatchesLineSeparators]) else { return [] }
        let ns = html as NSString
        let all = NSRange(location: 0, length: ns.length)
        let links = link.matches(in: html, range: all)
        let snippets = snip.matches(in: html, range: all)
        func plain(_ s: String) -> String {
            ResearchLogic.decode(s.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression))
                .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        var out: [WebSearchResult] = []
        for (i, m) in links.enumerated() {
            guard let url = target(fromHref: ns.substring(with: m.range(at: 1))) else { continue }
            let title = plain(ns.substring(with: m.range(at: 2)))
            guard !title.isEmpty else { continue }
            // The snippet that follows this link and precedes the next one.
            let nextStart = i + 1 < links.count ? links[i + 1].range.location : ns.length
            let s = snippets.first { $0.range.location > m.range.location && $0.range.location < nextStart }
            out.append(WebSearchResult(title: title, url: url, snippet: s.map { plain(ns.substring(with: $0.range(at: 1))) } ?? ""))
            if out.count >= max(1, min(limit, 10)) { break }
        }
        return out
    }

    /// DuckDuckGo answers an automated-looking request with a challenge page; say so rather than "no results".
    static func isChallenge(_ html: String) -> Bool {
        let l = html.lowercased()
        return l.contains("anomaly") || l.contains("unusual traffic") || l.contains("captcha")
    }

    func search(_ query: String, limit: Int) async throws -> [WebSearchResult] {
        guard let url = Self.searchURL(query: query) else { return [] }
        var r = URLRequest(url: url); r.timeoutInterval = 15
        r.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: r)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 || code == 202 else { throw WebSearchError.status(code) }
        let html = String(decoding: data, as: UTF8.self)
        let found = Self.parse(html, limit: limit)
        if found.isEmpty, Self.isChallenge(html) { throw WebSearchError.blocked("DuckDuckGo asked for a human check") }
        return found
    }
}

/// A SearXNG server the user runs or trusts (`/search?q=…&format=json`). The address is the user's; the app never picks one.
struct SearXNGSearchProvider: SearchProvider {
    let base: URL
    var name: String { "SearXNG (\(base.host ?? "your server"))" }
    let sendsQueryOffDevice = true

    /// Accepts `searx.example.org`, `https://searx.example.org/`, or a LAN address; rejects other schemes and junk.
    static func normalizedBase(_ text: String) -> URL? {
        var t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return nil }
        if !t.contains("://") { t = "https://" + t }
        guard let c = URLComponents(string: t), let scheme = c.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = c.host, !host.isEmpty, c.user == nil, c.password == nil else { return nil }
        var b = URLComponents(); b.scheme = scheme; b.host = host; b.port = c.port
        b.path = c.path.hasSuffix("/") ? String(c.path.dropLast()) : c.path
        return b.url
    }

    static func searchURL(base: URL, query: String) -> URL? {
        guard var c = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        c.path = (c.path.hasSuffix("/") ? String(c.path.dropLast()) : c.path) + "/search"
        c.queryItems = [URLQueryItem(name: "q", value: query), URLQueryItem(name: "format", value: "json")]
        return c.url
    }

    static func parse(_ data: Data, limit: Int = 10) -> [WebSearchResult] {
        guard let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let items = json["results"] as? [[String: Any]] else { return [] }
        return items.compactMap { item -> WebSearchResult? in
            guard let title = item["title"] as? String, !title.isEmpty, let u = item["url"] as? String, let url = URL(string: u), ResearchLogic.isFetchable(url) else { return nil }
            return WebSearchResult(title: ResearchLogic.decode(title), url: url, snippet: ResearchLogic.decode(item["content"] as? String ?? ""))
        }.prefix(max(1, min(limit, 10))).map { $0 }
    }

    func search(_ query: String, limit: Int) async throws -> [WebSearchResult] {
        guard let url = Self.searchURL(base: base, query: query) else { return [] }
        var r = URLRequest(url: url); r.timeoutInterval = 20
        let (data, response) = try await URLSession.shared.data(for: r)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else { throw WebSearchError.status(code) }
        return Self.parse(data, limit: limit)
    }
}

/// Reads the text a search step produced ("1. Title — https://…") so later steps can open the nth hit.
enum SearchOutput {
    /// The nth hit (1-based), or nil when the search had fewer.
    static func hit(_ n: Int, in output: String) -> URL? {
        let all = urls(in: output)
        return n >= 1 && n <= all.count ? all[n - 1] : nil
    }
    static func urls(in output: String) -> [URL] {
        output.split(separator: "\n").compactMap { line -> URL? in
            let l = String(line)
            guard l.range(of: #"^\s*\d+\.\s"#, options: .regularExpression) != nil, let r = l.range(of: " — http") else { return nil }
            let tail = String(l[l.index(after: l.index(after: r.lowerBound))...]).replacingOccurrences(of: "— ", with: "")
            let addr = tail.trimmingCharacters(in: .whitespaces)
            guard let url = URL(string: addr), ResearchLogic.isFetchable(url) else { return nil }
            return url
        }
    }
}
