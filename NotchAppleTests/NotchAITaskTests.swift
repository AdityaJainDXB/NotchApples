//
//  NotchAITaskTests.swift
//  Notch Apple tests
//
//  The task engine with fake tools: ordering, approvals at every permission level, cancellation, retries, timeouts,
//  checkpoints, and recovery after a simulated crash (no step is ever repeated).
//

import XCTest

private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var counts: [String: Int] = [:]
    private var seen: [[String: String]] = []
    func bump(_ k: String) { lock.lock(); counts[k, default: 0] += 1; lock.unlock() }
    func count(_ k: String) -> Int { lock.lock(); defer { lock.unlock() }; return counts[k, default: 0] }
    func sawResults(_ r: [String: String]) { lock.lock(); seen.append(r); lock.unlock() }
    var results: [[String: String]] { lock.lock(); defer { lock.unlock() }; return seen }
}

private final class Recorder: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var snapshots: [NotchAITask] = []
    func add(_ t: NotchAITask) { lock.lock(); snapshots.append(t); lock.unlock() }
}

private struct FakeTool: TaskTool {
    let id: String
    let risk: ToolRisk
    let counter: Counter
    var timeout: TimeInterval? = nil
    var failFirst = 0
    var delay: TimeInterval = 0
    var output: String? = nil
    func run(argument: String, results: [String: String]) async throws -> String {
        counter.bump(id)
        counter.sawResults(results)
        if counter.count(id) <= failFirst { throw NSError(domain: "fake", code: 1, userInfo: [NSLocalizedDescriptionKey: "boom"]) }
        if delay > 0 { try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) }
        return output ?? "\(id):\(argument)"
    }
}

private final class Box<V>: @unchecked Sendable { var v: V?; init() {} }

final class NotchAITaskTests: XCTestCase {
    private func block<T>(_ f: @escaping @Sendable () async -> T) -> T {
        let sem = DispatchSemaphore(value: 0)
        let box = Box<T>()
        Task { box.v = await f(); sem.signal() }
        sem.wait()
        return box.v!
    }

    private func step(_ tool: String, _ key: String, _ arg: String = "") -> TaskStep {
        TaskStep(tool: tool, title: "\(tool) \(key)", argument: arg, risk: .readOnly, idempotencyKey: key)
    }
    private func task(_ steps: [TaskStep]) -> NotchAITask { NotchAITask(title: "T", agent: "test", steps: steps) }

    private func engine(_ tools: [TaskTool], level: PermissionLevel = .askBeforeActing, trusted: Set<String> = [], timeout: TimeInterval = 5,
                        recorder: Recorder = Recorder()) -> TaskEngine {
        TaskEngine(tools: tools, config: .init(level: { level }, trustedTools: { trusted }, stepTimeout: timeout), persist: { recorder.add($0) })
    }

    // MARK: Running

    func testReadOnlyStepsRunInOrderAndSeeEarlierResults() {
        let c = Counter()
        let e = engine([FakeTool(id: "read", risk: .readOnly, counter: c)])
        let t = block { await e.run(self.task([self.step("read", "a", "1"), self.step("read", "b", "2")])) }
        XCTAssertEqual(t.state, .completed)
        XCTAssertEqual(t.steps.map(\.state), [.done, .done])
        XCTAssertEqual(t.steps[0].result, "read:1")
        XCTAssertEqual(c.results.last?["a"], "read:1")            // step b saw step a's result
        XCTAssertEqual(TaskLogic.progress(t), 1)
    }

    func testRiskComesFromTheToolNotTheStep() {
        let c = Counter()
        var s = step("send", "a"); s.risk = .readOnly            // the step lies
        let e = engine([FakeTool(id: "send", risk: .sensitive, counter: c)], level: .suggestOnly)
        let t = block { await e.run(self.task([s])) }
        XCTAssertEqual(t.state, .failed)
        XCTAssertEqual(c.count("send"), 0)
    }

    func testUnknownToolFailsTheTask() {
        let t = block { await self.engine([]).run(self.task([self.step("nope", "a")])) }
        XCTAssertEqual(t.state, .failed)
        XCTAssertEqual(t.steps[0].state, .failed)
    }

    func testInvalidTasksAreRejected() {
        XCTAssertNotNil(TaskLogic.validate(task([])))
        XCTAssertNotNil(TaskLogic.validate(task([step("r", "same"), step("r", "same")])))
        XCTAssertNotNil(TaskLogic.validate(task((1...13).map { step("r", "k\($0)") })))
        var deep = task([step("r", "a")]); deep.depth = 3
        XCTAssertNotNil(TaskLogic.validate(deep))
        XCTAssertNil(TaskLogic.validate(task([step("r", "a")])))
    }

