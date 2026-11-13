//
//  NotchAIDocumentIndex.swift
//  Notch Apple
//
//  Whole-document understanding without sending the whole document: a long document is cut into passages (keeping the
//  page each came from), the passages best matching the question are found with BM25 ranking, and only those go to the
//  model, each tagged with its page so the answer can cite "(p. 12)". Runs on this Mac; no model, no network.
//  Pure and unit tested.
//

import Foundation

struct DocPassage: Equatable {
    var index: Int
    var page: Int?
    var text: String
}

struct DocumentIndex {
    private(set) var passages: [DocPassage]
    private let termFrequencies: [[String: Int]]
    private let docFrequency: [String: Int]
    private let averageLength: Double

    /// `[page N]` markers (as the PDF reader writes them) set each passage's page.
    init(text: String, targetCharacters: Int = 900) {
        var ps: [DocPassage] = []
        var page: Int?
        var current = ""
        func flush() {
            let t = current.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { ps.append(DocPassage(index: ps.count, page: page, text: t)) }
            current = ""
        }
        for line in text.components(separatedBy: "\n") {
            if let p = Self.pageMarker(line) { flush(); page = p; continue }
            if line.trimmingCharacters(in: .whitespaces).isEmpty {
                if current.count >= targetCharacters / 2 { flush() } else if !current.isEmpty { current += "\n" }
                continue
            }
            if current.count + line.count > targetCharacters, !current.isEmpty { flush() }
            current += (current.isEmpty ? "" : "\n") + line
            // A single huge line: cut it.
            while current.count > targetCharacters * 2 {
                let cut = current.index(current.startIndex, offsetBy: targetCharacters)
                ps.append(DocPassage(index: ps.count, page: page, text: String(current[..<cut])))
                current = String(current[cut...])
            }
        }
        flush()
        passages = ps
        termFrequencies = ps.map { Self.counts(Self.tokens($0.text)) }
        var df: [String: Int] = [:]
        for tf in termFrequencies { for t in tf.keys { df[t, default: 0] += 1 } }
        docFrequency = df
        let total = termFrequencies.reduce(0) { $0 + $1.values.reduce(0, +) }
        averageLength = ps.isEmpty ? 1 : max(1, Double(total) / Double(ps.count))
    }

    static func pageMarker(_ line: String) -> Int? {
        let t = line.trimmingCharacters(in: .whitespaces)
        guard t.hasPrefix("[page "), t.hasSuffix("]") else { return nil }
        return Int(t.dropFirst(6).dropLast())
    }

    static func tokens(_ s: String) -> [String] {
        s.lowercased().split { !$0.isLetter && !$0.isNumber }.map(String.init).filter { $0.count > 1 && !stop.contains($0) }
    }

    private static let stop: Set<String> = ["the", "and", "for", "are", "was", "with", "that", "this", "from", "have", "has", "what", "which", "how", "does", "did", "you", "your", "about", "into", "than", "then", "there", "their", "them", "its", "can", "will"]

    private static func counts(_ t: [String]) -> [String: Int] { Dictionary(t.map { ($0, 1) }, uniquingKeysWith: +) }

    /// The best passages for the question, best first (BM25), in `limit` at most. Empty if nothing matches.
    func search(_ query: String, limit: Int = 5) -> [(passage: DocPassage, score: Double)] {
        let q = Set(Self.tokens(query))
        guard !q.isEmpty, !passages.isEmpty else { return [] }
        let n = Double(passages.count), k1 = 1.5, b = 0.75
        var scored: [(DocPassage, Double)] = []
        for (i, tf) in termFrequencies.enumerated() {
            let len = Double(tf.values.reduce(0, +))
            var score = 0.0
            for term in q {
                guard let f = tf[term].map(Double.init), let df = docFrequency[term].map(Double.init) else { continue }
                let idf = log((n - df + 0.5) / (df + 0.5) + 1)
                score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * len / averageLength))
            }
            if score > 0 { scored.append((passages[i], score)) }
        }
        return scored.sorted { $0.1 > $1.1 }.prefix(limit).map { (passage: $0.0, score: $0.1) }
    }

    /// The excerpts to give the model, in document order, each tagged with its page, within a character budget.
    func excerpts(for query: String, limit: Int = 5, budget: Int = 6_000) -> String {
        var used = 0
        var chosen: [DocPassage] = []
        for hit in search(query, limit: limit) {
            if used + hit.passage.text.count > budget, !chosen.isEmpty { break }
            chosen.append(hit.passage); used += hit.passage.text.count
        }
        return chosen.sorted { $0.index < $1.index }.map { p in
            "(\(p.page.map { "p. \($0)" } ?? "passage \(p.index + 1)"))\n\(p.text)"
        }.joined(separator: "\n\n")
    }
}
