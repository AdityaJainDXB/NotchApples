//
//  NotchAIMCPTests.swift
//  Notch Apple tests
//
//  The MCP client against an in-process fake server: the handshake, tool discovery (paged and refreshed), calls,
//  error mapping, expired credentials, and the permission rules for connector tools in the task engine.
//

import XCTest

private final class FakeServer: MCPTransport, @unchecked Sendable {
    private let lock = NSLock()
    var tools: [[String: Any]] = [["name": "list_issues", "description": "Lists issues", "inputSchema": ["type": "object"]],
                                  ["name": "create_issue", "description": "Creates an issue", "inputSchema": ["type": "object"]]]
    var pageSize = 100
    var unauthorized = false
    var failInitialize = false
    var received: [String] = []
    var calls: [(String, [String: Any])] = []
    var closed = false

    func request(_ m: [String: Any]) async throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        let method = m["method"] as? String ?? ""
        received.append(method)
        if unauthorized { throw MCPError.unauthorized }
        let id = m["id"] as? Int ?? 0
        func ok(_ r: [String: Any]) -> [String: Any] { ["jsonrpc": "2.0", "id": id, "result": r] }
        switch method {
        case "initialize":
            if failInitialize { return ["jsonrpc": "2.0", "id": id, "error": ["code": -32000, "message": "nope"]] }
            return ok(["protocolVersion": MCPProtocol.version, "capabilities": ["tools": [String: Any]()], "serverInfo": ["name": "fake", "version": "1"]])
        case "tools/list":
            let cursor = (m["params"] as? [String: Any])?["cursor"] as? String
            let start = cursor.flatMap { Int($0) } ?? 0
            let page = Array(tools[start..<min(start + pageSize, tools.count)])
            var r: [String: Any] = ["tools": page]
            if start + pageSize < tools.count { r["nextCursor"] = String(start + pageSize) }
            return ok(r)
        case "tools/call":
            let p = m["params"] as? [String: Any] ?? [:]
            let name = p["name"] as? String ?? ""
            let args = p["arguments"] as? [String: Any] ?? [:]
            calls.append((name, args))
            if name == "explode" { return ok(["isError": true, "content": [["type": "text", "text": "it broke"]]]) }
            if name == "missing" { return ["jsonrpc": "2.0", "id": id, "error": ["code": -32602, "message": "unknown tool"]] }
            return ok(["content": [["type": "text", "text": "ran \(name) with \(args.count) args"], ["type": "image", "data": "x"]]])
        default:
            return ["jsonrpc": "2.0", "id": id, "error": ["code": -32601, "message": "no such method"]]
        }
    }

    func notify(_ m: [String: Any]) async throws { lock.lock(); received.append(m["method"] as? String ?? ""); lock.unlock() }
    func close() async { lock.lock(); closed = true; lock.unlock() }
}

private final class Box<V>: @unchecked Sendable { var v: V?; init() {} }

final class NotchAIMCPTests: XCTestCase {
    private func block<T>(_ f: @escaping @Sendable () async -> T) -> T {
        let sem = DispatchSemaphore(value: 0); let box = Box<T>()
        Task { box.v = await f(); sem.signal() }; sem.wait(); return box.v!
    }

    func testHandshakeThenDiscovery() {
        let s = FakeServer(); let c = MCPClient(transport: s)
        let state = block { await c.connect() }
        XCTAssertEqual(state, .connected)
        XCTAssertEqual(s.received, ["initialize", "notifications/initialized", "tools/list"])
        let names = block { await c.tools.map(\.name) }
        XCTAssertEqual(names, ["list_issues", "create_issue"])
    }

    func testPagedToolListsAreCombined() {
        let s = FakeServer(); s.pageSize = 1
        let c = MCPClient(transport: s)
        _ = block { await c.connect() }
        XCTAssertEqual(block { await c.tools.count }, 2)
        XCTAssertEqual(s.received.filter { $0 == "tools/list" }.count, 2)
    }

    func testToolsCanAppearLater() {
        let s = FakeServer(); let c = MCPClient(transport: s)
        _ = block { await c.connect() }
        s.tools.append(["name": "close_issue", "description": "x", "inputSchema": ["type": "object"]])
        block { try? await c.refreshTools() }
        XCTAssertTrue(block { await c.tools.map(\.name) }.contains("close_issue"))
    }

