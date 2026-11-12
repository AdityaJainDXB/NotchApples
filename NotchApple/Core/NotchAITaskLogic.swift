//
//  NotchAITaskLogic.swift
//  Notch Apple
//
//  The data model and pure rules for NotchAI tasks: what a task and its steps are, when a step needs the user's
//  approval, how progress is counted, and how a task is recovered after the app was quit or crashed mid-run.
//
//  The central safety rule is idempotency: a step that already finished is never run again, and a step that was
//  in flight when the app stopped is only retried if repeating it cannot do harm (read-only). Anything that
//  could have had a side effect is NOT repeated: it is marked for the user to check. Unit tested.
//

import Foundation

enum ToolRisk: Int, Codable, Comparable {
    case readOnly = 0      // reads or fetches; safe to repeat
    case low = 1           // a reversible change (create a file in a chosen folder)
    case sensitive = 2     // sends, submits, purchases, changes settings
    case destructive = 3   // deletes, overwrites, installs, runs commands

    static func < (a: ToolRisk, b: ToolRisk) -> Bool { a.rawValue < b.rawValue }
}

/// Suggest only: nothing runs except reads. Ask before acting: every non-read step asks. Trusted: low-risk tools the
/// user trusted run without asking; sensitive and destructive steps ALWAYS ask, at every level.
enum PermissionLevel: String, Codable, CaseIterable, Identifiable {
    case suggestOnly, askBeforeActing, trusted
    var id: String { rawValue }
    var title: String {
        switch self {
        case .suggestOnly: "Suggest only"
        case .askBeforeActing: "Ask before acting"
        case .trusted: "Trusted low-risk actions"
        }
    }
}

enum ApprovalDecision: Equatable {
    case allow
    case ask
    case deny(String)
}

enum TaskState: String, Codable {
    case queued, running, waitingApproval, paused, completed, failed, cancelled
    var isFinished: Bool { self == .completed || self == .failed || self == .cancelled }
    var title: String {
        switch self {
        case .queued: "Queued"
        case .running: "Running"
        case .waitingApproval: "Needs approval"
        case .paused: "Paused"
        case .completed: "Completed"
        case .failed: "Failed"
        case .cancelled: "Cancelled"
        }
    }
}

enum StepState: String, Codable {
    case pending, running, done, failed, skipped
}

struct TaskStep: Codable, Identifiable, Equatable {
    var id = UUID()
    var tool: String
    var title: String
    var argument: String
    var risk: ToolRisk
    /// Stable across restarts: the same logical step always has the same key, so a recovered task cannot repeat it.
    var idempotencyKey: String
    var state: StepState = .pending
    var result: String?
    var error: String?
    var attempts = 0
}

struct TaskLogEntry: Codable, Equatable {
    var date: Date
    var text: String
}

struct NotchAITask: Codable, Identifiable, Equatable {
    var id = UUID()
    var title: String
    /// Which agent owns it: "research", "file", ... (the agents themselves arrive in later milestones).
    var agent: String
    var state: TaskState = .queued
    var steps: [TaskStep]
    var log: [TaskLogEntry] = []
    var created = Date()
    var updated = Date()
    var parentID: UUID?
    var depth = 0
    var started: Date?
    var finished: Date?
}

enum TaskLogic {
    static let maxRunning = 3
    static let maxDepth = 2
    static let maxSteps = 12
    static let maxRetries = 1

    // MARK: Approval

    static func decide(risk: ToolRisk, tool: String, level: PermissionLevel, trustedTools: Set<String>) -> ApprovalDecision {
        if risk == .readOnly { return .allow }
        switch level {
        case .suggestOnly:
            return .deny("Permission is “Suggest only”, so NotchAI will not act. Change it to let it act with your approval.")
        case .askBeforeActing:
            return .ask
        case .trusted:
            // Trust never covers sensitive or destructive steps.
            return risk == .low && trustedTools.contains(tool) ? .allow : .ask
        }
    }

    // MARK: Progress and scheduling

    static func progress(_ t: NotchAITask) -> Double {
        guard !t.steps.isEmpty else { return t.state == .completed ? 1 : 0 }
        return Double(t.steps.filter { $0.state == .done || $0.state == .skipped }.count) / Double(t.steps.count)
    }

    static func nextStep(_ t: NotchAITask) -> TaskStep? { t.steps.first { $0.state == .pending } }

    /// A new task may start only while fewer than `maxRunning` are running, and delegation stays shallow.
    static func canStart(running: Int, depth: Int) -> Bool { running < maxRunning && depth <= maxDepth }

    static func validate(_ t: NotchAITask) -> String? {
        if t.steps.isEmpty { return "A task needs at least one step." }
        if t.steps.count > maxSteps { return "A task is limited to \(maxSteps) steps." }
        if t.depth > maxDepth { return "Tasks can only be nested \(maxDepth) levels deep." }
        let keys = t.steps.map(\.idempotencyKey)
        if Set(keys).count != keys.count { return "Every step needs its own idempotency key." }
        return nil
    }

    // MARK: Recovery after a restart or crash

    /// What a task looks like when the app starts again. Finished steps keep their results and are never repeated.
    /// A step that was running: read-only ones go back to pending (repeating a read is harmless); anything else is
    /// marked failed with a note, because it may already have happened and must not be done twice.
    static func recover(_ t: NotchAITask, now: Date = Date()) -> NotchAITask {
        guard t.state == .running || t.state == .waitingApproval || t.state == .queued else { return t }
        var r = t
        for i in r.steps.indices where r.steps[i].state == .running {
            if r.steps[i].risk == .readOnly {
                r.steps[i].state = .pending
            } else {
                r.steps[i].state = .failed
                r.steps[i].error = "Interrupted while running. It was not repeated, in case it already happened. Check, then retry."
            }
        }
        r.state = r.steps.contains { $0.state == .failed } ? .failed : .paused
        r.updated = now
        r.log.append(TaskLogEntry(date: now, text: r.state == .paused ? "Paused after the app restarted. Finished steps are kept and won't be repeated."
                                                                      : "Stopped after the app restarted; a step that may have run was not repeated."))
        return r
    }

    /// Retry: failed steps go back to pending, finished ones stay done.
    static func retrying(_ t: NotchAITask, now: Date = Date()) -> NotchAITask {
        var r = t
        for i in r.steps.indices where r.steps[i].state == .failed { r.steps[i].state = .pending; r.steps[i].error = nil; r.steps[i].attempts = 0 }
        r.state = .queued; r.finished = nil; r.updated = now
        r.log.append(TaskLogEntry(date: now, text: "Retrying the failed steps."))
        return r
    }
}
