//
//  NotchAIRoutineLogic.swift
//  Notch Apple
//
//  Routines: a saved request that NotchAI runs again on a schedule. This file is the pure part (no timers, no network,
//  no UI), so the rules are unit tested:
//   • when a routine runs next (every N minutes, daily at a time, weekly on chosen days),
//   • what to do when it is due: run it, wait (offline, or the last run is still going), or skip a run that was missed
//     while the Mac was off or asleep (it runs ONCE when the Mac is back, never a pile of catch-up runs),
//   • three failures in a row pause the routine until the user resumes it,
//   • a run nobody approved within an hour is cancelled and counts as a failure,
//   • a run the app quit during is not a failure: it just runs again.
//  A routine only ever creates an ordinary NotchAI task, so approvals, permission levels, the Local-first guard and
//  recovery after a restart all apply exactly as they do for a task the user starts by hand.
//

import Foundation

enum RoutineSchedule: Codable, Equatable {
    case everyMinutes(Int)
    case daily(hour: Int, minute: Int)
    /// `weekdays` use Calendar's numbering: 1 = Sunday ... 7 = Saturday.
    case weekly(weekdays: [Int], hour: Int, minute: Int)

    static let minimumMinutes = 15
    static let maximumMinutes = 7 * 24 * 60

    var isValid: Bool {
        switch self {
        case .everyMinutes(let m): return (Self.minimumMinutes...Self.maximumMinutes).contains(m)
        case .daily(let h, let m): return (0...23).contains(h) && (0...59).contains(m)
        case .weekly(let days, let h, let m):
            return !days.isEmpty && days.allSatisfy { (1...7).contains($0) } && (0...23).contains(h) && (0...59).contains(m)
        }
    }

    /// The first run strictly after `date`. nil only for an invalid schedule.
    func next(after date: Date, calendar: Calendar = .current) -> Date? {
        guard isValid else { return nil }
        switch self {
        case .everyMinutes(let m):
            return date.addingTimeInterval(TimeInterval(m * 60))
        case .daily(let h, let m):
            return calendar.nextDate(after: date, matching: DateComponents(hour: h, minute: m, second: 0), matchingPolicy: .nextTime)
        case .weekly(let days, let h, let m):
            return days.compactMap {
                calendar.nextDate(after: date, matching: DateComponents(hour: h, minute: m, second: 0, weekday: $0), matchingPolicy: .nextTime)
            }.min()
        }
    }

    /// How late a run may start and still be worth running (a daily 08:00 routine is not run at 20:00 because the Mac
    /// was asleep). An "every N minutes" routine always runs once when due.
    var catchUpWindow: TimeInterval {
        switch self {
        case .everyMinutes: return .infinity
        case .daily, .weekly: return 6 * 3600
        }
    }

    func describe(calendar: Calendar = .current) -> String {
        func t(_ h: Int, _ m: Int) -> String { String(format: "%02d:%02d", h, m) }
        switch self {
        case .everyMinutes(let m):
            if m % 1440 == 0 { return m == 1440 ? "Every day" : "Every \(m / 1440) days" }
            if m % 60 == 0 { return m == 60 ? "Every hour" : "Every \(m / 60) hours" }
            return "Every \(m) minutes"
        case .daily(let h, let m): return "Daily at \(t(h, m))"
        case .weekly(let days, let h, let m):
            let names = calendar.weekdaySymbols
            let list = Array(Set(days)).sorted().compactMap { (1...7).contains($0) ? names[$0 - 1] : nil }
            return "\(list.joined(separator: ", ")) at \(t(h, m))"
        }
    }
}

enum RoutineAction: Codable, Equatable {
    /// A question answered from the web (search, read the top results, answer with citations). Pro.
    case research(question: String)
    /// A request for the agents to plan and carry out. Ultimate.
    case agents(request: String)

    var text: String {
        switch self { case .research(let q): q; case .agents(let r): r }
    }
    var kindLabel: String {
        switch self { case .research: "Research question"; case .agents: "Agent request" }
    }
    /// Every routine action reaches the internet, so none runs while the Mac is offline.
    var needsNetwork: Bool { true }
}

struct Routine: Codable, Identifiable, Equatable {
    var id = UUID()
    var name: String
    var action: RoutineAction
    var schedule: RoutineSchedule
    var enabled = true
    var created = Date()
    var lastRun: Date?
    var nextRun: Date?
    var failures = 0
    /// Why it stopped running on its own; the user resumes it.
    var pausedReason: String?
    /// The task the current or latest run created.
    var lastTaskID: UUID?
    var lastOutcome: String?

    var isPaused: Bool { pausedReason != nil }
}

enum RoutineOutcome: Equatable {
    case success
    case failure(String)
    /// The app quit or the task was paused by a restart: nothing went wrong, run it again.
    case interrupted
}

enum RoutineDecision: Equatable {
    case notDue
    case run
    /// Due but not now; the string is shown to the user. Never counts as a failure.
    case wait(String)
    /// A run missed while the Mac was off; the schedule moves on and the run is skipped.
    case skipMissed
}

enum RoutineLogic {
    static let maxRoutines = 10
    static let maxFailures = 3
    static let approvalTimeout: TimeInterval = 3600
    static let retryDelayMinutes = 10

    // MARK: Validation