    func testConcurrencyAndDepthLimits() {
        XCTAssertTrue(TaskLogic.canStart(running: 2, depth: 2))
        XCTAssertFalse(TaskLogic.canStart(running: 3, depth: 0))
        XCTAssertFalse(TaskLogic.canStart(running: 0, depth: 3))
    }

    // MARK: Approvals

    func testSuggestOnlyNeverRunsAnAction() {
        let c = Counter()
        let t = block { await self.engine([FakeTool(id: "write", risk: .low, counter: c)], level: .suggestOnly).run(self.task([self.step("write", "a")])) }
        XCTAssertEqual(t.state, .failed)
        XCTAssertEqual(c.count("write"), 0)
    }

    func testAskModeWaitsForApprovalThenRuns() {
        let c = Counter()
        let e = engine([FakeTool(id: "write", risk: .low, counter: c)])
        let t = task([step("write", "a")])
        let done = block { () async -> NotchAITask in
            async let result = e.run(t)
            try? await Task.sleep(nanoseconds: 300_000_000)
            XCTAssertEqual(c.count("write"), 0, "must not run before approval")
            await e.resolveApproval(t.id, approved: true)
            return await result
        }
        XCTAssertEqual(done.state, .completed)
        XCTAssertEqual(c.count("write"), 1)
    }

    func testDenyingStopsTheTaskAndDoesNothing() {
        let c = Counter()
        let e = engine([FakeTool(id: "write", risk: .low, counter: c)])
        let t = task([step("write", "a")])
        let done = block { () async -> NotchAITask in
            async let result = e.run(t)
            try? await Task.sleep(nanoseconds: 300_000_000)
            await e.resolveApproval(t.id, approved: false)
            return await result
        }
        XCTAssertEqual(done.state, .cancelled)
        XCTAssertEqual(done.steps[0].state, .skipped)
        XCTAssertEqual(c.count("write"), 0)
    }

    func testTrustedLowRiskRunsWithoutAskingButSensitiveAlwaysAsks() {
        XCTAssertEqual(TaskLogic.decide(risk: .low, tool: "write", level: .trusted, trustedTools: ["write"]), .allow)
        XCTAssertEqual(TaskLogic.decide(risk: .low, tool: "other", level: .trusted, trustedTools: ["write"]), .ask)
        for risk in [ToolRisk.sensitive, .destructive] {
            XCTAssertEqual(TaskLogic.decide(risk: risk, tool: "x", level: .trusted, trustedTools: ["x"]), .ask)
            XCTAssertEqual(TaskLogic.decide(risk: risk, tool: "x", level: .askBeforeActing, trustedTools: []), .ask)
            if case .deny = TaskLogic.decide(risk: risk, tool: "x", level: .suggestOnly, trustedTools: []) {} else { XCTFail() }
        }
        XCTAssertEqual(TaskLogic.decide(risk: .readOnly, tool: "r", level: .suggestOnly, trustedTools: []), .allow)
    }

    func testCancellingWhileWaitingForApproval() {
        let c = Counter()
        let e = engine([FakeTool(id: "write", risk: .low, counter: c)])
        let t = task([step("write", "a")])
        let done = block { () async -> NotchAITask in
            async let result = e.run(t)
            try? await Task.sleep(nanoseconds: 300_000_000)
            await e.cancel(t.id)
            return await result
        }
        XCTAssertEqual(done.state, .cancelled)
        XCTAssertEqual(c.count("write"), 0)
    }

    // MARK: Retries and timeouts

    func testAReadThatFailsOnceIsRetried() {
        let c = Counter()
        let t = block { await self.engine([FakeTool(id: "read", risk: .readOnly, counter: c, failFirst: 1)]).run(self.task([self.step("read", "a")])) }
        XCTAssertEqual(t.state, .completed)
        XCTAssertEqual(c.count("read"), 2)
    }

    func testAReadThatKeepsFailingFailsTheTask() {
        let c = Counter()
        let t = block { await self.engine([FakeTool(id: "read", risk: .readOnly, counter: c, failFirst: 5)]).run(self.task([self.step("read", "a")])) }
        XCTAssertEqual(t.state, .failed)
        XCTAssertEqual(c.count("read"), 2)       // one try, one retry
        XCTAssertEqual(t.steps[0].error, "boom")
    }

