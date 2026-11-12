//
//  NotchAITaskEngine.swift
//  Notch Apple
//
//  Runs a NotchAITask: its steps one after another, each through a registered tool. It does only what a tool really
//  does and records the true outcome (a step is "done" only if the tool returned; a failure is recorded as a
//  failure). Foundation only, so it is unit tested with fake tools.
//
//   • Approval: before a step whose tool is not read-only, TaskLogic.decide says allow, ask or deny. "Ask" pauses the
//     task in .waitingApproval until resolveApproval is called. Sensitive and destructive tools always ask.
//   • Checkpoints: the task is saved (persist) before a step starts, after it finishes, and on every state change,
//     so a crash or restart can recover it (TaskLogic.recover) without repeating a finished step.
//   • Cancellation: cancel(id) (or cancelling the Task running it) stops it at the next step boundary and ends an
//     in-flight read; a pending approval is answered "no".
//   • Retries: a read-only step that fails is retried (TaskLogic.maxRetries) before the task fails.
//   • Timeout: each step has a time limit.
//

import Foundation

protocol TaskTool: Sendable {
    var id: String { get }
    var risk: ToolRisk { get }
    /// `results` holds the results of the steps that finished before this one, by idempotency key.
    func run(argument: String, results: [String: String]) async throws -> String
}

struct TaskTimeout: LocalizedError {
    var errorDescription: String? { "The step took too long and was stopped." }
}

actor TaskEngine {
    struct Config: Sendable {
        var level: @Sendable () -> PermissionLevel
        var trustedTools: @Sendable () -> Set<String>
        var stepTimeout: TimeInterval = 60
    }

    private let tools: [String: TaskTool]
    private let config: Config
    private let persist: @Sendable (NotchAITask) async -> Void
    private var cancelled = Set<UUID>()
    private var approvals: [UUID: CheckedContinuation<Bool, Never>] = [:]

    init(tools: [TaskTool], config: Config, persist: @escaping @Sendable (NotchAITask) async -> Void) {
        self.tools = Dictionary(uniqueKeysWithValues: tools.map { ($0.id, $0) })
        self.config = config
        self.persist = persist
    }

    func cancel(_ id: UUID) {
        cancelled.insert(id)
        approvals.removeValue(forKey: id)?.resume(returning: false)
    }

    func resolveApproval(_ id: UUID, approved: Bool) {
        approvals.removeValue(forKey: id)?.resume(returning: approved)
    }

    /// Runs (or resumes) the task and returns it in its final state: completed, failed or cancelled.
    func run(_ task: NotchAITask) async -> NotchAITask {
        var t = task
        cancelled.remove(t.id)
        if let problem = TaskLogic.validate(t) { return await finish(&t, .failed, problem) }
        t.state = .running
        t.started = t.started ?? Date()
        note(&t, "Started.")
        await persist(t)

        while let step = TaskLogic.nextStep(t), let i = t.steps.firstIndex(where: { $0.id == step.id }) {
            if cancelled.contains(t.id) || Task.isCancelled { return await finish(&t, .cancelled, "Cancelled.") }
            guard let tool = tools[step.tool] else {
                t.steps[i].state = .failed; t.steps[i].error = "No tool called “\(step.tool)”."
                return await finish(&t, .failed, "Step “\(step.title)” failed: no such tool.")
            }
            t.steps[i].risk = tool.risk    // the tool's real risk, not what the step claims

            switch TaskLogic.decide(risk: tool.risk, tool: tool.id, level: config.level(), trustedTools: config.trustedTools()) {
            case .allow: break
            case .deny(let why):
                t.steps[i].state = .failed; t.steps[i].error = why
                return await finish(&t, .failed, why)
            case .ask:
                t.state = .waitingApproval
                note(&t, "Waiting for your approval: \(step.title)")
                await persist(t)
                let approved = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
                    if cancelled.contains(t.id) { c.resume(returning: false) } else { approvals[t.id] = c }
                }
                if cancelled.contains(t.id) { return await finish(&t, .cancelled, "Cancelled.") }
                if !approved {
                    t.steps[i].state = .skipped; t.steps[i].error = "Not approved."
                    return await finish(&t, .cancelled, "You did not approve “\(step.title)”, so nothing was done and the task stopped.")
                }
                t.state = .running
                note(&t, "Approved: \(step.title)")
            }

            // Checkpoint BEFORE the step runs, so a crash mid-step is known to have been in flight.
            t.steps[i].state = .running
            t.steps[i].attempts += 1
            await persist(t)

            let results = Dictionary(t.steps.compactMap { s in s.state == .done ? s.result.map { (s.idempotencyKey, $0) } : nil }, uniquingKeysWith: { a, _ in a })
            do {
                let result = try await withTimeout(config.stepTimeout) { try await tool.run(argument: step.argument, results: results) }
                t.steps[i].state = .done
                t.steps[i].result = result
                t.steps[i].error = nil
                note(&t, "Done: \(step.title)")
                await persist(t)
            } catch is CancellationError {
                return await finish(&t, .cancelled, "Cancelled.")
            } catch {
                if tool.risk == .readOnly, t.steps[i].attempts <= TaskLogic.maxRetries, !cancelled.contains(t.id) {
                    t.steps[i].state = .pending
                    note(&t, "“\(step.title)” failed (\(error.localizedDescription)); trying once more.")
                    await persist(t)
                    continue
                }
                t.steps[i].state = .failed
                t.steps[i].error = error.localizedDescription
                return await finish(&t, .failed, "Failed: \(step.title): \(error.localizedDescription)")
            }
        }
        return await finish(&t, .completed, "Completed.")
    }

    private func finish(_ t: inout NotchAITask, _ state: TaskState, _ message: String) async -> NotchAITask {
        t.state = state
        t.finished = Date()
        note(&t, message)
        await persist(t)
        cancelled.remove(t.id)
        return t
    }

    private func note(_ t: inout NotchAITask, _ text: String) {
        t.updated = Date()
        t.log.append(TaskLogEntry(date: t.updated, text: text))
    }

    private func withTimeout<T: Sendable>(_ seconds: TimeInterval, _ work: @escaping @Sendable () async throws -> T) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask { try await work() }
            group.addTask { try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)); throw TaskTimeout() }
            defer { group.cancelAll() }
            return try await group.next()!
        }
    }
}
