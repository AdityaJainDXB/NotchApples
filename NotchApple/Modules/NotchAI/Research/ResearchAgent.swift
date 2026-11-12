//
//  ResearchAgent.swift
//  Notch Apple
//
//  NotchAI's research and file reading (Pro). It does real work and reports exactly what it did:
//   • Web pages: fetches the public URLs the user gives (http/https only, never localhost or the local network),
//     extracts the readable text, and asks the model to answer from those sources with [1], [2] citations.
//   • Files: reads files the user picks in a file dialog (text, Markdown, CSV, JSON, code, PDF; images through
//     on-device OCR). Files are only read, never changed.
//  The source list is exactly what was fetched or read; a page that fails is listed as failed, never cited.
//  The question goes through the shared conversation and so through the Local-first guard.
//
//  Not built yet: a web search engine (SearchProvider has no conformer; no paid API), following links, and an
//  interactive browser agent.
//

import AppKit
import PDFKit
import SwiftUI

@MainActor
final class ResearchAgent: ObservableObject {
    static let shared = ResearchAgent()

    struct Outcome: Identifiable {
        let id = UUID()
        let location: String
        let ok: Bool
        let note: String
    }

    @Published private(set) var working = false
    @Published private(set) var outcomes: [Outcome] = []
    @Published private(set) var status: String?
    @Published private(set) var pickedFile: URL?

    private let maxBytes = 2_000_000

    // MARK: Web pages

    func research(question: String, urlText: String) {
        status = nil; outcomes = []
        guard NotchAITier.allows(.pro) else { status = NotchAITier.lockedMessage(.pro); return }
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { status = "Type a question first."; return }
        let urls = ResearchLogic.urls(in: urlText + " " + q)
        guard !urls.isEmpty else { status = "Paste at least one web address (http or https). There is no built-in web search yet."; return }
        working = true
        Task {
            var sources: [ResearchSource] = []
            var results: [Outcome] = []
            for url in urls.prefix(5) {
                do {
                    let s = try await fetch(url)
                    sources.append(s)
                    results.append(Outcome(location: url.absoluteString, ok: true, note: "Read \(s.text.count.formatted()) characters"))
                } catch {
                    results.append(Outcome(location: url.absoluteString, ok: false, note: error.localizedDescription))
                }
            }
            outcomes = results
            working = false
            guard !sources.isEmpty else { status = "None of the pages could be read, so nothing was asked."; return }
            let prompt = ResearchLogic.prompt(question: q, sources: sources)
            NotchAIConversation.shared.send(prompt, display: "Research: \(q)\n\(ResearchLogic.sourceList(sources))")
            NotchAINav.shared.section = .chat
        }
    }

    private func fetch(_ url: URL) async throws -> ResearchSource {
        guard ResearchLogic.isFetchable(url) else { throw ResearchError.notPublic }
        var r = URLRequest(url: url)
        r.timeoutInterval = 15
        r.setValue("text/html,text/plain;q=0.9", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: r)
        guard let http = response as? HTTPURLResponse else { throw ResearchError.badResponse }
        if let final = http.url, !ResearchLogic.isFetchable(final) { throw ResearchError.notPublic }   // a redirect into the local network
        guard http.statusCode == 200 else { throw ResearchError.status(http.statusCode) }
        let type = (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
        guard type.isEmpty || type.contains("text/") || type.contains("xml") || type.contains("json") else { throw ResearchError.notText(type) }
        let capped = data.prefix(maxBytes)
        let html = String(data: capped, encoding: .utf8) ?? String(decoding: capped, as: UTF8.self)
        let page = type.contains("html") || type.isEmpty ? ResearchLogic.readablePage(fromHTML: html) : .init(title: url.lastPathComponent, text: html)
        return ResearchSource(title: page.title, location: url.absoluteString, text: page.text, truncated: data.count > maxBytes)
    }

    // MARK: Files

    /// A file dialog: the user chooses; nothing else is ever read.
    func chooseFile() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.message = "Choose a file for NotchAI to read. It is only read, never changed."
        if panel.runModal() == .OK { pickedFile = panel.url; outcomes = []; status = nil }
    }

    func askAboutFile(question: String) {
        status = nil; outcomes = []
        guard NotchAITier.allows(.pro) else { status = NotchAITier.lockedMessage(.pro); return }
        guard let url = pickedFile else { status = "Choose a file first."; return }
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        working = true
        Task {
            defer { working = false }
            do {
                let source = try await read(url)
                outcomes = [Outcome(location: url.lastPathComponent, ok: true, note: "Read \(source.text.count.formatted()) characters")]
                let ask = q.isEmpty ? "Summarise this document." : q
                NotchAIConversation.shared.send(ResearchLogic.prompt(question: ask, sources: [source]),
                                                display: "File: \(url.lastPathComponent)\n\(ask)")
                NotchAINav.shared.section = .chat
            } catch {
                outcomes = [Outcome(location: url.lastPathComponent, ok: false, note: error.localizedDescription)]
            }
        }
    }

    private func read(_ url: URL) async throws -> ResearchSource {
        let kind = ResearchLogic.kind(forExtension: url.pathExtension)
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if kind != .pdf, kind != .image, size > maxBytes * 2 { throw ResearchError.tooBig }
        var text: String
        var truncated = false
        switch kind {
        case .pdf:
            guard let doc = PDFDocument(url: url) else { throw ResearchError.unreadable }
            let pages = min(doc.pageCount, 60)
            text = (0..<pages).compactMap { i in doc.page(at: i)?.string.map { "[page \(i + 1)]\n\($0)" } }.joined(separator: "\n")
            truncated = doc.pageCount > pages
            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw ResearchError.noText }
        case .image:
            guard let img = NSImage(contentsOf: url)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw ResearchError.unreadable }
            text = ScreenOCR.text(try await ScreenOCR.recognize(img))
            if text.isEmpty { throw ResearchError.noText }
        case .unsupported:
            throw ResearchError.unsupported(url.pathExtension)
        default:
            guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { throw ResearchError.unreadable }
            text = String(data: data.prefix(maxBytes), encoding: .utf8) ?? String(decoding: data.prefix(maxBytes), as: UTF8.self)
            truncated = data.count > maxBytes
            if kind == .csv { text = ResearchLogic.csvPreview(text) }
        }
        return ResearchSource(title: url.lastPathComponent, location: url.path, text: text, truncated: truncated)
    }
}

enum ResearchError: LocalizedError {
    case notPublic, badResponse, status(Int), notText(String), tooBig, unreadable, noText, unsupported(String)
    var errorDescription: String? {
        switch self {
        case .notPublic: "not fetched: only public http(s) addresses are allowed, never this Mac or your network"
        case .badResponse: "no valid answer from the site"
        case .status(let c): "the site answered \(c)"
        case .notText(let t): "not a text page (\(t))"
        case .tooBig: "the file is too large"
        case .unreadable: "the file could not be opened"
        case .noText: "no text was found in it"
        case .unsupported(let e): "\(e.isEmpty ? "this" : ".\(e)") files are not supported yet (text, Markdown, CSV, JSON, code, PDF and images are)"
        }
    }
}
