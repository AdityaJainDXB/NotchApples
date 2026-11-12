//
//  NotchAIAgentTools.swift
//  Notch Apple
//
//  The tools agents can use. Every one does real work and returns what really happened, or throws. Their risk decides
//  approval (TaskLogic.decide): reading public information runs on its own; reading your screen or your browser tab
//  always asks; opening a page asks unless you trusted it; computer tasks always ask. Nothing here changes a file,
//  sends a message, buys, deletes or installs.
//
//   search_web      read-only   Wikipedia search (the only search engine built in; says so)
//   fetch_page      read-only   a public web page (the first address in its input, so {{0}} from a search works)
//   read_file       read-only   the one file you chose in the file dialog
//   search_document read-only   finds the passages of a long document that answer a question, with page numbers
//   agent_ask       read-only   one question to the agent's model (its own route), Local-first guarded
//   read_screen     sensitive   the text on your screen (Screen awareness must be on; exclusions apply)
//   browser_open    low         opens a public address in your browser
//   browser_read    sensitive   the text of the page in your front browser tab
//   speak           low         reads text aloud
//   computer_task   sensitive   one task through Do It (Ultimate; only if this build includes Do It)
//   plan_request / run_plan / answer_request   the orchestrator's three steps
//

import AppKit
import Foundation

enum NotchAIToolCatalog {
    static let descriptions: [String: String] = [
        "search_web": "searches the web with the engine the user chose (DuckDuckGo, their own SearXNG, or Wikipedia); input is the query",
        "fetch_page": "reads a public web page; input is an address or text containing one",
        "read_file": "reads the file the user chose; input is its path",
        "search_document": "finds passages of a long document; input is the question, then a line with --- , then the document text",
        "agent_ask": "asks the agent's model; input is the full question with all the text it needs",
        "read_screen": "reads the text on the user's screen (asks permission each time)",
        "browser_open": "opens a public web address in the browser",
        "browser_read": "reads the page in the front browser tab (asks permission each time)",
        "speak": "reads text aloud",
        "computer_task": "does one task on the Mac through Do It (asks permission each time)",
    ]

    /// Tools an agent may be given. The orchestrator's own steps and the single-agent research steps are internal.
    static var ids: Set<String> { Set(descriptions.keys).union(MCPToolRegistry.shared.ids) }
}

enum AgentToolError: LocalizedError {
    case noQuery, noResults, noBrowser, notAllowed(String), unavailable(String), script(String)
    var errorDescription: String? {
        switch self {
        case .noQuery: "nothing to search for"
        case .noResults: "no results"
        case .noBrowser: "no supported browser was in front (Safari, Chrome, Edge, Brave or Arc)"
        case .notAllowed(let w): w
        case .unavailable(let w): w
        case .script(let w): "the browser said: \(w)"
        }
    }
}

struct SearchWebTool: TaskTool {
    let id = "search_web"
    let risk = ToolRisk.readOnly
    func run(argument: String, results: [String: String]) async throws -> String {
        let q = argument.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { throw AgentToolError.noQuery }
        let choice = SearchEngineChoice.current()
        let searxng = UserDefaults.standard.string(forKey: SearchEngineChoice.searxngKey) ?? ""
        guard let engine = SearchEngineChoice.provider(for: choice, searxngURL: searxng) else {
            throw WebSearchError.notConfigured("no SearXNG address is set (NotchAI → Research → Search engine)")   // never quietly search elsewhere
        }
        let found = try await engine.search(q, limit: 5)
        guard !found.isEmpty else { throw AgentToolError.noResults }
        return "\(engine.name) results for “\(q)” (the query was sent to \(engine.name)):\n" + found.enumerated().map { "\($0.offset + 1). \($0.element.title) — \($0.element.url.absoluteString)\n   \($0.element.snippet)" }.joined(separator: "\n")
    }
}

