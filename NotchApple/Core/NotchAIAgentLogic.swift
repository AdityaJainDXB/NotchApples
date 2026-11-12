//
//  NotchAIAgentLogic.swift
//  Notch Apple
//
//  Agents and plans, as pure data and rules (no UI, no network, unit tested):
//   • AgentSpec: an agent is a role, a system prompt, the tools it may use, a time limit and an optional model route.
//     Built-in agents plus user-made custom agents; a custom agent can only use tools that exist.
//   • AgentPlan: what the planner returns (JSON): steps, each owned by an agent, using one of that agent's tools, with
//     dependencies. The plan is validated before anything runs: unknown agents or tools, a tool the agent does not
//     have, too many steps, bad dependencies and cycles are all refused.
//   • Waves: independent steps run in parallel (up to 3 at once), dependent steps wait for the ones they need.
//     Later steps can use earlier results with {{N}} placeholders.
//
//  Nothing in a plan can grant a permission: whether a step may run is decided by TaskLogic.decide from the tool's real
//  risk, not by the plan.
//

import Foundation

struct AgentRoute: Codable, Equatable {
    var provider: String      // AIProvider raw value
    var model: String
}

struct AgentSpec: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var role: String
    var systemPrompt: String
    var tools: [String]
    var timeoutSeconds: Double = 60
    var builtIn = false
    var enabled = true
}

enum AgentCatalog {
    static let planner = "planner"

    /// The built-in agents. Tools are real tool ids; an agent never gets a tool that does not exist (checked in tests).
    static let builtIn: [AgentSpec] = [
        AgentSpec(id: "planner", name: "Planning agent", role: "Breaks a request into steps and decides which agent does each.",
                  systemPrompt: "You plan work. Output only the JSON plan asked for.", tools: [], builtIn: true),
        AgentSpec(id: "research", name: "Research agent", role: "Searches Wikipedia, reads public web pages, compares and summarises with sources.",
                  systemPrompt: "You research. Use only the text you were given and say which source each claim comes from.",
                  tools: ["search_web", "fetch_page", "agent_ask"], builtIn: true),
        AgentSpec(id: "file", name: "File agent", role: "Reads files you chose and answers questions about them.",
                  systemPrompt: "You read documents. Quote or cite the part of the document you rely on.",
                  tools: ["read_file", "search_document", "agent_ask"], builtIn: true),
        AgentSpec(id: "screen", name: "Screen agent", role: "Reads the text on your screen (on your approval) and explains it.",
                  systemPrompt: "You explain what is on the user's screen from the text you were given.",
                  tools: ["read_screen", "agent_ask"], builtIn: true),
        AgentSpec(id: "coding", name: "Coding agent", role: "Reads code you chose and explains, debugs and suggests changes. It never edits files.",
                  systemPrompt: "You explain and debug code. Suggest changes as text; you cannot edit files.",
                  tools: ["read_file", "agent_ask"], builtIn: true),
        AgentSpec(id: "browser", name: "Browser agent", role: "Opens pages in your browser and reads the page you are on, with your approval.",
                  systemPrompt: "You help with the web page the user is on, using only text you were given.",
                  tools: ["browser_open", "browser_read", "fetch_page", "agent_ask"], builtIn: true),
        AgentSpec(id: "computer", name: "Computer agent", role: "Performs a task on your Mac through Do It, only after you approve it. Ultimate.",
                  systemPrompt: "You describe the exact task to do on the Mac, plainly and safely.",
                  tools: ["computer_task"], builtIn: true),
        AgentSpec(id: "voice", name: "Voice agent", role: "Speaks results aloud.", systemPrompt: "You read results aloud.",
                  tools: ["speak"], builtIn: true),
    ]

    /// Problems with a user-made agent, empty if it is fine.
    static func problems(in spec: AgentSpec, knownTools: Set<String>, existingIDs: Set<String>) -> [String] {
        var out: [String] = []
        if spec.id.range(of: "^[a-z][a-z0-9_-]{1,30}$", options: .regularExpression) == nil { out.append("The id must be 2–31 lowercase letters, digits, - or _, starting with a letter.") }
        if existingIDs.contains(spec.id) { out.append("An agent with that id already exists.") }
        if spec.name.trimmingCharacters(in: .whitespaces).isEmpty { out.append("Give the agent a name.") }
        if spec.systemPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out.append("Write its instructions.") }
        if spec.systemPrompt.count > 4_000 { out.append("Instructions are limited to 4,000 characters.") }
        let unknown = spec.tools.filter { !knownTools.contains($0) }
        if !unknown.isEmpty { out.append("Unknown tools: \(unknown.joined(separator: ", ")).") }
        if spec.timeoutSeconds < 5 || spec.timeoutSeconds > 600 { out.append("The time limit must be between 5 and 600 seconds.") }
        return out
    }

    /// Built-ins first, then custom agents; a custom agent can never replace a built-in one.
    static func merged(custom: [AgentSpec]) -> [AgentSpec] {
        let ids = Set(builtIn.map(\.id))
        return builtIn + custom.filter { !ids.contains($0.id) }.map { var c = $0; c.builtIn = false; return c }
    }
}

// MARK: - Plans

struct PlanStep: Codable, Equatable {
    var agent: String
    var tool: String
    var argument: String
    var title: String
    /// Indexes (0-based) of steps whose results this one needs.
    var dependsOn: [Int] = []

    init(agent: String, tool: String, argument: String, title: String, dependsOn: [Int] = []) {
        self.agent = agent; self.tool = tool; self.argument = argument; self.title = title; self.dependsOn = dependsOn
    }

