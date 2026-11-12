//
//  NotchAIAgentTests.swift
//  Notch Apple tests
//
//  Agents, plan validation and the orchestrator end to end: a fake planner model, the real task engine with fake
//  tools, parallel waves, dependency substitution, failure handling, plan repair and recovery reuse. Nothing touches
//  the Mac, the network or a model.
//

import XCTest

private final class Log: @unchecked Sendable {
    private let lock = NSLock()
    private var lines: [String] = []
    private var running = 0, peak = 0
    func add(_ s: String) { lock.lock(); lines.append(s); lock.unlock() }
    func enter() { lock.lock(); running += 1; peak = max(peak, running); lock.unlock() }
    func leave() { lock.lock(); running -= 1; lock.unlock() }
    var all: [String] { lock.lock(); defer { lock.unlock() }; return lines }
    var maxConcurrent: Int { lock.lock(); defer { lock.unlock() }; return peak }
}

private struct ScriptedPlanner: PlannerModel {
    let replies: [String]
    let log: Log
    func complete(system: String, user: String) async throws -> String {
        log.add("planner call \(log.all.filter { $0.hasPrefix("planner call") }.count + 1)")
        let n = log.all.filter { $0.hasPrefix("planner call") }.count
        return replies[min(n - 1, replies.count - 1)]
    }
}

private struct EchoTool: TaskTool {
    let id: String
    let log: Log
    var fail = false
    var delay: TimeInterval = 0
    var risk: ToolRisk { .readOnly }
    func run(argument: String, results: [String: String]) async throws -> String {
        log.enter(); defer { log.leave() }
        log.add("\(id):\(argument)")
        if delay > 0 { try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) }
        if fail { throw NSError(domain: "t", code: 1, userInfo: [NSLocalizedDescriptionKey: "tool broke"]) }
        return "\(id)-result(\(argument))"
    }
}

/// Runs child tasks on a real engine, at the same time, like the app's store does.
private struct EngineRunner: ChildRunner {
    let engine: TaskEngine
    func run(_ children: [NotchAITask]) async -> [NotchAITask] {
        await withTaskGroup(of: NotchAITask.self) { group in
            for c in children { group.addTask { await engine.run(c) } }
            var out: [NotchAITask] = []
            for await t in group { out.append(t) }
            return out
        }
    }
}

private final class Box<V>: @unchecked Sendable { var v: V?; init() {} }

final class NotchAIAgentTests: XCTestCase {
    private let tools: Set<String> = ["search_web", "fetch_page", "read_file", "search_document", "agent_ask", "read_screen", "browser_open", "browser_read", "computer_task", "speak"]
    private var agents: [AgentSpec] { AgentCatalog.builtIn }

    private func block<T>(_ f: @escaping @Sendable () async -> T) -> T {
        let sem = DispatchSemaphore(value: 0)
        let box = Box<T>()
        Task { box.v = await f(); sem.signal() }
        sem.wait()
        return box.v!
    }

    private func step(_ agent: String, _ tool: String, _ arg: String, _ deps: [Int] = []) -> PlanStep {
        PlanStep(agent: agent, tool: tool, argument: arg, title: "\(agent) \(tool)", dependsOn: deps)
    }

    // MARK: Agents

    func testEveryBuiltInAgentOnlyUsesRealToolsAndTheComputerAgentOnlyComputerTask() {
        for a in AgentCatalog.builtIn { XCTAssertTrue(Set(a.tools).isSubset(of: tools), "\(a.id) has an unknown tool") }
        XCTAssertEqual(agents.first { $0.id == "computer" }?.tools, ["computer_task"])
        XCTAssertEqual(Set(agents.map(\.id)).count, agents.count)
        XCTAssertEqual(Set(agents.map(\.id)), ["planner", "research", "file", "screen", "coding", "browser", "computer", "voice"])
    }

    func testCustomAgentValidation() {
        let ok = AgentSpec(id: "summariser", name: "Summariser", role: "r", systemPrompt: "Summarise.", tools: ["agent_ask"])
        XCTAssertEqual(AgentCatalog.problems(in: ok, knownTools: tools, existingIDs: []), [])
        var bad = ok; bad.id = "Bad Id"; bad.tools = ["rm_rf"]; bad.systemPrompt = " "; bad.timeoutSeconds = 1
        XCTAssertEqual(AgentCatalog.problems(in: bad, knownTools: tools, existingIDs: []).count, 4)
        XCTAssertFalse(AgentCatalog.problems(in: ok, knownTools: tools, existingIDs: ["summariser"]).isEmpty)
    }

