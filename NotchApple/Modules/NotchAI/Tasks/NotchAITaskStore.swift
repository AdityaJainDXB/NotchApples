//
//  NotchAITaskStore.swift
//  Notch Apple
//
//  Owns NotchAI's tasks: starts them on the TaskEngine, keeps them (JSON in Application Support, saved at every
//  checkpoint), shows them in the Tasks section, and recovers them after a restart. A task that was running when the
//  app quit comes back PAUSED with its finished steps kept; nothing is repeated (see TaskLogic.recover).
//
//  Emergency stop (stopAll) cancels every task, the answer being written and any speech.
//

import Foundation
import SwiftUI

@MainActor
final class NotchAITaskStore: ObservableObject {
    static let shared = NotchAITaskStore()

    @Published private(set) var tasks: [NotchAITask] = []
    @AppStorage("notchai.permission.level") private var levelRaw = PermissionLevel.askBeforeActing.rawValue
    var level: PermissionLevel {
        get { PermissionLevel(rawValue: levelRaw) ?? .askBeforeActing }
        set { objectWillChange.send(); levelRaw = newValue.rawValue }
    }

    private let url: URL
    private var handles: [UUID: Task<Void, Never>] = [:]
    private var engine: TaskEngine!

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Notch apple", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        url = dir.appendingPathComponent("notchai-tasks.json")
        if let data = try? Data(contentsOf: url), let decoded = try? Self.decoder.decode([NotchAITask].self, from: data) {
            tasks = decoded.map { TaskLogic.recover($0) }       // a task that was mid-run is paused, never repeated
        }
        let tools: [TaskTool] = [FetchPageTool(), FetchSearchHitTool(), AskModelTool(), ReadFileTool(allowedPath: { await MainActor.run { ResearchAgent.shared.pickedFile?.path } }),
                                 SearchWebTool(), SearchDocumentTool(), AgentAskTool(), ReadScreenTool(), SpeakTool(), BrowserOpenTool(), BrowserReadTool(),
                                 ComputerTaskTool(), PlanRequestTool(), RunPlanTool(), AnswerRequestTool()]
        // A task an orchestrator delegated may only use its agent's tools, even if a plan asked for another.
        let policy = { @Sendable (agent: String) -> Set<String>? in
            DispatchQueue.main.sync { AgentStore.shared.agent(agent).map { Set($0.tools) } }
        }
        let level = { @Sendable () -> PermissionLevel in PermissionLevel(rawValue: UserDefaults.standard.string(forKey: "notchai.permission.level") ?? "") ?? .askBeforeActing }
        engine = TaskEngine(tools: tools, config: .init(level: level, trustedTools: { [] }, stepTimeout: 60, childToolPolicy: policy, dynamicTool: { MCPToolRegistry.shared.tool($0) }),
                            persist: { [weak self] t in await MainActor.run { self?.update(t) } })
        save()
    }

    private static var encoder: JSONEncoder { let e = JSONEncoder(); e.dateEncodingStrategy = .secondsSince1970; return e }
    private static var decoder: JSONDecoder { let d = JSONDecoder(); d.dateDecodingStrategy = .secondsSince1970; return d }

    /// Top-level tasks only: the children an orchestrator starts are limited by the plan's own parallel limit.
    var runningCount: Int { tasks.filter { $0.depth == 0 && ($0.state == .running || $0.state == .waitingApproval) }.count }
    var waitingForApproval: [NotchAITask] { tasks.filter { $0.state == .waitingApproval } }

    // MARK: Control

    /// Adds the task and runs it. False if too many are already running or the task is invalid.
    @discardableResult
    func start(_ task: NotchAITask) -> Bool {
        guard TaskLogic.canStart(running: runningCount, depth: task.depth), TaskLogic.validate(task) == nil else { return false }
        tasks.insert(task, at: 0)
        run(task)
        return true
    }

    private func run(_ task: NotchAITask) {
        let engine = engine!
        handles[task.id] = Task { [weak self] in
            let final = await engine.run(task)
            self?.update(final)
            self?.handles[task.id] = nil
        }
    }

    func cancel(_ id: UUID) {
        handles[id]?.cancel()
        Task { await engine.cancel(id) }
        // Cancelling an orchestration cancels what it delegated.
        for child in tasks where child.parentID == id && !child.state.isFinished { cancel(child.id) }
    }

    // MARK: Delegation (the orchestrator's children)

    private var waiters: [UUID: [CheckedContinuation<NotchAITask, Never>]] = [:]

    /// Runs child tasks at the same time and returns them finished. A child that already finished (before a restart)
    /// is reused, not run again; one that was paused by a restart is resumed.
    func runChildren(_ children: [NotchAITask]) async -> [NotchAITask] {
        await withTaskGroup(of: NotchAITask.self) { group in
            for c in children { group.addTask { await self.runChild(c) } }
            var out: [NotchAITask] = []
            for await t in group { out.append(t) }
            return out
        }
    }

    private func runChild(_ child: NotchAITask) async -> NotchAITask {
        let existing = tasks.first { $0.parentID == child.parentID && $0.steps.first?.idempotencyKey == child.steps.first?.idempotencyKey }
        switch ChildReuse.decision(for: existing) {
        case .reuse: return existing!
        case .resume:
            let t = existing!
            return await withCheckedContinuation { cont in
                waiters[t.id, default: []].append(cont)
                let next = t.state == .paused ? t : t
                update(next); run(next)
            }
        case .startNew:
            return await withCheckedContinuation { cont in
                waiters[child.id, default: []].append(cont)
                tasks.insert(child, at: 0)
                run(child)
            }
        }
    }

    // MARK: Talking to an agent about a finished task

    @Published private(set) var answering: Set<UUID> = []
    private var chatHandles: [UUID: Task<Void, Never>] = [:]

    /// Sends a follow-up to the agent that did the task. The question and the answer are saved in the task's own conversation.
    /// Returns a message when it cannot be sent. The agent's model is the one it is routed to, through the Local-first guard.
    @discardableResult
    func followUp(_ id: UUID?, _ text: String) -> String? {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return "Type a question first." }
        guard let tid = AgentChatLogic.target(explicit: id, tasks: tasks), let i = tasks.firstIndex(where: { $0.id == tid }) else {
            return "There is no finished task to ask about yet."
        }
        guard AgentChatLogic.canFollowUp(tasks[i]) else { return "That task has not finished with a result, so there is nothing to ask about." }
        guard !answering.contains(tid) else { return "It is still answering the last question." }
        let task = tasks[i]
        let prompt = AgentChatLogic.prompt(task: task, question: q)
        tasks[i].chat = AgentChatLogic.appended(tasks[i].chat, role: .user, text: q)
        tasks[i].updated = Date()
        save(); answering.insert(tid)
        chatHandles[tid] = Task { [weak self] in
            let system = await MainActor.run { AgentStore.shared.agent(task.agent)?.systemPrompt ?? AIClient.systemPrompt }
            let reply: String
            do { reply = try await AgentModelClient.complete(agent: task.agent, system: system, user: prompt) }
            catch is CancellationError { reply = "Stopped." }
            catch { reply = "I couldn't answer that: \(error.localizedDescription)" }
            await MainActor.run {
                guard let self else { return }
                if let j = self.tasks.firstIndex(where: { $0.id == tid }) { self.tasks[j].chat = AgentChatLogic.appended(self.tasks[j].chat, role: .agent, text: reply) }
                self.answering.remove(tid); self.chatHandles[tid] = nil; self.save()
            }
        }
        return nil
    }

    /// Stops an answer that is still being written.
    func stopAnswer(_ id: UUID) { chatHandles[id]?.cancel() }

    func approve(_ id: UUID, _ approved: Bool) { Task { await engine.resolveApproval(id, approved: approved) } }

    /// Resume a paused task (after a restart) or retry failed steps. Finished steps are never run again.
    func resume(_ id: UUID) {
        guard let t = tasks.first(where: { $0.id == id }), TaskLogic.canStart(running: runningCount, depth: t.depth) else { return }
        let next = t.state == .failed ? TaskLogic.retrying(t) : t
        update(next)
        run(next)
    }

    func delete(_ id: UUID) { cancel(id); tasks.removeAll { $0.id == id }; save() }
    func clearFinished() { tasks.removeAll { $0.state.isFinished }; save() }

    /// The emergency stop: every task, the answer being written, and any speech or listening.
    func stopAll() {
        for t in tasks where !t.state.isFinished && t.state != .paused { cancel(t.id) }
        NotchAIConversation.shared.stop()
        NotchAIVoice.shared.stopSpeaking()
        NotchAIVoice.shared.cancelListening()
    }

    // MARK: Persistence

    fileprivate func update(_ t: NotchAITask) {
        let old = tasks.first { $0.id == t.id }?.state
        if let i = tasks.firstIndex(where: { $0.id == t.id }) { tasks[i] = t } else { tasks.insert(t, at: 0) }
        save()
        if t.depth == 0 { NotchAINotifier.shared.taskChanged(title: t.title, from: old, to: t.state) }
        if t.state.isFinished, let w = waiters.removeValue(forKey: t.id) { w.forEach { $0.resume(returning: t) } }
    }

    private func save() {
        guard let data = try? Self.encoder.encode(tasks) else { return }
        try? data.write(to: url, options: [.atomic])
    }
}
