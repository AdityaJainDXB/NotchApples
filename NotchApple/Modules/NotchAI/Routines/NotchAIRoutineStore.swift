//
//  NotchAIRoutineStore.swift
//  Notch Apple
//
//  Runs routines (see NotchAIRoutineLogic.swift for the rules). A routine only creates an ordinary NotchAI task on the
//  TaskEngine, so approvals, the Local-first guard and recovery behave exactly as for a task started by hand.
//
//  While no routine is switched on there is NO timer and NO network monitor: nothing runs in the background. With at
//  least one, a timer checks once a minute (a Mac that is asleep runs nothing, and one check on waking decides whether a
//  missed run is still worth doing), and a network monitor tells it whether the Mac is online.
//  Saved as JSON in Application Support, so routines survive a restart.
//

import AppKit
import Combine
import Foundation
import Network

@MainActor
final class NotchAIRoutineStore: ObservableObject {
    static let shared = NotchAIRoutineStore()

    @Published private(set) var routines: [Routine] = []
    @Published private(set) var online = true
    @Published private(set) var message: String?

    private let url: URL
    private var timer: Timer?
    private var monitor: NWPathMonitor?
    private var bag = Set<AnyCancellable>()

    private static let encoder: JSONEncoder = { let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; e.outputFormatting = [.prettyPrinted, .sortedKeys]; return e }()
    private static let decoder: JSONDecoder = { let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601; return d }()

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Notch apple", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        url = dir.appendingPathComponent("notchai-routines.json")
        if let data = try? Data(contentsOf: url), let decoded = try? Self.decoder.decode([Routine].self, from: data) { routines = decoded }
        // Read a run's outcome the moment its task changes, so clearing finished tasks cannot hide a failure.
        NotchAITaskStore.shared.$tasks.receive(on: DispatchQueue.main).sink { [weak self] _ in self?.reconcile() }.store(in: &bag)
        NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.didWakeNotification).sink { [weak self] _ in self?.tick() }.store(in: &bag)
        refreshActivity()
        if timer != nil { tick() }
    }

    // MARK: Editing

    /// Adds a routine. Returns a message if it was refused.
    @discardableResult
    func add(_ routine: Routine) -> String? {
        if let problem = RoutineLogic.validate(routine, existingCount: routines.count) { return problem }
        routines.append(RoutineLogic.scheduled(routine, after: Date()))
        save(); refreshActivity()
        return nil
    }

    func remove(_ id: UUID) {
        if let r = routines.first(where: { $0.id == id }), let t = r.lastTaskID, let task = task(t), !task.state.isFinished { NotchAITaskStore.shared.cancel(t) }
        routines.removeAll { $0.id == id }
        save(); refreshActivity()
    }

    func setEnabled(_ id: UUID, _ on: Bool) {
        guard let i = routines.firstIndex(where: { $0.id == id }) else { return }
        routines[i].enabled = on
        if on, routines[i].nextRun == nil, !routines[i].isPaused { routines[i] = RoutineLogic.scheduled(routines[i], after: Date()) }
        save(); refreshActivity()
    }

    func resume(_ id: UUID) {
        guard let i = routines.firstIndex(where: { $0.id == id }) else { return }
        routines[i] = RoutineLogic.resumed(routines[i], now: Date())
        save(); refreshActivity()
    }

    /// Runs it now, without moving its schedule.
    func runNow(_ id: UUID) {
        guard let i = routines.firstIndex(where: { $0.id == id }) else { return }
        message = nil
        if active(routines[i]) { message = "That routine is already running."; return }
        if let why = start(i, now: Date()) { message = why }
    }

    // MARK: Running

    private func task(_ id: UUID) -> NotchAITask? { NotchAITaskStore.shared.tasks.first { $0.id == id } }

    private func active(_ r: Routine) -> Bool {
        guard let id = r.lastTaskID, r.lastOutcome == "Running…" else { return false }
        guard let t = task(id) else { return false }
        return RoutineLogic.outcome(taskState: t.state, error: nil) == nil
    }

    /// Starts the routine's task. Returns a message when it could not start.
    private func start(_ i: Int, now: Date) -> String? {
        let r = routines[i]
        let needed: Tier = { if case .agents = r.action { return .ultimate }; return .pro }()
        guard NotchAITier.allows(needed) else {
            routines[i] = RoutineLogic.paused(r, reason: "\(needed.name) feature, so it was paused. Resume it after unlocking in Settings → License.")
            save(); refreshActivity()
            return routines[i].pausedReason
        }
        let engine = SearchEngineChoice.current()
        if case .research = r.action, engine == .searxng,
           SearXNGSearchProvider.normalizedBase(UserDefaults.standard.string(forKey: SearchEngineChoice.searxngKey) ?? "") == nil {
            routines[i] = RoutineLogic.paused(r, reason: "No SearXNG address is set. Set one in Research, or pick another engine, then resume.")
            save(); refreshActivity()
            return routines[i].pausedReason
        }
        let agent: String = { if case .agents = r.action { return AgentCatalog.planner }; return "research" }()
        let task = NotchAITask(title: RoutineLogic.taskTitle(for: r), agent: agent, steps: RoutineLogic.steps(for: r.action, engine: engine.label))
        guard NotchAITaskStore.shared.start(task) else { return "Too many tasks are running; it will try again in a minute." }
        routines[i] = RoutineLogic.started(r, taskID: task.id, now: now)
        save()
        return nil
    }

    func tick(now: Date = Date()) {
        reconcile(now: now)
        for i in routines.indices {
            switch RoutineLogic.decide(routines[i], now: now, online: online, previousRunActive: active(routines[i])) {
            case .notDue, .wait: break
            case .skipMissed: routines[i] = RoutineLogic.afterSkip(routines[i], now: now); save()
            case .run: _ = start(i, now: now)
            }
        }
        refreshActivity()
    }

    /// Applies the outcome of finished runs and cancels a run nobody approved for an hour.
    private func reconcile(now: Date = Date()) {
        var changed = false
        for i in routines.indices {
            let r = routines[i]
            guard r.lastOutcome == "Running…", let id = r.lastTaskID else { continue }
            guard let t = task(id) else {
                routines[i] = RoutineLogic.finished(r, outcome: .failure("its task was removed before it finished"), now: now); changed = true; continue
            }
            if RoutineLogic.approvalExpired(taskState: t.state, waitingSince: t.updated, now: now) {
                NotchAITaskStore.shared.cancel(id)
                continue
            }
            let error = t.steps.last(where: { $0.state == .failed })?.error
            if let outcome = RoutineLogic.outcome(taskState: t.state, error: error) {
                routines[i] = RoutineLogic.finished(r, outcome: outcome, now: now); changed = true
            }
        }
        if changed { save(); refreshActivity() }
    }

    // MARK: Activity (timer and network monitor exist only while something is switched on)

    private func refreshActivity() {
        let needed = routines.contains { $0.enabled && !$0.isPaused }
        if needed, timer == nil {
            let t = Timer(timeInterval: 60, repeats: true) { [weak self] _ in Task { @MainActor in self?.tick() } }
            t.tolerance = 10
            RunLoop.main.add(t, forMode: .common)
            timer = t
            let m = NWPathMonitor()
            m.pathUpdateHandler = { [weak self] path in
                let ok = path.status == .satisfied
                Task { @MainActor in self?.online = ok }
            }
            m.start(queue: DispatchQueue(label: "notchai.routines.network"))
            monitor = m
        } else if !needed, timer != nil {
            timer?.invalidate(); timer = nil
            monitor?.cancel(); monitor = nil
        }
    }

    private func save() {
        if let data = try? Self.encoder.encode(routines) { try? data.write(to: url, options: .atomic) }
    }
}
