//
//  NotchAIMCP.swift
//  Notch Apple
//
//  MCP connectors: the Model Context Protocol (JSON-RPC 2.0) client NotchAI uses to reach tools in other services the
//  user connects. Foundation only, so it is unit tested against an in-process fake server.
//
//   • MCPClient: initialize, discover tools (and refresh them), call a tool, and report a connection state:
//     disconnected, connecting, connected, expired (the server answered 401/403), failed.
//   • MCPToolAdapter: turns a discovered tool into a TaskTool so it runs through the normal task engine. EVERY
//     connector tool asks for approval (sensitive) unless the user marked that specific tool read-only; a tool the
//     user blocked cannot run at all.
//   • Transports (HTTP, local command) are separate and live in the app; this file only speaks the protocol.
//
//  A connector can only do what its tools do. What it can reach is shown to the user from the tool names and
//  descriptions the server itself reports.
//

import Foundation

struct MCPToolInfo: Equatable, Sendable {
    var name: String
    var description: String
    var inputSchema: String      // JSON text of the tool's input schema
}

enum MCPConnectionState: Equatable, Sendable {
    case disconnected, connecting, connected
    case expired                 // credentials were refused (401/403): reconnect with new credentials
    case failed(String)

    var title: String {
        switch self {
        case .disconnected: "Disconnected"
        case .connecting: "Connecting"
        case .connected: "Connected"
        case .expired: "Expired"
        case .failed: "Failed"
        }
    }
}

enum MCPError: LocalizedError, Equatable {
    case unauthorized
    case server(code: Int, message: String)
    case badResponse(String)
    case notConnected
    case toolFailed(String)
    case blocked

    var errorDescription: String? {
        switch self {
        case .unauthorized: "The service refused the credentials. Reconnect with a new key or sign in again."
        case .server(let c, let m): "The service reported an error (\(c)): \(m)"
        case .badResponse(let m): "The service sent something unexpected: \(m)"
        case .notConnected: "That connector is not connected."
        case .toolFailed(let m): m
        case .blocked: "You blocked this connector tool."
        }
    }
}

/// How requests reach one server. The protocol layer is transport-agnostic.
protocol MCPTransport: Sendable {
    /// Sends a request and returns the matching JSON-RPC response object.
    func request(_ message: [String: Any]) async throws -> [String: Any]
    /// Sends a notification (no response expected).
    func notify(_ message: [String: Any]) async throws
    func close() async
}

enum MCPProtocol {
    static let version = "2025-03-26"

    static func initialize(id: Int) -> [String: Any] {
        ["jsonrpc": "2.0", "id": id, "method": "initialize",
         "params": ["protocolVersion": version, "capabilities": [String: Any](), "clientInfo": ["name": "Notch Apple", "version": "1"]]]
    }
    static let initialized: [String: Any] = ["jsonrpc": "2.0", "method": "notifications/initialized"]
    static func listTools(id: Int, cursor: String? = nil) -> [String: Any] {
        ["jsonrpc": "2.0", "id": id, "method": "tools/list", "params": cursor.map { ["cursor": $0] } ?? [String: Any]()]
    }
    static func callTool(id: Int, name: String, arguments: [String: Any]) -> [String: Any] {
        ["jsonrpc": "2.0", "id": id, "method": "tools/call", "params": ["name": name, "arguments": arguments]]
    }

    /// The `result` of a response, or the error it carries.
    static func result(of response: [String: Any]) throws -> [String: Any] {
        if let e = response["error"] as? [String: Any] {
            throw MCPError.server(code: (e["code"] as? Int) ?? 0, message: (e["message"] as? String) ?? "unknown")
        }
        guard let r = response["result"] as? [String: Any] else { throw MCPError.badResponse("no result") }
        return r
    }

    static func tools(from result: [String: Any]) throws -> (tools: [MCPToolInfo], next: String?) {
        guard let list = result["tools"] as? [[String: Any]] else { throw MCPError.badResponse("no tools list") }
        let infos = list.compactMap { t -> MCPToolInfo? in
            guard let name = t["name"] as? String, !name.isEmpty else { return nil }
            let schema = (t["inputSchema"]).flatMap { try? JSONSerialization.data(withJSONObject: $0, options: [.sortedKeys]) }.map { String(decoding: $0, as: UTF8.self) } ?? "{}"
            return MCPToolInfo(name: name, description: (t["description"] as? String) ?? "", inputSchema: schema)
        }
        return (infos, result["nextCursor"] as? String)
    }

    /// The text of a tool call's result. A result flagged `isError` is an error.
    static func text(fromCall result: [String: Any]) throws -> String {
        let parts = (result["content"] as? [[String: Any]]) ?? []
        let text = parts.compactMap { p -> String? in
            switch p["type"] as? String {
            case "text": return p["text"] as? String
            case "image": return "[an image was returned and not shown]"
            case "resource": return (p["resource"] as? [String: Any])?["text"] as? String
            default: return nil
            }
        }.joined(separator: "\n")
        if (result["isError"] as? Bool) == true { throw MCPError.toolFailed(text.isEmpty ? "The tool reported an error." : text) }
        return text
    }

    /// A server may answer with Server-Sent Events; this finds the JSON response in them.
    static func jsonResponse(fromSSE body: String, id: Int) -> [String: Any]? {
        for line in body.components(separatedBy: "\n") {
            guard line.hasPrefix("data:") else { continue }
            let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            if let obj = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any], (obj["id"] as? Int) == id { return obj }
        }
        return nil
    }
}

