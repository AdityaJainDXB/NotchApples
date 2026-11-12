//
//  NotchAIOrchestratorCore.swift
//  Notch Apple
//
//  The orchestrator's brain, with no UI and no app services so it is unit tested end to end with a fake planner
//  model and fake tools:
//    1. plan:    ask the planner model for a JSON plan, validate it, and give it ONE chance to repair a refused plan
//                (the problems are fed back to it); a plan that is still invalid is an error, nothing runs.
//    2. execute: run the plan wave by wave. Each step becomes a small child task owned by its agent (depth + 1);
//                steps in a wave run at the same time (at most PlanLogic.maxParallel); a step whose dependency
//                failed is not run. Child tasks go through the normal engine, so approvals, retries, timeouts and
//                cancellation apply to every step exactly as for any task.
//    3. answer:  build the question for the final answer from the real results, listing which steps failed.
//
//  Recovery: a child that already finished is reused (ChildReuse), so resuming an orchestration never repeats a
//  finished step or an action that may have happened.
//

import Foundation

protocol PlannerModel: Sendable {
    func complete(system: String, user: String) async throws -> String
}

/// Runs child tasks (at the same time) and returns them in their final state.
protocol ChildRunner: Sendable {
    func run(_ children: [NotchAITask]) async -> [NotchAITask]
}

enum ChildReuse: Equatable {
    case reuse(String)       // already completed: use this result, do not run it again
    case resume              // paused or queued after a restart: continue it
    case startNew

    static func decision(for existing: NotchAITask?) -> ChildReuse {
        guard let t = existing else { return .startNew }
        switch t.state {
        case .completed: return .reuse(t.steps.last?.result ?? "")
        case .paused, .queued: return .resume
        case .running, .waitingApproval: return .resume
        case .failed, .cancelled: return .startNew     // a failed step is retried only on purpose, by the user, from Tasks
        }
    }
}

struct ExecutionReport: Equatable {
    var results: [Int: String] = [:]
    var failures: [Int: String] = [:]
    var succeeded: Bool { failures.isEmpty }
}

enum AgentOrchestratorCore {
    static func plan(request: String, agents: [AgentSpec], knownTools: Set<String>, toolDescriptions: [String: String],
                     model: PlannerModel) async throws -> AgentPlan {
        let planner = agents.first { $0.id == AgentCatalog.planner }
        let system = planner?.systemPrompt ?? "You plan work."
        var prompt = PlanLogic.plannerPrompt(request: request, agents: agents, toolDescriptions: toolDescriptions)
        var lastError: PlanError = .noJSON
        for attempt in 0..<2 {
            let reply = try await model.complete(system: system, user: prompt)
            switch PlanLogic.parse(reply) {
            case .failure(let e):
                lastError = e
                prompt += "\n\nYour last reply could not be used (\(e.localizedDescription)). Reply with only the JSON object."
            case .success(let plan):
                let problems = PlanLogic.problems(plan, agents: agents, knownTools: knownTools)
                if problems.isEmpty { return plan }
                lastError = .invalid(problems)
                prompt += "\n\nYour last plan was refused: \(problems.joined(separator: " ")) Fix these and reply with only the JSON object."
            }
            if attempt == 1 { break }
        }
        throw lastError
    }

    static func execute(plan: AgentPlan, parentID: UUID?, parentDepth: Int, runner: ChildRunner) async -> ExecutionReport {
        var report = ExecutionReport()
        for wave in PlanLogic.waves(plan) {
            var runnable: [(Int, NotchAITask)] = []
            for i in wave {
                let s = plan.steps[i]
                if let bad = s.dependsOn.first(where: { report.failures[$0] != nil }) {
                    report.failures[i] = "Not run: it needed step \(bad), which failed."
                    continue
                }
                let arg = PlanLogic.substituted(s.argument, results: report.results)
                var task = NotchAITask(title: s.title, agent: s.agent,
                                       steps: [TaskStep(tool: s.tool, title: s.title, argument: arg, risk: .readOnly, idempotencyKey: "s\(i)")])
                task.parentID = parentID
                task.depth = parentDepth + 1
                runnable.append((i, task))
            }
            // At most maxParallel at once.
            var index = 0
            while index < runnable.count {
                let batch = Array(runnable[index..<min(index + PlanLogic.maxParallel, runnable.count)])
                index += batch.count
                let done = await runner.run(batch.map(\.1))
                for (i, _) in batch {
                    guard let t = done.first(where: { $0.steps.first?.idempotencyKey == "s\(i)" }) else { report.failures[i] = "The step did not run."; continue }
                    if t.state == .completed, let r = t.steps.first?.result { report.results[i] = r }
                    else { report.failures[i] = t.steps.first?.error ?? t.log.last?.text ?? "The step did not finish (\(t.state.title))." }
                }
            }
        }
        return report
    }

    /// The final question: the request and what each step really produced, with failures stated plainly.
    static func answerPrompt(request: String, plan: AgentPlan, report: ExecutionReport, perResultLimit: Int = 5_000) -> String {
        var lines = ["Request: \(request)", ""]
        if let q = plan.finalQuestion, !q.trimmingCharacters(in: .whitespaces).isEmpty { lines.append("Answer this: \(q)"); lines.append("") }
        lines.append("Results of the steps (each from a real tool run; use only these):")
        for (i, s) in plan.steps.enumerated() {
            if let r = report.results[i] { lines.append("\n[Step \(i)] \(s.title) (\(s.agent), \(s.tool)):\n\(r.prefix(perResultLimit))") }
            else { lines.append("\n[Step \(i)] \(s.title) (\(s.agent), \(s.tool)): FAILED — \(report.failures[i] ?? "no result")") }
        }
        lines.append("")
        lines.append("Answer the request from these results only. If a step failed, say what is missing instead of guessing. " +
                     "Keep what the results state separate from your own conclusions.")
        return lines.joined(separator: "\n")
    }
}