    func testAnActionThatFailsIsNeverRetried() {
        let c = Counter()
        let e = engine([FakeTool(id: "write", risk: .low, counter: c, failFirst: 5)], level: .trusted, trusted: ["write"])
        let t = block { await e.run(self.task([self.step("write", "a")])) }
        XCTAssertEqual(t.state, .failed)
        XCTAssertEqual(c.count("write"), 1)
    }

    func testAStepThatTakesTooLongIsStopped() {
        let c = Counter()
        let t = block { await self.engine([FakeTool(id: "read", risk: .readOnly, counter: c, delay: 5)], timeout: 0.2).run(self.task([self.step("read", "a")])) }
        XCTAssertEqual(t.state, .failed)
        XCTAssertTrue(t.steps[0].error?.contains("too long") == true)
    }

    func testAToolCanAskForALongerTimeThanTheDefault() {
        let c = Counter()
        let t = block { await self.engine([FakeTool(id: "slow", risk: .readOnly, counter: c, timeout: 3, delay: 0.5)], timeout: 0.2).run(self.task([self.step("slow", "a")])) }
        XCTAssertEqual(t.state, .completed, "its own 3 s limit applies, not the engine's 0.2 s")
    }

    func testAToolCanAlsoHaveAShorterLimit() {
        let c = Counter()
        let t = block { await self.engine([FakeTool(id: "quick", risk: .readOnly, counter: c, timeout: 0.2, delay: 5)], timeout: 30).run(self.task([self.step("quick", "a")])) }
        XCTAssertEqual(t.state, .failed)
        XCTAssertTrue(t.steps[0].error?.contains("too long") == true)
    }

    // MARK: Checkpoints and recovery

    func testTheTaskIsCheckpointedBeforeEachStepRuns() {
        let rec = Recorder()
        let c = Counter()
        _ = block { await self.engine([FakeTool(id: "read", risk: .readOnly, counter: c)], recorder: rec).run(self.task([self.step("read", "a")])) }
        XCTAssertTrue(rec.snapshots.contains { $0.steps[0].state == .running }, "a snapshot with the step in flight must be saved")
        XCTAssertEqual(rec.snapshots.last?.state, .completed)
    }

    func testCrashDuringAReadResumesWithoutRepeatingFinishedSteps() {
        let c = Counter()
        var t = task([step("read", "a"), step("read", "b")])
        t.state = .running
        t.steps[0].state = .done; t.steps[0].result = "read:done-before-crash"
        t.steps[1].state = .running                                  // in flight when the app died
        let recovered = TaskLogic.recover(t)
        XCTAssertEqual(recovered.state, .paused)
        XCTAssertEqual(recovered.steps.map(\.state), [.done, .pending])
        let final = block { await self.engine([FakeTool(id: "read", risk: .readOnly, counter: c)]).run(recovered) }
        XCTAssertEqual(final.state, .completed)
        XCTAssertEqual(c.count("read"), 1, "only step b may run; step a was already done")
        XCTAssertEqual(final.steps[0].result, "read:done-before-crash")
    }

    func testCrashDuringAnActionIsNotRepeated() {
        let c = Counter()
        var t = task([step("write", "a"), step("write", "b")])
        t.state = .running
        t.steps[0].risk = .low; t.steps[1].risk = .low
        t.steps[0].state = .running                                  // may or may not have happened
        let recovered = TaskLogic.recover(t)
        XCTAssertEqual(recovered.state, .failed)
        XCTAssertEqual(recovered.steps[0].state, .failed)
        XCTAssertTrue(recovered.steps[0].error?.contains("not repeated") == true)
        let e = engine([FakeTool(id: "write", risk: .low, counter: c)], level: .trusted, trusted: ["write"])
        let final = block { await e.run(recovered) }          // resuming must not redo the interrupted step either
        XCTAssertEqual(c.count("write"), 1)                           // only step b ran
        XCTAssertEqual(final.steps[0].state, .failed)
    }

    func testRecoveryLeavesFinishedTasksAlone() {
        for s in [TaskState.completed, .failed, .cancelled, .paused] {
            var t = task([step("read", "a")]); t.state = s
            XCTAssertEqual(TaskLogic.recover(t), t)
        }
    }

    func testRetryingFailedStepsKeepsFinishedOnes() {
        var t = task([step("read", "a"), step("read", "b")])
        t.state = .failed
        t.steps[0].state = .done; t.steps[0].result = "kept"
        t.steps[1].state = .failed; t.steps[1].error = "x"; t.steps[1].attempts = 2
        let r = TaskLogic.retrying(t)
        XCTAssertEqual(r.state, .queued)
        XCTAssertEqual(r.steps.map(\.state), [.done, .pending])
        XCTAssertEqual(r.steps[1].attempts, 0)
        XCTAssertEqual(r.steps[0].result, "kept")
    }

