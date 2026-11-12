//
//  NotchAITools.swift
//  Notch Apple
//
//  The tools tasks can run today. Each does real work and returns what really happened (or throws):
//   • fetch_page (read-only): fetches a public web page. A page that fails is returned as a failure marker, so one bad
//     address does not hide the pages that worked, and the answer never cites a page that was not read.
//   • read_file (read-only): reads a file the user chose in the file dialog, and only that file.
//   • ask_model (read-only): asks the shared conversation to answer from the sources the earlier steps collected. It
//     goes through the Local-first guard like every other question.
//  No tool here changes files, sends messages or runs commands. Those arrive with computer control (Ultimate).
//

import Foundation

struct PageToolResult: Codable {
    var ok: Bool
    var title: String
    var location: String
    var text: String
    var truncated: Bool
    var error: String?
}

struct FetchPageTool: TaskTool {
    let id = "fetch_page"
    let risk = ToolRisk.readOnly
    func run(argument: String, results: [String: String]) async throws -> String {
        guard let url = ResearchLogic.urls(in: argument).first ?? URL(string: argument) else { throw ResearchError.notPublic }
        do {
            let s = try await ResearchIO.fetch(url)
            return encode(PageToolResult(ok: true, title: s.title, location: s.location, text: s.text, truncated: s.truncated, error: nil))
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            return encode(PageToolResult(ok: false, title: argument, location: argument, text: "", truncated: false, error: error.localizedDescription))
        }
    }
}

/// Opens the nth hit (1-based) of the earlier "search" step. A missing hit is a recorded failure, never a crash, and
/// the page is read through the same public-web-only fetch as any other.
struct FetchSearchHitTool: TaskTool {
    let id = "fetch_search_hit"
    let risk = ToolRisk.readOnly
    func run(argument: String, results: [String: String]) async throws -> String {
        let n = Int(argument.trimmingCharacters(in: .whitespaces)) ?? 1
        guard let url = SearchOutput.hit(n, in: results["search"] ?? "") else {
            return encode(PageToolResult(ok: false, title: "Result \(n)", location: "", text: "", truncated: false, error: "the search had no result number \(n)"))
        }
        return try await FetchPageTool().run(argument: url.absoluteString, results: results)
    }
}

struct ReadFileTool: TaskTool {
    let id = "read_file"
    let risk = ToolRisk.readOnly
    /// Only the file the user chose in the dialog may be read.
    let allowedPath: @Sendable () async -> String?
    func run(argument: String, results: [String: String]) async throws -> String {
        guard await allowedPath() == argument else { throw ResearchError.unreadable }
        let s = try await ResearchIO.read(URL(fileURLWithPath: argument))
        await MainActor.run { NotchAIDocuments.shared.record(path: argument) }       // listed in Documents, so the user can see what was used
        return encode(PageToolResult(ok: true, title: s.title, location: s.location, text: s.text, truncated: s.truncated, error: nil))
    }
}

struct AskModelTool: TaskTool {
    let id = "ask_model"
    let risk = ToolRisk.readOnly
    let timeout: TimeInterval? = 120
    func run(argument: String, results: [String: String]) async throws -> String {
        let pages = results.filter { $0.key.hasPrefix("src") }.sorted { $0.key < $1.key }
            .compactMap { try? JSONDecoder().decode(PageToolResult.self, from: Data($0.value.utf8)) }
        let sources = pages.filter(\.ok).map { ResearchSource(title: $0.title, location: $0.location, text: $0.text, truncated: $0.truncated) }
        guard !sources.isEmpty else { throw ResearchError.noText }
        let prompt = ResearchLogic.prompt(question: argument, sources: sources)
        let shown = "Research: \(argument)\n\(ResearchLogic.sourceList(sources))"
        await MainActor.run {
            NotchAIConversation.shared.send(prompt, display: shown)
            NotchAINav.shared.section = .chat
        }
        return "Asked the model using \(sources.count) source\(sources.count == 1 ? "" : "s")."
    }
}

private func encode(_ r: PageToolResult) -> String {
    String(decoding: (try? JSONEncoder().encode(r)) ?? Data(), as: UTF8.self)
}