    func testACustomAgentCannotReplaceABuiltInOne() {
        let fake = AgentSpec(id: "research", name: "Evil", role: "", systemPrompt: "x", tools: ["computer_task"])
        let merged = AgentCatalog.merged(custom: [fake, AgentSpec(id: "mine", name: "Mine", role: "", systemPrompt: "x", tools: [])])
        XCTAssertEqual(merged.filter { $0.id == "research" }.count, 1)
        XCTAssertEqual(merged.first { $0.id == "research" }?.name, "Research agent")
        XCTAssertNotNil(merged.first { $0.id == "mine" })
    }

    // MARK: Plan parsing and validation

    func testPlansAreFoundInFencedOrChattyReplies() {
        let json = #"{"steps":[{"agent":"research","tool":"search_web","argument":"macbook air","title":"Search"}]}"#
        for reply in [json, "Here you go:\n```json\n\(json)\n```\nDone!"] {
            if case .success(let p) = PlanLogic.parse(reply) { XCTAssertEqual(p.steps.count, 1) } else { XCTFail(reply) }
        }
        if case .failure(.noJSON) = PlanLogic.parse("I cannot do that") {} else { XCTFail() }
        if case .failure(.badJSON) = PlanLogic.parse(#"{"steps": "nope"}"#) {} else { XCTFail() }
    }

    func testValidationRefusesEveryKindOfBadPlan() {
        func problems(_ steps: [PlanStep]) -> [String] { PlanLogic.problems(AgentPlan(steps: steps), agents: agents, knownTools: tools) }
        XCTAssertEqual(problems([]), ["The plan has no steps."])
        XCTAssertTrue(problems([step("ghost", "agent_ask", "x")]).first!.contains("no agent"))
        XCTAssertTrue(problems([step("research", "rm_rf", "x")]).first!.contains("no tool"))
        XCTAssertTrue(problems([step("research", "read_file", "x")]).first!.contains("does not have"))     // real tool, wrong agent
        XCTAssertTrue(problems([step("research", "agent_ask", " ")]).first!.contains("argument"))
        XCTAssertTrue(problems([step("research", "agent_ask", "x", [0])]).first!.contains("earlier"))       // self / forward dependency
        XCTAssertTrue(problems([step("research", "agent_ask", "x"), step("research", "agent_ask", "{{0}}")]).first!.contains("does not depend"))
        XCTAssertTrue(problems((0..<9).map { _ in step("research", "agent_ask", "x") }).first!.contains("Too many"))
        XCTAssertEqual(problems([step("research", "search_web", "x"), step("research", "agent_ask", "{{0}}", [0])]), [])
    }

    func testADisabledAgentIsRefused() {
        var a = agents; a[a.firstIndex { $0.id == "research" }!].enabled = false
        XCTAssertFalse(PlanLogic.problems(AgentPlan(steps: [step("research", "search_web", "x")]), agents: a, knownTools: tools).isEmpty)
    }

    func testWavesGroupIndependentStepsAndOrderDependentOnes() {
        let plan = AgentPlan(steps: [step("research", "search_web", "a"), step("research", "search_web", "b"),
                                     step("research", "agent_ask", "{{0}} {{1}}", [0, 1]), step("voice", "speak", "{{2}}", [2])])
        XCTAssertEqual(PlanLogic.waves(plan), [[0, 1], [2], [3]])
    }

    func testPlaceholderSubstitutionCutsLongResults() {
        XCTAssertEqual(PlanLogic.substituted("A {{0}} B {{1}}", results: [0: "x", 1: "y"]), "A x B y")
        XCTAssertEqual(PlanLogic.substituted("{{0}}", results: [0: String(repeating: "z", count: 50)], limit: 10), String(repeating: "z", count: 10))
        XCTAssertEqual(PlanLogic.placeholders(in: "{{2}} and {{10}}"), [2, 10])
    }

    func testPlannerPromptListsOnlyUsableAgentsAndForbidsActions() {
        var a = agents; a[a.firstIndex { $0.id == "voice" }!].enabled = false
        let p = PlanLogic.plannerPrompt(request: "R", agents: a, toolDescriptions: ["search_web": "Wikipedia search"])
        XCTAssertTrue(p.contains("research:"))
        XCTAssertTrue(p.contains("search_web (Wikipedia search)"))
        XCTAssertFalse(p.contains("- planner:"))
        XCTAssertFalse(p.contains("- voice:"))
        XCTAssertTrue(p.contains("Never plan to send, buy, delete, install"))
    }

    // MARK: Orchestrator end to end

    private func engine(_ log: Log, extra: [TaskTool] = []) -> TaskEngine {
        let t: [TaskTool] = [EchoTool(id: "search_web", log: log, delay: 0.25), EchoTool(id: "agent_ask", log: log),
                             EchoTool(id: "speak", log: log)] + extra
        return TaskEngine(tools: t, config: .init(level: { .askBeforeActing }, trustedTools: { [] }, stepTimeout: 5), persist: { _ in })
    }

    func testPlanningRepairsARefusedPlanOnce() {
        let log = Log()
        let bad = #"{"steps":[{"agent":"research","tool":"read_file","argument":"x","title":"t"}]}"#
        let good = #"{"steps":[{"agent":"research","tool":"search_web","argument":"x","title":"t"}]}"#
        let plan = block { try? await AgentOrchestratorCore.plan(request: "r", agents: self.agents, knownTools: self.tools, toolDescriptions: [:],
                                                                    model: ScriptedPlanner(replies: [bad, good], log: log)) }
        XCTAssertEqual(plan?.steps.first?.tool, "search_web")
        XCTAssertEqual(log.all.filter { $0.hasPrefix("planner call") }.count, 2)
    }

    func testAPlanThatStaysInvalidIsAnErrorAndNothingRuns() {
        let log = Log()
        let bad = #"{"steps":[{"agent":"ghost","tool":"x","argument":"x","title":"t"}]}"#
        let result = block { () async -> String in
            do { _ = try await AgentOrchestratorCore.plan(request: "r", agents: self.agents, knownTools: self.tools, toolDescriptions: [:],
                                                          model: ScriptedPlanner(replies: [bad], log: log)); return "planned" }
            catch { return error.localizedDescription }
        }
        XCTAssertTrue(result.contains("refused"), result)
        XCTAssertEqual(log.all.filter { $0.hasPrefix("planner call") }.count, 2)      // one try, one repair, then stop
    }

    func testIndependentStepsRunInParallelAndDependentOnesSeeTheirResults() {
        let log = Log()
        let plan = AgentPlan(steps: [step("research", "search_web", "air"), step("research", "search_web", "pro"),
                                     step("research", "agent_ask", "compare {{0}} and {{1}}", [0, 1])], finalQuestion: "Which is better?")
        let report = block { await AgentOrchestratorCore.execute(plan: plan, parentID: UUID(), parentDepth: 0, runner: EngineRunner(engine: self.engine(log))) }
        XCTAssertTrue(report.succeeded)
        XCTAssertEqual(log.maxConcurrent, 2, "the two searches must overlap")
        XCTAssertEqual(report.results[2], "agent_ask-result(compare search_web-result(air) and search_web-result(pro))")
        let ask = log.all.firstIndex { $0.hasPrefix("agent_ask") }!
        XCTAssertTrue(log.all[..<ask].contains { $0.hasPrefix("search_web:air") } && log.all[..<ask].contains { $0.hasPrefix("search_web:pro") })
    }

    func testNoMoreThanThreeRunAtOnce() {
        let log = Log()
        let plan = AgentPlan(steps: (0..<6).map { step("research", "search_web", "q\($0)") })
        let report = block { await AgentOrchestratorCore.execute(plan: plan, parentID: nil, parentDepth: 0, runner: EngineRunner(engine: self.engine(log))) }
        XCTAssertEqual(report.results.count, 6)
        XCTAssertLessThanOrEqual(log.maxConcurrent, 3)
    }

    func testAFailedStepIsReportedAndItsDependentsAreNotRun() {
        let log = Log()
        let eng = TaskEngine(tools: [EchoTool(id: "search_web", log: log, fail: true), EchoTool(id: "agent_ask", log: log)],
                             config: .init(level: { .askBeforeActing }, trustedTools: { [] }, stepTimeout: 5), persist: { _ in })
        let plan = AgentPlan(steps: [step("research", "search_web", "a"), step("research", "agent_ask", "use {{0}}", [0]), step("research", "agent_ask", "independent")])
        let report = block { await AgentOrchestratorCore.execute(plan: plan, parentID: nil, parentDepth: 0, runner: EngineRunner(engine: eng)) }
        XCTAssertEqual(report.failures[0], "tool broke")
        XCTAssertTrue(report.failures[1]?.contains("Not run") == true)
        XCTAssertNotNil(report.results[2], "an independent branch still runs")
        XCTAssertFalse(log.all.contains { $0.hasPrefix("agent_ask:use") })
        let prompt = AgentOrchestratorCore.answerPrompt(request: "R", plan: plan, report: report)
        XCTAssertTrue(prompt.contains("FAILED — tool broke"))
        XCTAssertTrue(prompt.contains("independent"))
        XCTAssertTrue(prompt.contains("say what is missing instead of guessing"))
    }

    func testChildTasksAreOneDeeperThanTheirParentAndCarryTheirAgent() {
        final class Capture: ChildRunner, @unchecked Sendable {
            var seen: [NotchAITask] = []
            func run(_ children: [NotchAITask]) async -> [NotchAITask] { seen += children; return children.map { var c = $0; c.state = .completed; c.steps[0].result = "ok"; return c } }
        }
        let cap = Capture(); let parent = UUID()
        _ = block { await AgentOrchestratorCore.execute(plan: AgentPlan(steps: [self.step("voice", "speak", "hi")]), parentID: parent, parentDepth: 1, runner: cap) }
        XCTAssertEqual(cap.seen.first?.depth, 2)
        XCTAssertEqual(cap.seen.first?.agent, "voice")
        XCTAssertEqual(cap.seen.first?.parentID, parent)
        XCTAssertNil(TaskLogic.validate(cap.seen[0]))
    }

    func testChildReuseNeverRepeatsFinishedWork() {
        var t = NotchAITask(title: "c", agent: "research", steps: [TaskStep(tool: "x", title: "x", argument: "", risk: .readOnly, idempotencyKey: "s0", state: .done, result: "R")])
        XCTAssertEqual(ChildReuse.decision(for: nil), .startNew)
        t.state = .completed; XCTAssertEqual(ChildReuse.decision(for: t), .reuse("R"))
        t.state = .paused; XCTAssertEqual(ChildReuse.decision(for: t), .resume)
        t.state = .failed; XCTAssertEqual(ChildReuse.decision(for: t), .startNew)
        t.state = .cancelled; XCTAssertEqual(ChildReuse.decision(for: t), .startNew)
    }

    func testAWholeOrchestrationFromRequestToAnswerPrompt() {
        let log = Log()
        let plan = #"{"steps":[{"agent":"research","tool":"search_web","argument":"macbook air battery","title":"Battery"},{"agent":"research","tool":"search_web","argument":"macbook air speed","title":"Speed"},{"agent":"research","tool":"agent_ask","argument":"Summarise {{0}} {{1}}","title":"Summary","dependsOn":[0,1]}],"finalQuestion":"Write a short comparison."}"#
        let prompt = block { () async -> String in
            let p = try! await AgentOrchestratorCore.plan(request: "Compare MacBook Air battery and speed", agents: self.agents, knownTools: self.tools,
                                                          toolDescriptions: [:], model: ScriptedPlanner(replies: [plan], log: log))
            let r = await AgentOrchestratorCore.execute(plan: p, parentID: UUID(), parentDepth: 0, runner: EngineRunner(engine: self.engine(log)))
            return AgentOrchestratorCore.answerPrompt(request: "Compare MacBook Air battery and speed", plan: p, report: r)
        }
        XCTAssertTrue(prompt.contains("Write a short comparison."))
        XCTAssertTrue(prompt.contains("[Step 2] Summary"))
        XCTAssertTrue(prompt.contains("search_web-result(macbook air battery)"))
        XCTAssertFalse(prompt.contains("FAILED"))
    }
}
