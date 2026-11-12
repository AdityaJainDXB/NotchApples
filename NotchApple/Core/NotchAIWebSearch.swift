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
    case status(Int)
    var errorDescription: String? {
        switch self { case .status(let c): "the search service answered \(c)" }
    }
}