struct SearchDocumentTool: TaskTool {
    let id = "search_document"
    let risk = ToolRisk.readOnly
    func run(argument: String, results: [String: String]) async throws -> String {
        let parts = argument.components(separatedBy: "\n---\n")
        guard parts.count >= 2 else { throw AgentToolError.noQuery }
        let query = parts[0], body = parts.dropFirst().joined(separator: "\n---\n")
        // The document may arrive as a read_file result (JSON) or as plain text.
        let text = (try? JSONDecoder().decode(PageToolResult.self, from: Data(body.utf8)))?.text ?? body
        let excerpts = DocumentIndex(text: text).excerpts(for: query)
        guard !excerpts.isEmpty else { throw AgentToolError.noResults }
        return excerpts
    }
}

struct AgentAskTool: TaskTool {
    let id = "agent_ask"
    let risk = ToolRisk.readOnly
    let timeout: TimeInterval? = 300
    func run(argument: String, results: [String: String]) async throws -> String {
        try await run(argument: argument, results: results, context: TaskContext(agent: AgentCatalog.planner, taskID: UUID(), depth: 0))
    }
    func run(argument: String, results: [String: String], context: TaskContext) async throws -> String {
        let system = await MainActor.run { AgentStore.shared.agent(context.agent)?.systemPrompt ?? AIClient.systemPrompt }
        return try await AgentModelClient.complete(agent: context.agent, system: system, user: argument)
    }
}

struct ReadScreenTool: TaskTool {
    let id = "read_screen"
    let risk = ToolRisk.sensitive
    func run(argument: String, results: [String: String]) async throws -> String {
        let snap = try await ScreenIntelligence.shared.captureForAgent()
        var out = "App: \(snap.appName)"
        if let t = snap.windowTitle, !t.isEmpty { out += "\nWindow: \(t)" }
        return out + "\nText on screen:\n" + (snap.ocrText.isEmpty ? "(none could be read)" : ScreenContextLogic.truncated(snap.ocrText, maxCharacters: 12_000).text)
    }
}

struct SpeakTool: TaskTool {
    let id = "speak"
    let risk = ToolRisk.low
    func run(argument: String, results: [String: String]) async throws -> String {
        try await MainActor.run { try NotchAIVoice.shared.speakText(argument) }
        return "Speaking \(argument.count) characters."
    }
}

@MainActor
private enum BrowserRunner {
    static func browser() throws -> BrowserKind {
        guard let kind = BrowserKind.from(bundleID: ScreenIntelligence.shared.lastExternalApp?.bundleIdentifier) else { throw AgentToolError.noBrowser }
        return kind
    }

    /// Runs AppleScript. The first time, macOS asks the user to allow Notch Apple to control the browser.
    static func run(_ source: String) throws -> String {
        var error: NSDictionary?
        let result = NSAppleScript(source: source)?.executeAndReturnError(&error)
        if let error { throw AgentToolError.script((error[NSAppleScript.errorMessage] as? String) ?? "unknown error") }
        return result?.stringValue ?? ""
    }
}

struct BrowserOpenTool: TaskTool {
    let id = "browser_open"
    let risk = ToolRisk.low
    func run(argument: String, results: [String: String]) async throws -> String {
        guard let url = ResearchLogic.urls(in: argument).first else { throw AgentToolError.notAllowed("no web address in the input") }
        return try await MainActor.run {
            let kind = try BrowserRunner.browser()
            guard let script = BrowserScripts.open(url, in: kind) else { throw AgentToolError.notAllowed("only public http(s) addresses are opened") }
            _ = try BrowserRunner.run(script)
            return "Opened \(url.absoluteString) in \(kind.appName)."
        }
    }
}

struct BrowserReadTool: TaskTool {
    let id = "browser_read"
    let risk = ToolRisk.sensitive
    func run(argument: String, results: [String: String]) async throws -> String {
        try await MainActor.run {
            let kind = try BrowserRunner.browser()
            let raw = try BrowserRunner.run(BrowserScripts.readFrontTab(in: kind))
            guard let tab = BrowserScripts.parseTab(raw) else { throw AgentToolError.script("the page could not be read") }
            let page = ScreenContextLogic.truncated(tab.text, maxCharacters: 12_000).text
            return "Page: \(tab.title)\nAddress: \(tab.url)\nText:\n\(page)"
        }
    }
}

