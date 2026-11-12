//
//  NotchAIAgents.swift
//  Notch Apple
//
//  The agents the app knows: the built-in ones (NotchAIAgentLogic's catalogue), the user's own custom agents, which
//  built-ins are switched on, and which model each agent uses. Everything a model call does passes the Local-first
//  guard first, per agent, so routing an agent to a cloud model does nothing unless cloud is allowed.
//
//  Model routing: an agent may be given its own provider and model (for example Planning and Coding on local Qwen3,
//  Research on Gemini). With no route it uses the model chosen in Settings → AI.
//

import Foundation
import SwiftUI

@MainActor
final class AgentStore: ObservableObject {
    static let shared = AgentStore()

    @Published private(set) var custom: [AgentSpec] = []
    @Published private(set) var routes: [String: AgentRoute] = [:]
    @Published private(set) var disabled: Set<String> = []

    private let url: URL

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Notch apple", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        url = dir.appendingPathComponent("notchai-agents.json")
        if let data = try? Data(contentsOf: url), let saved = try? JSONDecoder().decode(Saved.self, from: data) {
            custom = saved.custom; routes = saved.routes; disabled = Set(saved.disabled)
        }
    }

    private struct Saved: Codable { var custom: [AgentSpec]; var routes: [String: AgentRoute]; var disabled: [String] }

    /// Built-in agents, then custom ones, with the user's on/off choices applied.
    var agents: [AgentSpec] {
        AgentCatalog.merged(custom: custom).map { var a = $0; if disabled.contains(a.id) { a.enabled = false }; return a }
    }

    func agent(_ id: String) -> AgentSpec? { agents.first { $0.id == id } }

    func setEnabled(_ id: String, _ on: Bool) {
        if on { disabled.remove(id) } else { disabled.insert(id) }
        save()
    }

    func setRoute(_ id: String, _ route: AgentRoute?) {
        if let route { routes[id] = route } else { routes.removeValue(forKey: id) }
        save()
    }

    /// Adds a custom agent; the problems if it is not valid.
    func addCustom(_ spec: AgentSpec) -> [String] {
        let problems = AgentCatalog.problems(in: spec, knownTools: NotchAIToolCatalog.ids, existingIDs: Set(agents.map(\.id)))
        guard problems.isEmpty else { return problems }
        var s = spec; s.builtIn = false
        custom.append(s); save()
        return []
    }

    func deleteCustom(_ id: String) { custom.removeAll { $0.id == id }; routes.removeValue(forKey: id); disabled.remove(id); save() }

    /// The provider and model this agent uses: its route, or the Settings → AI choice.
    func model(for agent: String) -> (AIProvider, String) {
        if let r = routes[agent], let p = AIProvider(rawValue: r.provider), !r.model.isEmpty { return (p, r.model) }
        let c = AIConfig.shared
        return (c.provider, c.model)
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(Saved(custom: custom, routes: routes, disabled: Array(disabled))) else { return }
        try? data.write(to: url, options: [.atomic])
    }
}

/// One call to an agent's model, outside the chat: Local-first guard, then the agent's model, collected into text.
enum AgentModelClient {
    static func complete(agent: String, system: String, user: String) async throws -> String {
        let (provider, model) = await MainActor.run { AgentStore.shared.model(for: agent) }
        try await NotchAIGuard.check(provider: provider, model: model)
        var out = ""
        for try await piece in AIClient.stream([ChatMessage(role: .user, text: user)], provider: provider, model: model, system: system) {
            try Task.checkCancellation()
            out += piece
        }
        if out.isEmpty { throw AIError.empty }
        return out
    }
}

struct ProductionPlanner: PlannerModel {
    func complete(system: String, user: String) async throws -> String {
        try await AgentModelClient.complete(agent: AgentCatalog.planner, system: system, user: user)
    }
}

// MARK: - The orchestrator service

@MainActor
enum NotchAIOrchestrator {
    /// Plans the request, runs the plan with the agents, then answers in Chat. Multi-agent work is Ultimate.
    /// Returns a message if it could not start.
    @discardableResult
    static func run(request: String) -> String? {
        guard NotchAITier.allows(.ultimate) else { return NotchAITier.lockedMessage(.ultimate) }
        let q = request.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return "Type a request first." }
        let steps = [TaskStep(tool: "plan_request", title: "Plan the work", argument: q, risk: .readOnly, idempotencyKey: "plan"),
                     TaskStep(tool: "run_plan", title: "Run the plan with the agents", argument: q, risk: .readOnly, idempotencyKey: "run"),
                     TaskStep(tool: "answer_request", title: "Answer from the results", argument: q, risk: .readOnly, idempotencyKey: "answer")]
        guard NotchAITaskStore.shared.start(NotchAITask(title: "Agents: \(q)", agent: AgentCatalog.planner, steps: steps)) else {
            return "Too many tasks are running. Wait for one to finish."
        }
        NotchAINav.shared.section = .agents
        return nil
    }
}
