//
//  NotchAIAgentSupportTests.swift
//  Notch Apple tests
//
//  Per-agent usage, browser script building (including injection attempts) and the child-tool policy of the engine.
//

import XCTest

final class NotchAIAgentSupportTests: XCTestCase {
    private func task(_ agent: String, _ results: [String], state: StepState = .done, secs: TimeInterval = 0) -> NotchAITask {
        var t = NotchAITask(title: "t", agent: agent, steps: results.enumerated().map {
            TaskStep(tool: "x", title: "s", argument: "abcd", risk: .readOnly, idempotencyKey: "k\($0.offset)", state: state, result: $0.element) })
        t.started = Date(timeIntervalSince1970: 0); t.finished = Date(timeIntervalSince1970: secs)
        return t
    }

    func testUsageIsSummedPerAgentFromWhatReallyRan() {
        let u = AgentUsageLogic.summary([task("research", ["12345678"], secs: 4), task("research", ["abcd"], state: .failed, secs: 2), task("file", ["x"])])
        let r = u.first { $0.agent == "research" }!
        XCTAssertEqual(r.tasks, 2)
        XCTAssertEqual(r.stepsDone, 1)
        XCTAssertEqual(r.stepsFailed, 1)
        XCTAssertEqual(r.estimatedTokens, 1 + 2 + 1 + 1)         // each "abcd" argument = 1; results "12345678" = 2, "abcd" = 1
        XCTAssertEqual(r.seconds, 6, accuracy: 0.001)
        XCTAssertEqual(u.first?.agent, "research")                // busiest first
    }

    func testBrowserScriptEscapingCannotBreakOutOfTheString() {
        let evil = "x\" & (do shell script \"echo pwned\") & \"\nmore\\"
        let e = BrowserScripts.escape(evil)
        XCTAssertFalse(e.contains("\n"))
        XCTAssertEqual(e, "x\\\" & (do shell script \\\"echo pwned\\\") & \\\" more\\\\")
        var inString = true, escaped = false
        for ch in e { if escaped { escaped = false } else if ch == "\\" { escaped = true } else if ch == "\"" { inString = false } }
        XCTAssertTrue(inString, "every quote must be escaped")
    }

    func testOnlyPublicWebAddressesAreOpened() {
        XCTAssertEqual(BrowserScripts.open(URL(string: "https://example.com/a?b=1")!, in: .safari),
                       "tell application \"Safari\" to open location \"https://example.com/a?b=1\"")
        XCTAssertNil(BrowserScripts.open(URL(string: "file:///etc/passwd")!, in: .chrome))
        XCTAssertNil(BrowserScripts.open(URL(string: "http://localhost:11434")!, in: .chrome))
        XCTAssertNil(BrowserScripts.open(URL(string: "http://192.168.1.1/")!, in: .arc))
    }

    func testReadScriptsDifferByBrowser() {
        XCTAssertTrue(BrowserScripts.readFrontTab(in: .safari).contains("do JavaScript"))
        XCTAssertTrue(BrowserScripts.readFrontTab(in: .chrome).contains("execute active tab of front window javascript"))
        XCTAssertTrue(BrowserScripts.readFrontTab(in: .brave).contains("Brave Browser"))
    }

    func testBrowserDetectionAndTabParsing() {
        XCTAssertEqual(BrowserKind.from(bundleID: "com.apple.Safari"), .safari)
        XCTAssertEqual(BrowserKind.from(bundleID: "company.thebrowser.Browser"), .arc)
        XCTAssertNil(BrowserKind.from(bundleID: "com.apple.dt.Xcode"))
        XCTAssertNil(BrowserKind.from(bundleID: nil))
        let p = BrowserScripts.parseTab("https://a.com\nA title\nline1\nline2")!
        XCTAssertEqual(p.url, "https://a.com"); XCTAssertEqual(p.title, "A title"); XCTAssertEqual(p.text, "line1\nline2")
        XCTAssertNil(BrowserScripts.parseTab(""))
    }
}

private final class Count: @unchecked Sendable { var n = 0 }
private final class Box<V>: @unchecked Sendable { var v: V?; init() {} }
private struct PolicyTool: TaskTool {
    let id: String
    let c: Count
    var risk: ToolRisk { .readOnly }
    func run(argument: String, results: [String: String]) async throws -> String { c.n += 1; return "ok" }
}

final class NotchAIChildPolicyTests: XCTestCase {
    private func run(_ t: NotchAITask, policy: Set<String>?) -> NotchAITask {
        let c = Count()
        let e = TaskEngine(tools: [PolicyTool(id: "agent_ask", c: c), PolicyTool(id: "read_file", c: c)],
                           config: .init(level: { .askBeforeActing }, trustedTools: { [] }, stepTimeout: 5, childToolPolicy: { _ in policy }), persist: { _ in })
        let sem = DispatchSemaphore(value: 0); let box = Box<NotchAITask>()
        Task { box.v = await e.run(t); sem.signal() }; sem.wait()
        return box.v!
    }

    private func child(_ tool: String, depth: Int) -> NotchAITask {
        var t = NotchAITask(title: "c", agent: "research", steps: [TaskStep(tool: tool, title: tool, argument: "x", risk: .readOnly, idempotencyKey: "s0")])
        t.depth = depth; return t
    }

    func testAChildCannotUseAToolItsAgentDoesNotHave() {
        let r = run(child("read_file", depth: 1), policy: ["agent_ask"])
        XCTAssertEqual(r.state, .failed)
        XCTAssertTrue(r.steps[0].error?.contains("not allowed") == true)
    }

    func testAChildMayUseItsOwnTools() {
        XCTAssertEqual(run(child("agent_ask", depth: 1), policy: ["agent_ask"]).state, .completed)
    }

    func testTopLevelTasksAreNotRestrictedByTheChildPolicy() {
        XCTAssertEqual(run(child("read_file", depth: 0), policy: ["agent_ask"]).state, .completed)
    }
}
