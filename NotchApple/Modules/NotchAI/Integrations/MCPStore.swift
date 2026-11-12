//
//  MCPStore.swift
//  Notch Apple
//
//  The connectors the user added (a remote MCP address, or a local command), their connection state, and what each
//  tool is allowed to do (ask each time, read-only, or blocked). The list lives in Application Support; any key lives
//  in the app's private secrets store (KeychainHelper), never in the list. Nothing connects until the user presses
//  Connect; Disconnect (or quitting) stops it. Integrations are a Pro feature.
//

import Foundation
import SwiftUI

struct MCPServerConfig: Codable, Identifiable, Equatable {
    enum Kind: String, Codable { case remote, local }
    var id: String
    var name: String
    var kind: Kind
    var url: String = ""
    var command: String = ""
    var arguments: [String] = []
    /// Per-tool permissions by tool name; a tool not listed asks each time.
    var permissions: [String: MCPToolPermission] = [:]
}

@MainActor
final class MCPStore: ObservableObject {
    static let shared = MCPStore()

    @Published private(set) var servers: [MCPServerConfig] = []
    @Published private(set) var states: [String: MCPConnectionState] = [:]
    @Published private(set) var tools: [String: [MCPToolInfo]] = [:]
    @Published private(set) var problem: String?

    private var clients: [String: MCPClient] = [:]
    private let url: URL

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Notch apple", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        url = dir.appendingPathComponent("notchai-connectors.json")
        if let data = try? Data(contentsOf: url), let saved = try? JSONDecoder().decode([MCPServerConfig].self, from: data) { servers = saved }
        NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.disconnectAll() }
        }
    }

    // MARK: Secrets (the key for a server, in the app's private store)

    private var tokens: [String: String] {
        get { KeychainHelper.get(.mcpTokens).flatMap { try? JSONDecoder().decode([String: String].self, from: Data($0.utf8)) } ?? [:] }
        set { KeychainHelper.set(String(decoding: (try? JSONEncoder().encode(newValue)) ?? Data("{}".utf8), as: UTF8.self), for: .mcpTokens) }
    }

    // MARK: Adding and removing

    @discardableResult
    func addRemote(name: String, address: String, key: String) -> Bool {
        guard let u = URL(string: address.trimmingCharacters(in: .whitespaces)), ["http", "https"].contains(u.scheme?.lowercased() ?? ""), u.host != nil else {
            problem = "Enter a web address starting with http:// or https://."; return false
        }
        return add(MCPServerConfig(id: MCPNaming.slug(from: name), name: name, kind: .remote, url: u.absoluteString), key: key)
    }

    @discardableResult
    func addLocal(name: String, command: String, arguments: String) -> Bool {
        let c = command.trimmingCharacters(in: .whitespaces)
        guard !c.isEmpty else { problem = "Enter the command to run."; return false }
        let args = arguments.split(separator: " ").map(String.init)
        return add(MCPServerConfig(id: MCPNaming.slug(from: name), name: name, kind: .local, command: c, arguments: args), key: "")
    }

    private func add(_ s: MCPServerConfig, key: String) -> Bool {
        guard NotchAITier.allows(.pro) else { problem = NotchAITier.lockedMessage(.pro); return false }
        guard MCPNaming.isValidServerID(s.id), !servers.contains(where: { $0.id == s.id }) else { problem = "Pick a different name (it must be unique)."; return false }
        servers.append(s)
        if !key.isEmpty { tokens[s.id] = key }
        problem = nil; save()
        return true
    }

    func remove(_ id: String) {
        disconnect(id)
        servers.removeAll { $0.id == id }
        var t = tokens; t.removeValue(forKey: id); tokens = t
        save()
    }

    // MARK: Connecting

    func connect(_ id: String) {
        guard let s = servers.first(where: { $0.id == id }) else { return }
        guard NotchAITier.allows(.pro) else { problem = NotchAITier.lockedMessage(.pro); return }
        problem = nil
        states[id] = .connecting
        let transport: MCPTransport
        do {
            switch s.kind {
            case .remote:
                guard let u = URL(string: s.url) else { states[id] = .failed("bad address"); return }
                transport = HTTPMCPTransport(url: u, token: tokens[id])
            case .local:
                transport = try StdioMCPTransport(command: s.command, arguments: s.arguments, environment: [:])
            }
        } catch { states[id] = .failed(error.localizedDescription); return }
        let client = MCPClient(transport: transport)
        clients[id] = client
        Task {
            let state = await client.connect()
            states[id] = state
            if state == .connected { publish(id, client: client) } else { MCPToolRegistry.shared.remove(server: id) }
            tools[id] = state == .connected ? await client.tools : []
        }
    }

    func refresh(_ id: String) {
        guard let client = clients[id] else { return }
        Task {
            do { try await client.refreshTools(); publish(id, client: client); tools[id] = await client.tools }
            catch { states[id] = await client.state; problem = error.localizedDescription }
        }
    }

    func disconnect(_ id: String) {
        MCPToolRegistry.shared.remove(server: id)
        let client = clients.removeValue(forKey: id)
        states[id] = .disconnected; tools[id] = []
        Task { await client?.disconnect() }
    }

    func disconnectAll() { for id in Array(clients.keys) { disconnect(id) } }

    func setPermission(_ id: String, tool: String, _ p: MCPToolPermission) {
        guard let i = servers.firstIndex(where: { $0.id == id }) else { return }
        servers[i].permissions[tool] = p
        save()
        if let client = clients[id] { Task { publish(id, client: client) } }
    }

    private func publish(_ id: String, client: MCPClient) {
        guard let server = servers.first(where: { $0.id == id }) else { return }
        Task {
            let infos = await client.tools
            let adapters = infos.map { info in
                MCPToolAdapter(id: MCPNaming.toolID(server: id, tool: info.name), server: id, info: info, client: client,
                               permission: server.permissions[info.name] ?? .ask)
            }
            MCPToolRegistry.shared.replace(server: id, with: adapters)
        }
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(servers) else { return }
        try? data.write(to: url, options: [.atomic])
    }
}
