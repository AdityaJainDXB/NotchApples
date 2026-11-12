//
//  ResearchAgent.swift
//  Notch Apple
//
//  NotchAI's research and file reading (Pro). It does real work and reports exactly what it did, as a TASK the user
//  can watch in the Tasks section (steps, log, cancel, retry):
//   • Web pages: one "fetch_page" step per public URL the user gives (http/https only, never localhost or the local
//     network), then an "ask_model" step that asks the model to answer ONLY from the readable text, with [1], [2]
//     citations.
//   • Files: a "read_file" step for a file the user picked in a file dialog (text, Markdown, CSV, JSON, code, PDF, Word, Excel, PowerPoint;
//     images through on-device OCR), then "ask_model". Files are only read, never changed.
//  The source list is exactly what was fetched or read; a page that fails is recorded as failed and never cited.
//  The question goes through the shared conversation and so through the Local-first guard.
//
//  With no address given the question is searched (DuckDuckGo with no key, the user's own SearXNG, or Wikipedia, chosen
//  in the Research section; the query goes to that service and the task says so) and the top three results are read.
//  Not built yet: following links and an interactive browser agent.
//

import AppKit
import PDFKit
import SwiftUI

@MainActor
final class ResearchAgent: ObservableObject {
    static let shared = ResearchAgent()

    @Published private(set) var status: String?
    @Published private(set) var pickedFile: URL?

    // MARK: Web pages

    func research(question: String, urlText: String) {
        status = nil
        guard NotchAITier.allows(.pro) else { status = NotchAITier.lockedMessage(.pro); return }
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { status = "Type a question first."; return }
        let urls = ResearchLogic.urls(in: urlText + " " + q)
        var steps: [TaskStep]
        if urls.isEmpty {
            // No addresses given: search, then read the top results. The task says which engine the question goes to.
            let engine = SearchEngineChoice.current()
            if engine == .searxng, SearXNGSearchProvider.normalizedBase(UserDefaults.standard.string(forKey: SearchEngineChoice.searxngKey) ?? "") == nil {
                status = "Set your SearXNG address below, or pick another search engine."; return
            }
            steps = RoutineLogic.searchSteps(question: q, engine: engine.label)
        } else {
            steps = urls.prefix(5).enumerated().map { i, u in
                TaskStep(tool: "fetch_page", title: "Read \(u.host ?? u.absoluteString)", argument: u.absoluteString, risk: .readOnly, idempotencyKey: "src\(i)")
            }
        }
        steps.append(TaskStep(tool: "ask_model", title: "Answer from the pages", argument: q, risk: .readOnly, idempotencyKey: "ask"))
        if NotchAITaskStore.shared.start(NotchAITask(title: "Research: \(q)", agent: "research", steps: steps)) {
            NotchAINav.shared.section = .tasks
        } else { status = "Too many tasks are running. Wait for one to finish." }
    }

    // MARK: Files

    /// A file dialog: the user chooses; nothing else is ever read.
    func chooseFile() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.message = "Choose a file for NotchAI to read. It is only read, never changed."
        if panel.runModal() == .OK { pickedFile = panel.url; status = nil; if let u = panel.url { NotchAIDocuments.shared.add(u, source: .chosen) } }
    }

    func askAboutFile(question: String) {
        status = nil
        guard let url = pickedFile else { status = "Choose a file first."; return }
        ask(about: url, question: question)
    }

    /// Summarises or asks about a file (one the user chose or dropped). Read-only; runs as a task.
    func ask(about url: URL, question: String) {
        status = nil
        guard NotchAITier.allows(.pro) else { status = NotchAITier.lockedMessage(.pro); return }
        pickedFile = url                              // the only file the read tool will open
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        let ask = q.isEmpty ? "Summarise this document." : q
        let steps = [TaskStep(tool: "read_file", title: "Read \(url.lastPathComponent)", argument: url.path, risk: .readOnly, idempotencyKey: "src0"),
                     TaskStep(tool: "ask_model", title: "Answer from the file", argument: ask, risk: .readOnly, idempotencyKey: "ask")]
        if NotchAITaskStore.shared.start(NotchAITask(title: "File: \(url.lastPathComponent)", agent: "file", steps: steps)) {
            NotchAIDocuments.shared.add(url, source: .chosen)
            NotchAINav.shared.section = .tasks
        } else { status = "Too many tasks are running. Wait for one to finish." }
    }
}

// MARK: - The real work (no UI state)

enum ResearchIO {
    static let maxBytes = 2_000_000

    static func fetch(_ url: URL) async throws -> ResearchSource {
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

    static func read(_ url: URL) async throws -> ResearchSource {
        let kind = ResearchLogic.kind(forExtension: url.pathExtension)
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if kind != .pdf, kind != .image, kind != .office, size > maxBytes * 2 { throw ResearchError.tooBig }
        if kind == .office, size > 25_000_000 { throw ResearchError.tooBig }
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
        case .office:
            guard let ok = OfficeReader.kind(forExtension: url.pathExtension) else { throw ResearchError.unsupported(url.pathExtension) }
            guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { throw ResearchError.unreadable }
            do { text = try OfficeReader.text(from: data, kind: ok) }
            catch let e as OfficeReadError { throw ResearchError.office(e.localizedDescription) }
            if text.count > maxBytes { text = String(text.prefix(maxBytes)); truncated = true }
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
    case notPublic, badResponse, status(Int), notText(String), tooBig, unreadable, noText, unsupported(String), office(String)
    var errorDescription: String? {
        switch self {
        case .notPublic: "not fetched: only public http(s) addresses are allowed, never this Mac or your network"
        case .badResponse: "no valid answer from the site"
        case .status(let c): "the site answered \(c)"
        case .notText(let t): "not a text page (\(t))"
        case .tooBig: "the file is too large"
        case .unreadable: "the file could not be opened"
        case .noText: "no text was found in it"
        case .unsupported(let e): "\(e.isEmpty ? "this" : ".\(e)") files are not supported yet (text, Markdown, CSV, JSON, code, PDF, Word .docx, Excel .xlsx, PowerPoint .pptx and images are)"
        case .office(let why): why
        }
    }
}