    func testCallingAToolReturnsItsTextAndMarksImages() {
        let s = FakeServer(); let c = MCPClient(transport: s)
        _ = block { await c.connect() }
        let out = block { try? await c.call("list_issues", arguments: ["repo": "x", "state": "open"]) }
        XCTAssertEqual(out, "ran list_issues with 2 args\n[an image was returned and not shown]")
        XCTAssertEqual(s.calls.first?.0, "list_issues")
    }

    func testToolAndProtocolErrorsAreReportedNotHidden() {
        let s = FakeServer(); let c = MCPClient(transport: s)
        _ = block { await c.connect() }
        let a = block { () async -> String in do { _ = try await c.call("explode", arguments: [:]); return "no error" } catch { return error.localizedDescription } }
        XCTAssertEqual(a, "it broke")
        let b = block { () async -> String in do { _ = try await c.call("missing", arguments: [:]); return "no error" } catch { return error.localizedDescription } }
        XCTAssertTrue(b.contains("-32602"))
    }

    func testAFailedHandshakeIsFailedNotConnected() {
        let s = FakeServer(); s.failInitialize = true
        let c = MCPClient(transport: s)
        let state = block { await c.connect() }
        if case .failed(let m) = state { XCTAssertTrue(m.contains("nope")) } else { XCTFail("\(state)") }
        XCTAssertEqual(block { await c.tools.count }, 0)
    }

    func testRefusedCredentialsMeanExpired() {
        let s = FakeServer(); s.unauthorized = true
        let c = MCPClient(transport: s)
        XCTAssertEqual(block { await c.connect() }, .expired)
        XCTAssertEqual(MCPConnectionState.expired.title, "Expired")
    }

    func testCredentialsThatExpireLaterMoveToExpiredAndStopCalls() {
        let s = FakeServer(); let c = MCPClient(transport: s)
        _ = block { await c.connect() }
        s.unauthorized = true
        _ = block { try? await c.call("list_issues", arguments: [:]) }
        XCTAssertEqual(block { await c.state }, .expired)
        let again = block { () async -> String in do { _ = try await c.call("list_issues", arguments: [:]); return "ran" } catch { return error.localizedDescription } }
        XCTAssertTrue(again.contains("not connected"))
    }

    func testDisconnectClosesTheTransportAndForgetsTools() {
        let s = FakeServer(); let c = MCPClient(transport: s)
        _ = block { await c.connect() }
        block { await c.disconnect() }
        XCTAssertTrue(s.closed)
        XCTAssertEqual(block { await c.state }, .disconnected)
        XCTAssertEqual(block { await c.tools.count }, 0)
    }

    func testCallBeforeConnectingIsRefused() {
        let c = MCPClient(transport: FakeServer())
        let r = block { () async -> String in do { _ = try await c.call("x", arguments: [:]); return "ran" } catch { return error.localizedDescription } }
        XCTAssertTrue(r.contains("not connected"))
    }

    func testSSEResponsesAreUnderstood() {
        let body = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\ndata: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"ok\":true}}\n\n"
        XCTAssertNotNil(MCPProtocol.jsonResponse(fromSSE: body, id: 7))
        XCTAssertNil(MCPProtocol.jsonResponse(fromSSE: body, id: 8))
    }

    // MARK: Names, permissions and the engine

    func testToolIDs() {
        XCTAssertEqual(MCPNaming.toolID(server: "github", tool: "list_issues"), "mcp.github.list_issues")
        XCTAssertEqual(MCPNaming.parse("mcp.github.list.issues")?.server, "github")
        XCTAssertEqual(MCPNaming.parse("mcp.github.list.issues")?.tool, "list.issues")
        XCTAssertNil(MCPNaming.parse("search_web"))
        XCTAssertNil(MCPNaming.parse("mcp.nodot"))
    }

    func testConnectorToolsAskUnlessTheUserMarkedThemReadOnly() {
        let c = MCPClient(transport: FakeServer())
        let info = MCPToolInfo(name: "t", description: "", inputSchema: "{}")
        func risk(_ p: MCPToolPermission) -> ToolRisk { MCPToolAdapter(id: "mcp.s.t", server: "s", info: info, client: c, permission: p).risk }
        XCTAssertEqual(risk(.ask), .sensitive)
        XCTAssertEqual(risk(.readOnly), .readOnly)
        XCTAssertEqual(risk(.blocked), .destructive)
        // sensitive always asks, even at the "trusted" level
        XCTAssertEqual(TaskLogic.decide(risk: risk(.ask), tool: "mcp.s.t", level: .trusted, trustedTools: ["mcp.s.t"]), .ask)
    }