struct ComputerTaskTool: TaskTool {
    let id = "computer_task"
    let risk = ToolRisk.sensitive
    let timeout: TimeInterval? = 1_000    // Do It stops itself after 15 minutes
    func run(argument: String, results: [String: String]) async throws -> String {
        let allowed = await MainActor.run { NotchAITier.allows(.ultimate) }
        guard allowed else { throw AgentToolError.notAllowed("Computer control is an Ultimate feature.") }
        guard let run = await MainActor.run(body: { PremiumRegistry.doItRun }) else {
            throw AgentToolError.unavailable("Do It is not connected to NotchAI in this build, so nothing was done.")
        }
        return try await run(argument)
    }
}

// MARK: - Orchestrator steps

struct PlanRequestTool: TaskTool {
    let id = "plan_request"
    let risk = ToolRisk.readOnly
    let timeout: TimeInterval? = 600      // two model calls at most (one repair), each possibly minutes on a local model
    func run(argument: String, results: [String: String]) async throws -> String {
        let agents = await MainActor.run { AgentStore.shared.agents }
        let plan = try await AgentOrchestratorCore.plan(request: argument, agents: agents, knownTools: NotchAIToolCatalog.ids,
                                                       toolDescriptions: NotchAIToolCatalog.descriptions, model: ProductionPlanner())
        return String(decoding: try JSONEncoder().encode(plan), as: UTF8.self)
    }
}

struct RunPlanTool: TaskTool {
    let id = "run_plan"
    let risk = ToolRisk.readOnly
    let timeout: TimeInterval? = 3_600    // waits for the delegated steps, which have their own limits
    func run(argument: String, results: [String: String]) async throws -> String {
        try await run(argument: argument, results: results, context: TaskContext(agent: AgentCatalog.planner, taskID: UUID(), depth: 0))
    }
    func run(argument: String, results: [String: String], context: TaskContext) async throws -> String {
        guard let json = results["plan"], let plan = try? JSONDecoder().decode(AgentPlan.self, from: Data(json.utf8)) else {
            throw AgentToolError.unavailable("there is no plan to run")
        }
        let report = await AgentOrchestratorCore.execute(plan: plan, parentID: context.taskID, parentDepth: context.depth,
                                                         runner: StoreChildRunner())
        try Task.checkCancellation()
        let wrapped = RunReport(results: Dictionary(uniqueKeysWithValues: report.results.map { (String($0.key), $0.value) }),
                                failures: Dictionary(uniqueKeysWithValues: report.failures.map { (String($0.key), $0.value) }))
        return String(decoding: try JSONEncoder().encode(wrapped), as: UTF8.self)
    }
}

struct RunReport: Codable {
    var results: [String: String]
    var failures: [String: String]

    var asReport: ExecutionReport {
        ExecutionReport(results: Dictionary(uniqueKeysWithValues: results.compactMap { k, v in Int(k).map { ($0, v) } }),
                        failures: Dictionary(uniqueKeysWithValues: failures.compactMap { k, v in Int(k).map { ($0, v) } }))
    }
}

struct AnswerRequestTool: TaskTool {
    let id = "answer_request"
    let risk = ToolRisk.readOnly
    let timeout: TimeInterval? = 60
    func run(argument: String, results: [String: String]) async throws -> String {
        guard let planJSON = results["plan"], let plan = try? JSONDecoder().decode(AgentPlan.self, from: Data(planJSON.utf8)),
              let runJSON = results["run"], let run = try? JSONDecoder().decode(RunReport.self, from: Data(runJSON.utf8)) else {
            throw AgentToolError.unavailable("there are no results to answer from")
        }
        let report = run.asReport
        let prompt = AgentOrchestratorCore.answerPrompt(request: argument, plan: plan, report: report)
        let shown = "Agents: \(argument)\n\(plan.steps.count) steps · \(report.results.count) done · \(report.failures.count) failed"
        await MainActor.run {
            NotchAIConversation.shared.send(prompt, display: shown)
            NotchAINav.shared.section = .chat
        }
        return "Asked the model to answer from \(report.results.count) result\(report.results.count == 1 ? "" : "s")."
    }
}

/// Runs the orchestrator's child tasks through the task store (so they appear in Tasks and go through approvals).
struct StoreChildRunner: ChildRunner {
    func run(_ children: [NotchAITask]) async -> [NotchAITask] {
        await NotchAITaskStore.shared.runChildren(children)
    }
}