    /// Models often leave out an empty `dependsOn` or the title; that is fine.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        agent = try c.decode(String.self, forKey: .agent)
        tool = try c.decode(String.self, forKey: .tool)
        argument = try c.decode(String.self, forKey: .argument)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? "\(agent): \(tool)"
        dependsOn = try c.decodeIfPresent([Int].self, forKey: .dependsOn) ?? []
    }
}

struct AgentPlan: Codable, Equatable {
    var steps: [PlanStep]
    /// What to ask when answering the user from the results; blank means "answer the original request".
    var finalQuestion: String? = nil
}

enum PlanError: LocalizedError, Equatable {
    case noJSON, badJSON(String), invalid([String])
    var errorDescription: String? {
        switch self {
        case .noJSON: "The planner did not return a plan."
        case .badJSON(let m): "The plan was not valid JSON: \(m)"
        case .invalid(let p): "The plan was refused: " + p.joined(separator: " ")
        }
    }
}

enum PlanLogic {
    static let maxSteps = 8
    static let maxParallel = 3

    /// The instructions for the planner model.
    static func plannerPrompt(request: String, agents: [AgentSpec], toolDescriptions: [String: String]) -> String {
        let list = agents.filter { $0.enabled && $0.id != AgentCatalog.planner && !$0.tools.isEmpty }.map { a in
            "- \(a.id): \(a.role) Tools: " + a.tools.map { t in "\(t) (\(toolDescriptions[t] ?? ""))" }.joined(separator: "; ")
        }.joined(separator: "\n")
        return """
        Plan how to do this request using the agents and tools below. Use as few steps as possible (at most \(maxSteps)).
        Request: \(request)

        Agents and their tools:
        \(list)

        Reply with ONLY a JSON object, no other text:
        {"steps":[{"agent":"<agent id>","tool":"<one of that agent's tools>","argument":"<the tool's input>","title":"<short label>","dependsOn":[<indexes of earlier steps this needs>]}],"finalQuestion":"<what to ask when answering from the results>"}
        A step may use an earlier step's result by writing {{N}} (its index) in its argument. Steps that do not depend on each other run at the same time.
        Only use tools exactly as listed. Never plan to send, buy, delete, install or change anything.
        """
    }

    /// Finds the JSON object in a model reply (fenced or not) and decodes it.
    static func parse(_ reply: String) -> Result<AgentPlan, PlanError> {
        guard let start = reply.firstIndex(of: "{"), let end = reply.lastIndex(of: "}"), start < end else { return .failure(.noJSON) }
        let json = String(reply[start...end])
        do { return .success(try JSONDecoder().decode(AgentPlan.self, from: Data(json.utf8))) }
        catch { return .failure(.badJSON((error as? DecodingError).map(describe) ?? error.localizedDescription)) }
    }

    private static func describe(_ e: DecodingError) -> String {
        switch e {
        case .keyNotFound(let k, _): "missing “\(k.stringValue)”"
        case .typeMismatch(_, let c), .valueNotFound(_, let c), .dataCorrupted(let c): c.debugDescription
        @unknown default: "unreadable"
        }
    }

    /// Everything wrong with the plan; empty means it may run.
    static func problems(_ plan: AgentPlan, agents: [AgentSpec], knownTools: Set<String>) -> [String] {
        var out: [String] = []
        if plan.steps.isEmpty { return ["The plan has no steps."] }
        if plan.steps.count > maxSteps { out.append("Too many steps (\(plan.steps.count); the limit is \(maxSteps)).") }
        let byID = Dictionary(uniqueKeysWithValues: agents.map { ($0.id, $0) })
        for (i, s) in plan.steps.enumerated() {
            let n = "Step \(i)"
            guard let agent = byID[s.agent] else { out.append("\(n): there is no agent “\(s.agent)”."); continue }
            if !agent.enabled { out.append("\(n): the \(agent.name) is switched off.") }
            if !knownTools.contains(s.tool) { out.append("\(n): there is no tool “\(s.tool)”.") }
            else if !agent.tools.contains(s.tool) { out.append("\(n): the \(agent.name) does not have the tool “\(s.tool)”.") }
            if s.argument.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out.append("\(n): the tool needs an argument.") }
            for d in s.dependsOn where d < 0 || d >= plan.steps.count || d >= i {
                out.append("\(n): it can only depend on earlier steps (got \(d)).")
            }
            for ref in placeholders(in: s.argument) where !s.dependsOn.contains(ref) {
                out.append("\(n): it uses {{\(ref)}} but does not depend on step \(ref).")
            }
        }
        return out
    }

    /// Steps grouped into waves: every step in a wave only needs steps from earlier waves, so a wave runs in parallel.
    static func waves(_ plan: AgentPlan) -> [[Int]] {
        var level = [Int](repeating: 0, count: plan.steps.count)
        for (i, s) in plan.steps.enumerated() { level[i] = (s.dependsOn.filter { $0 < i }.map { level[$0] + 1 }.max() ?? 0) }
        let top = level.max() ?? 0
        return (0...top).map { l in plan.steps.indices.filter { level[$0] == l } }
    }

    static func placeholders(in text: String) -> [Int] {
        guard let r = try? NSRegularExpression(pattern: "\\{\\{(\\d+)\\}\\}") else { return [] }
        let ns = text as NSString
        return r.matches(in: text, range: NSRange(location: 0, length: ns.length)).compactMap { Int(ns.substring(with: $0.range(at: 1))) }
    }

    /// Fills {{N}} with the result of step N (cut to `limit` characters each, so a long page cannot flood a prompt).
    static func substituted(_ argument: String, results: [Int: String], limit: Int = 6_000) -> String {
        var out = argument
        for (i, r) in results { out = out.replacingOccurrences(of: "{{\(i)}}", with: String(r.prefix(limit))) }
        return out
    }
}
