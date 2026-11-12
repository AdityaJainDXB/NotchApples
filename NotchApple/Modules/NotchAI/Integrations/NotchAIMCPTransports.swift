//
//  NotchAIMCPTransports.swift
//  Notch Apple
//
//  How MCP requests reach a server:
//   • HTTPMCPTransport: JSON-RPC over HTTP POST to the server's URL (the answer is JSON or Server-Sent Events). A key, if
//     the user gave one, is sent as a Bearer token; a 401 or 403 means the credentials expired.
//   • StdioMCPTransport: a local command the user chose to add, run only while connected. It talks newline-separated
//     JSON over its stdin/stdout, gets a minimal environment, and is stopped on disconnect and when the app quits.
//
//  Neither opens a listening port, and nothing connects until the user presses Connect.
//

import Foundation

final class HTTPMCPTransport: MCPTransport, @unchecked Sendable {
    private let url: URL
    private let token: String?
    private let lock = NSLock()
    private var sessionID: String?

    init(url: URL, token: String?) { self.url = url; self.token = token }

    func request(_ message: [String: Any]) async throws -> [String: Any] {
        let (data, http) = try await post(message)
        let type = (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
        let body = String(decoding: data, as: UTF8.self)
        if type.contains("text/event-stream") {
            guard let obj = MCPProtocol.jsonResponse(fromSSE: body, id: (message["id"] as? Int) ?? -1) else { throw MCPError.badResponse("no response in the event stream") }
            return obj
        }
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { throw MCPError.badResponse("not JSON") }
        return obj
    }

    private func currentSession() -> String? { lock.lock(); defer { lock.unlock() }; return sessionID }
    private func setSession(_ s: String) { lock.lock(); sessionID = s; lock.unlock() }

    func notify(_ message: [String: Any]) async throws { _ = try await post(message) }
    func close() async {}

    private func post(_ message: [String: Any]) async throws -> (Data, HTTPURLResponse) {
        var r = URLRequest(url: url)
        r.httpMethod = "POST"
        r.timeoutInterval = 60
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
        if let token, !token.isEmpty { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let sid = currentSession() { r.setValue(sid, forHTTPHeaderField: "Mcp-Session-Id") }
        r.httpBody = try JSONSerialization.data(withJSONObject: message)
        let (data, response) = try await URLSession.shared.data(for: r)
        guard let http = response as? HTTPURLResponse else { throw MCPError.badResponse("no HTTP response") }
        if http.statusCode == 401 || http.statusCode == 403 { throw MCPError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw MCPError.badResponse("HTTP \(http.statusCode)") }
        if let s = http.value(forHTTPHeaderField: "Mcp-Session-Id") { setSession(s) }
        return (data, http)
    }
}

final class StdioMCPTransport: MCPTransport, @unchecked Sendable {
    private let process = Process()
    private let input = Pipe()
    private let output = Pipe()
    private let lock = NSLock()
    private var pending: [Int: CheckedContinuation<[String: Any], Error>] = [:]
    private var buffer = Data()

    init(command: String, arguments: [String], environment: [String: String]) throws {
        // Run the command through /usr/bin/env so a plain name like "npx" is found on the user's PATH.
        process.executableURL = URL(fileURLWithPath: command.hasPrefix("/") ? command : "/usr/bin/env")
        process.arguments = command.hasPrefix("/") ? arguments : [command] + arguments
        var env = ["PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin", "HOME": NSHomeDirectory()]
        env.merge(environment) { _, new in new }
        process.environment = env
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        output.fileHandleForReading.readabilityHandler = { [weak self] h in self?.received(h.availableData) }
        process.terminationHandler = { [weak self] _ in self?.failAll(MCPError.badResponse("the connector program stopped")) }
        try process.run()
    }

    private func received(_ data: Data) {
        guard !data.isEmpty else { return }
        lock.lock(); buffer.append(data)
        var lines: [Data] = []
        while let nl = buffer.firstIndex(of: 10) { lines.append(buffer[..<nl]); buffer.removeSubrange(...nl) }
        lock.unlock()
        for line in lines {
            guard let obj = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any], let id = obj["id"] as? Int else { continue }
            lock.lock(); let c = pending.removeValue(forKey: id); lock.unlock()
            c?.resume(returning: obj)
        }
    }

    private func failAll(_ error: Error) {
        lock.lock(); let all = pending; pending = [:]; lock.unlock()
        all.values.forEach { $0.resume(throwing: error) }
    }

    func request(_ message: [String: Any]) async throws -> [String: Any] {
        guard let id = message["id"] as? Int else { throw MCPError.badResponse("a request needs an id") }
        return try await withCheckedThrowingContinuation { cont in
            lock.lock(); pending[id] = cont; lock.unlock()
            do { try write(message) } catch {
                lock.lock(); let c = pending.removeValue(forKey: id); lock.unlock()
                c?.resume(throwing: error)
            }
        }
    }

    func notify(_ message: [String: Any]) async throws { try write(message) }

    private func write(_ message: [String: Any]) throws {
        var data = try JSONSerialization.data(withJSONObject: message)
        data.append(10)
        try input.fileHandleForWriting.write(contentsOf: data)
    }

    func close() async {
        output.fileHandleForReading.readabilityHandler = nil
        if process.isRunning { process.terminate() }
        failAll(MCPError.notConnected)
    }
}