    func testTasksSurviveEncoding() throws {
        var t = task([step("read", "a")]); t.log.append(TaskLogEntry(date: Date(timeIntervalSince1970: 5), text: "hi"))
        let enc = JSONEncoder(); enc.dateEncodingStrategy = .secondsSince1970
        let dec = JSONDecoder(); dec.dateDecodingStrategy = .secondsSince1970
        XCTAssertEqual(try dec.decode(NotchAITask.self, from: enc.encode(t)).steps, t.steps)
    }

    // MARK: Talking to an agent about a finished task

    private func finished(_ title: String = "Compare two topics", result: String? = "A is older than B.", state: TaskState = .completed, updated: Date = .now, depth: Int = 0) -> NotchAITask {
        var s = TaskStep(tool: "answer_request", title: "Answer", argument: "q", risk: .readOnly, idempotencyKey: "a")
        s.state = result == nil ? .failed : .done; s.result = result
        var t = NotchAITask(title: title, agent: "research", steps: [s]); t.state = state; t.updated = updated; t.depth = depth
        return t
    }

    func testChatMessagesAreTrimmedCappedAndEmptyOnesIgnored() {
        var chat = AgentChatLogic.appended(nil, role: .user, text: "  hi  ")
        XCTAssertEqual(chat.map(\.text), ["hi"])
        XCTAssertEqual(AgentChatLogic.appended(chat, role: .agent, text: "   ").count, 1)
        XCTAssertEqual(AgentChatLogic.appended(nil, role: .user, text: String(repeating: "x", count: 9000))[0].text.count, AgentChatLogic.maxLength)
        for i in 0..<60 { chat = AgentChatLogic.appended(chat, role: .user, text: "m\(i)") }
        XCTAssertEqual(chat.count, AgentChatLogic.maxMessages)
        XCTAssertEqual(chat.last?.text, "m59")
    }

    func testOnlyACompletedTaskWithAResultCanBeFollowedUp() {
        XCTAssertTrue(AgentChatLogic.canFollowUp(finished()))
        XCTAssertFalse(AgentChatLogic.canFollowUp(finished(result: nil, state: .failed)))
        XCTAssertFalse(AgentChatLogic.canFollowUp(finished(state: .running)))
        XCTAssertFalse(AgentChatLogic.canFollowUp(finished(state: .cancelled)))
    }

    func testAFollowUpGoesToTheTaskItWasSentFromOtherwiseTheMostRecentFinishedOne() {
        let old = finished("Old", updated: Date(timeIntervalSince1970: 100)), new = finished("New", updated: Date(timeIntervalSince1970: 200))
        let running = finished("Busy", state: .running, updated: Date(timeIntervalSince1970: 300))
        let child = finished("Child", updated: Date(timeIntervalSince1970: 400), depth: 1)
        let all = [old, new, running, child]
        XCTAssertEqual(AgentChatLogic.target(explicit: old.id, tasks: all), old.id)
        XCTAssertEqual(AgentChatLogic.target(explicit: nil, tasks: all), new.id, "not the running task, not a child")
        XCTAssertEqual(AgentChatLogic.target(explicit: UUID(), tasks: all), new.id, "an unknown task falls back")
        XCTAssertNil(AgentChatLogic.target(explicit: nil, tasks: [running]))
    }

    func testTheAgentIsShownWhatItFoundAndTheConversationSoFar() {
        var t = finished()
        t.chat = AgentChatLogic.appended(AgentChatLogic.appended(nil, role: .user, text: "Which is older?"), role: .agent, text: "A.")
        let p = AgentChatLogic.prompt(task: t, question: "By how much?")
        XCTAssertTrue(p.contains("A is older than B."))
        XCTAssertTrue(p.contains("User: Which is older?") && p.contains("You: A."))
        XCTAssertTrue(p.contains("By how much?") && p.contains("say so instead of guessing"))
        t.steps[0].result = String(repeating: "z", count: 20_000)
        XCTAssertLessThan(AgentChatLogic.prompt(task: t, question: "q").count, 8000)
    }

    func testATaskSavedBeforeChatsExistedStillLoads() throws {
        var t = finished(); t.chat = nil
        let e = JSONEncoder(), d = JSONDecoder()
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: e.encode(t)) as? [String: Any])
        json["chat"] = nil
        let back = try d.decode(NotchAITask.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertNil(back.chat)
        XCTAssertEqual(back.title, t.title)
    }
}