actor MCPClient {
    private let transport: MCPTransport
    private var nextID = 1
    private(set) var state: MCPConnectionState = .disconnected
    private(set) var tools: [MCPToolInfo] = []

    init(transport: MCPTransport) { self.transport = transport }

    private func id() -> Int { defer { nextID += 1 }; return nextID }

    /// initialize, then discover tools. Moves through connecting to connected, expired or failed.
    @discardableResult
    func connect() async -> MCPConnectionState {
        state = .connecting
        do {
            _ = try MCPProtocol.result(of: try await transport.request(MCPProtocol.initialize(id: id())))
            try await transport.notify(MCPProtocol.initialized)
            try await loadTools()
            state = .connected
        } catch { state = Self.state(for: error) }
        return state
    }

    /// Asks the server for its tools again (dynamic discovery: tools can appear or go away).
    func refreshTools() async throws {
        guard state == .connected else { throw MCPError.notConnected }
        do { try await loadTools() } catch { state = Self.state(for: error); throw error }
    }

    private func loadTools() async throws {
        var all: [MCPToolInfo] = []
        var cursor: String?
        for _ in 0..<20 {                                        // pages, bounded
            let r = try MCPProtocol.result(of: try await transport.request(MCPProtocol.listTools(id: id(), cursor: cursor)))
            let page = try MCPProtocol.tools(from: r)
            all += page.tools
            guard let next = page.next else { break }
            cursor = next
        }
        tools = all
    }

    func call(_ name: String, arguments: [String: Any]) async throws -> String {
        guard state == .connected else { throw MCPError.notConnected }
        do {
            return try MCPProtocol.text(fromCall: try MCPProtocol.result(of: try await transport.request(MCPProtocol.callTool(id: id(), name: name, arguments: arguments))))
        } catch let e as MCPError {
            if case .unauthorized = e { state = .expired }
            throw e
        } catch { state = Self.state(for: error); throw error }
    }

    func disconnect() async {
        await transport.close()
        state = .disconnected
        tools = []
    }

    private static func state(for error: Error) -> MCPConnectionState {
        if let e = error as? MCPError, e == .unauthorized { return .expired }
        return .failed((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
    }
}

// MARK: - Permissions and the TaskTool adapter

enum MCPToolPermission: String, Codable, CaseIterable, Identifiable {
    case ask, readOnly, blocked
    var id: String { rawValue }
    var title: String {
        switch self { case .ask: "Ask each time"; case .readOnly: "Read-only (runs without asking)"; case .blocked: "Blocked" }
    }
}

enum MCPNaming {
    /// The id a connector tool has in tasks and plans: mcp.<server>.<tool>.
    static func toolID(server: String, tool: String) -> String { "mcp.\(server).\(tool)" }

    static func parse(_ toolID: String) -> (server: String, tool: String)? {
        guard toolID.hasPrefix("mcp.") else { return nil }
        let rest = toolID.dropFirst(4)
        guard let dot = rest.firstIndex(of: "."), dot != rest.startIndex else { return nil }
        let tool = rest[rest.index(after: dot)...]
        return tool.isEmpty ? nil : (String(rest[..<dot]), String(tool))
    }

    /// A server id from a name: lowercase letters, digits, - and _, starting with a letter.
    static func slug(from name: String) -> String {
        var s = name.lowercased().map { $0.isLetter && $0.isASCII || $0.isNumber && $0.isASCII ? String($0) : "-" }.joined()
        while s.contains("--") { s = s.replacingOccurrences(of: "--", with: "-") }
        s = s.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        if let f = s.first, !f.isLetter { s = "s" + s }
        return String(s.prefix(31))
    }

    static func isValidServerID(_ id: String) -> Bool { id.range(of: "^[a-z][a-z0-9_-]{1,30}$", options: .regularExpression) != nil }

    /// A short plain description of what a connector can reach, from what the server says its tools are.
    static func accessSummary(_ tools: [MCPToolInfo]) -> String {
        guard !tools.isEmpty else { return "No tools reported." }
        return "Can use \(tools.count) tool\(tools.count == 1 ? "" : "s"): " + tools.prefix(8).map(\.name).joined(separator: ", ") + (tools.count > 8 ? "…" : "")
    }
}

struct MCPToolAdapter: TaskTool {
    let id: String
    let server: String
    let info: MCPToolInfo
    let client: MCPClient
    let permission: MCPToolPermission

    /// Sensitive (always asks) unless the user marked this one tool read-only. A blocked tool is destructive-level so
    /// it can never be trusted, and it refuses to run anyway.
    var risk: ToolRisk {
        switch permission { case .readOnly: .readOnly; case .ask: .sensitive; case .blocked: .destructive }
    }

    func run(argument: String, results: [String: String]) async throws -> String {
        guard permission != .blocked else { throw MCPError.blocked }
        let args: [String: Any]
        let trimmed = argument.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { args = [:] }
        else if let obj = (try? JSONSerialization.jsonObject(with: Data(trimmed.utf8))) as? [String: Any] { args = obj }
        else { throw MCPError.badResponse("the input must be a JSON object of arguments") }
        return try await client.call(info.name, arguments: args)
    }
}

/// The connector tools that exist right now, for the engine to look up by id (dynamic: connecting a server adds its tools).
final class MCPToolRegistry: @unchecked Sendable {
    static let shared = MCPToolRegistry()
    private let lock = NSLock()
    private var tools: [String: TaskTool] = [:]

    func replace(server: String, with new: [MCPToolAdapter]) {
        lock.lock(); defer { lock.unlock() }
        tools = tools.filter { MCPNaming.parse($0.key)?.server != server }
        for t in new { tools[t.id] = t }
    }
    func remove(server: String) { replace(server: server, with: []) }
    func tool(_ id: String) -> TaskTool? { lock.lock(); defer { lock.unlock() }; return tools[id] }
    var ids: Set<String> { lock.lock(); defer { lock.unlock() }; return Set(tools.keys) }
}