    static func validate(_ r: Routine, existingCount: Int = 0) -> String? {
        let name = r.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return "Give the routine a name." }
        if name.count > 60 { return "The name can be at most 60 characters." }
        let text = r.action.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return "Write what the routine should do." }
        if text.count > 500 { return "The request can be at most 500 characters." }
        if !r.schedule.isValid {
            if case .everyMinutes = r.schedule { return "A routine can repeat at most every \(RoutineSchedule.minimumMinutes) minutes, and at least once a week." }
            return "Check the schedule: pick a valid time and at least one day."
        }
        if existingCount >= maxRoutines { return "You can have at most \(maxRoutines) routines. Delete one first." }
        return nil
    }

    // MARK: When

    /// Sets the first `nextRun` of a new routine, or the next one after a run.
    static func scheduled(_ r: Routine, after date: Date, calendar: Calendar = .current) -> Routine {
        var x = r
        x.nextRun = r.schedule.next(after: date, calendar: calendar)
        return x
    }

    static func decide(_ r: Routine, now: Date, online: Bool, previousRunActive: Bool) -> RoutineDecision {
        guard r.enabled, !r.isPaused, let due = r.nextRun, due <= now else { return .notDue }
        if now.timeIntervalSince(due) > r.schedule.catchUpWindow { return .skipMissed }
        if previousRunActive { return .wait("The last run is still going.") }
        if r.action.needsNetwork && !online { return .wait("Waiting for the internet.") }
        return .run
    }

    /// The routine after a skipped (missed) run: the schedule moves on, nothing else changes.
    static func afterSkip(_ r: Routine, now: Date, calendar: Calendar = .current) -> Routine {
        var x = scheduled(r, after: now, calendar: calendar)
        x.lastOutcome = "Skipped a run missed while the Mac was off."
        return x
    }

    /// Records that a run started now.
    static func started(_ r: Routine, taskID: UUID, now: Date) -> Routine {
        var x = r
        x.lastRun = now; x.lastTaskID = taskID; x.lastOutcome = "Running…"
        return x
    }

    // MARK: After a run

    static func finished(_ r: Routine, outcome: RoutineOutcome, now: Date, calendar: Calendar = .current) -> Routine {
        var x = r
        switch outcome {
        case .success:
            x.failures = 0
            x.lastOutcome = "Done"
            x = scheduled(x, after: now, calendar: calendar)
        case .interrupted:
            x.lastOutcome = "Interrupted by a restart; it will run again."
            x.nextRun = now                                    // run again at the next check; not a failure
        case .failure(let why):
            x.failures += 1
            x.lastOutcome = "Failed: \(why)"
            if x.failures >= maxFailures {
                x.pausedReason = "Paused after \(maxFailures) failed runs in a row. Last problem: \(why)"
                x.nextRun = nil
            } else {
                // Try again soon, but never later than the normal next run.
                let retry = now.addingTimeInterval(TimeInterval(retryDelayMinutes * 60 * x.failures))
                let normal = x.schedule.next(after: now, calendar: calendar) ?? retry
                x.nextRun = min(retry, normal)
            }
        }
        return x
    }

    /// The user resumes a paused routine: failures are forgotten and the next run is recomputed.
    static func resumed(_ r: Routine, now: Date, calendar: Calendar = .current) -> Routine {
        var x = r
        x.pausedReason = nil; x.failures = 0; x.enabled = true
        return scheduled(x, after: now, calendar: calendar)
    }

    /// Pauses a routine because it cannot run for a reason the user must fix (for example the tier changed).
    static func paused(_ r: Routine, reason: String) -> Routine {
        var x = r
        x.pausedReason = reason; x.nextRun = nil
        return x
    }

    // MARK: Reading a run's task

    /// What a task's state means for its routine. nil while it is still going.
    static func outcome(taskState: TaskState, error: String?) -> RoutineOutcome? {
        switch taskState {
        case .completed: return .success
        case .failed: return .failure(error ?? "a step failed")
        case .cancelled: return .failure("the run was cancelled")
        case .paused: return .interrupted
        case .queued, .running, .waitingApproval: return nil
        }
    }

    /// A run that has waited for approval for an hour is cancelled: nobody is there, and it must not block later runs.
    static func approvalExpired(taskState: TaskState, waitingSince: Date?, now: Date) -> Bool {
        guard taskState == .waitingApproval, let since = waitingSince else { return false }
        return now.timeIntervalSince(since) > approvalTimeout
    }

    // MARK: What a run does

    /// The ordinary task steps for a routine. Research: search the web, read the top three results, answer from them.
    /// Agents: plan, run the plan, answer. `engine` is the search engine's name, shown in the step so the user can see
    /// where the question goes.
    static func steps(for action: RoutineAction, engine: String) -> [TaskStep] {
        switch action {
        case .research(let q):
            return searchSteps(question: q, engine: engine) + [TaskStep(tool: "ask_model", title: "Answer from the pages", argument: q, risk: .readOnly, idempotencyKey: "ask")]
        case .agents(let r):
            return [TaskStep(tool: "plan_request", title: "Plan the work", argument: r, risk: .readOnly, idempotencyKey: "plan"),
                    TaskStep(tool: "run_plan", title: "Run the plan with the agents", argument: r, risk: .readOnly, idempotencyKey: "run"),
                    TaskStep(tool: "answer_request", title: "Answer from the results", argument: r, risk: .readOnly, idempotencyKey: "answer")]
        }
    }

    /// Search, then read the top three results. Shared with the Research section, so a routine does exactly what a
    /// question typed by hand does.
    static func searchSteps(question q: String, engine: String) -> [TaskStep] {
        [TaskStep(tool: "search_web", title: "Search the web (sends the question to \(engine))", argument: q, risk: .readOnly, idempotencyKey: "search")]
            + (1...3).map { TaskStep(tool: "fetch_search_hit", title: "Read search result \($0)", argument: String($0), risk: .readOnly, idempotencyKey: "src\($0 - 1)") }
    }

    static func taskTitle(for r: Routine) -> String { "Routine: \(r.name)" }
}