    func testABlockedToolNeverCallsTheServer() {
        let s = FakeServer(); let c = MCPClient(transport: s)
        _ = block { await c.connect() }
        let a = MCPToolAdapter(id: "mcp.s.list_issues", server: "s", info: MCPToolInfo(name: "list_issues", description: "", inputSchema: "{}"), client: c, permission: .blocked)
        let r = block { () async -> String in do { _ = try await a.run(argument: "{}", results: [:]); return "ran" } catch { return error.localizedDescription } }
        XCTAssertTrue(r.contains("blocked"))
        XCTAssertTrue(s.calls.isEmpty)
    }

    func testArgumentsMustBeAJSONObject() {
        let s = FakeServer(); let c = MCPClient(transport: s)
        _ = block { await c.connect() }
        let a = MCPToolAdapter(id: "mcp.s.list_issues", server: "s", info: MCPToolInfo(name: "list_issues", description: "", inputSchema: "{}"), client: c, permission: .readOnly)
        XCTAssertNil(block { try? await a.run(argument: "not json", results: [:]) })
        XCTAssertEqual(block { try? await a.run(argument: "{\"a\":1}", results: [:]) }, "ran list_issues with 1 args\n[an image was returned and not shown]")
        XCTAssertEqual(s.calls.count, 1)
    }

    func testAConnectorToolRunsInTheTaskEngineOnlyAfterApproval() {
        let s = FakeServer(); let c = MCPClient(transport: s)
        _ = block { await c.connect() }
        let adapter = MCPToolAdapter(id: "mcp.s.create_issue", server: "s", info: MCPToolInfo(name: "create_issue", description: "", inputSchema: "{}"), client: c, permission: .ask)
        let registry = MCPToolRegistry()
        registry.replace(server: "s", with: [adapter])
        let engine = TaskEngine(tools: [], config: .init(level: { .askBeforeActing }, trustedTools: { [] }, stepTimeout: 5, dynamicTool: { registry.tool($0) }), persist: { _ in })
        let task = NotchAITask(title: "t", agent: "x", steps: [TaskStep(tool: "mcp.s.create_issue", title: "Create", argument: "{\"title\":\"hi\"}", risk: .readOnly, idempotencyKey: "a")])
        let final = block { () async -> NotchAITask in
            async let result = engine.run(task)
            try? await Task.sleep(nanoseconds: 300_000_000)
            XCTAssertTrue(s.calls.isEmpty, "must not call the service before approval")
            await engine.resolveApproval(task.id, approved: true)
            return await result
        }
        XCTAssertEqual(final.state, .completed)
        XCTAssertEqual(s.calls.count, 1)
        XCTAssertEqual(final.steps[0].risk, .sensitive)
    }

    func testTheRegistryReplacesAndRemovesAServersTools() {
        let c = MCPClient(transport: FakeServer())
        func a(_ server: String, _ tool: String) -> MCPToolAdapter {
            MCPToolAdapter(id: MCPNaming.toolID(server: server, tool: tool), server: server, info: MCPToolInfo(name: tool, description: "", inputSchema: "{}"), client: c, permission: .ask)
        }
        let r = MCPToolRegistry()
        r.replace(server: "a", with: [a("a", "x"), a("a", "y")]); r.replace(server: "b", with: [a("b", "z")])
        XCTAssertEqual(r.ids, ["mcp.a.x", "mcp.a.y", "mcp.b.z"])
        r.replace(server: "a", with: [a("a", "x")])
        XCTAssertEqual(r.ids, ["mcp.a.x", "mcp.b.z"])
        r.remove(server: "b")
        XCTAssertEqual(r.ids, ["mcp.a.x"])
    }

    func testAccessSummary() {
        XCTAssertEqual(MCPNaming.accessSummary([]), "No tools reported.")
        XCTAssertTrue(MCPNaming.accessSummary([MCPToolInfo(name: "a", description: "", inputSchema: "{}")]).hasPrefix("Can use 1 tool: a"))
    }

    func testServerIDsFromNames() {
        XCTAssertEqual(MCPNaming.slug(from: "My GitHub Server!"), "my-github-server")
        XCTAssertEqual(MCPNaming.slug(from: "123 tools"), "s123-tools")
        XCTAssertTrue(MCPNaming.isValidServerID(MCPNaming.slug(from: "Notion (work)")))
        XCTAssertFalse(MCPNaming.isValidServerID("Bad Id"))
        XCTAssertFalse(MCPNaming.isValidServerID("a"))
        XCTAssertLessThanOrEqual(MCPNaming.slug(from: String(repeating: "x", count: 80)).count, 31)
    }
}
