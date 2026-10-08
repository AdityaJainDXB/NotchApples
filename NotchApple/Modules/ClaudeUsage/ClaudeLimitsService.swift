//
//  ClaudeLimitsService.swift
//  Notch apple
//
//  Connects the Claude usage tab to your real limits. Claude Code keeps its sign-in in the macOS keychain; with
//  your permission (you press Connect, and macOS asks you to Allow) Notch apple reads that sign-in and asks
//  Anthropic how much of your 5-hour session and week you have used. The sign-in is kept in memory only, never
//  written anywhere by Notch apple, and used for nothing else. Without it the tab falls back to an estimate
//  from Claude Code's local logs and says so.
//

import Foundation
import SwiftUI

@MainActor
final class ClaudeLimitsService: ObservableObject {
    static let shared = ClaudeLimitsService()
    static let endpoint = URL(string: "https://api.anthropic.com/api/oauth/usage")!

    enum State: Equatable { case notConnected, connecting, connected, failed(String) }

    @Published private(set) var state: State
    /// The limits of the account being shown.
    @Published private(set) var limits: ClaudeLimits?
    @Published private(set) var fetched: Date?
    /// Every Claude account found on this Mac, and the latest limits of each.
    @Published private(set) var accounts: [ClaudeAccount] = []
    @Published private(set) var byAccount: [String: ClaudeLimits] = [:]
    /// The account you picked to show (empty: the first).
    @AppStorage("claudeUsage.account") private var pickedService = ""
    /// True once you have connected; refreshes then happen quietly in the background.
    @AppStorage("claudeUsage.connected") private var wantsConnection = false

    private var credentials: [String: ClaudeLimitsLogic.Credential] = [:]
    private var lastAttempt = Date.distantPast
    private var backoffUntil = Date.distantPast
    private var busy = false

    private init() { state = UserDefaults.standard.bool(forKey: "claudeUsage.connected") ? .connected : .notConnected }

    var isConnected: Bool { wantsConnection }

    var active: ClaudeAccount? { ClaudeAccountLogic.active(accounts, picked: pickedService) }

    func select(_ account: ClaudeAccount) {
        pickedService = account.service
        limits = byAccount[account.service]
        objectWillChange.send()
    }

    enum Failure: Error, Equatable {
        case signedOut, denied, rejected, offline, unreadable, http(Int)
        var message: String {
            switch self {
            case .signedOut: "Claude Code isn't signed in on this Mac. Open Terminal, run `claude`, sign in, then press Connect again."
            case .denied: "macOS didn't let Notch apple read Claude Code's sign-in. Press Connect and choose Allow (or Always Allow)."
            case .rejected: "Claude didn't accept the saved sign-in. Open Claude Code once so it refreshes, then press Retry."
            case .offline: "Couldn't reach Claude. Check your internet connection and press Retry."
            case .unreadable: "Claude answered, but not in a form Notch apple understands. Your estimate is still shown."
            case .http(let code): "Claude's usage service answered with an error (\(code)). Try again in a minute."
            }
        }
    }

    // MARK: What the person does

    /// Press Connect: read Claude Code's sign-in (macOS asks for permission) and fetch the limits.
    func connect() { Task { await run(userInitiated: true) } }

    func disconnect() {
        wantsConnection = false
        credentials = [:]; limits = nil; fetched = nil; byAccount = [:]; accounts = []
        state = .notConnected
    }

    /// Called whenever the tab or the Home card refreshes; quiet, and at most once a minute.
    func refresh() async {
        guard wantsConnection, Date().timeIntervalSince(lastAttempt) >= 60, Date() >= backoffUntil else { return }
        await run(userInitiated: false)
    }

    /// The refresh button: fetch now, ignoring the once-a-minute limit and any earlier back-off.
    func refreshNow() async {
        guard wantsConnection else { return }
        backoffUntil = .distantPast
        await run(userInitiated: false)
    }

    // MARK: Work

    private func run(userInitiated: Bool) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        lastAttempt = Date()
        if userInitiated { state = .connecting; backoffUntil = .distantPast }
        if accounts.isEmpty || userInitiated { accounts = await Self.discoverAccounts() }
        let targets = accounts.isEmpty ? [ClaudeAccount(service: ClaudeLimitsLogic.keychainService, label: "Claude account")] : accounts
        if accounts.isEmpty { accounts = targets }
        var firstFailure: Failure?
        var anySuccess = false
        for account in targets {
            do {
                byAccount[account.service] = try await limits(for: account)
                anySuccess = true
            } catch let failure as Failure {
                credentials[account.service] = nil
                firstFailure = firstFailure ?? failure
            } catch {
                firstFailure = firstFailure ?? .offline
            }
        }
        if anySuccess {
            limits = active.flatMap { byAccount[$0.service] } ?? byAccount.values.first
            fetched = Date(); state = .connected; wantsConnection = true
            for (service, l) in byAccount { recordHistory(service, l) }
        } else if let failure = firstFailure {
            // Keep showing the last good numbers; only say something when asked, or when nothing was ever read.
            if userInitiated || limits == nil { state = .failed(failure.message) }
            if !userInitiated { backoffUntil = Date().addingTimeInterval(600) }   // never nag the keychain every minute
        }
    }

    private func limits(for account: ClaudeAccount) async throws -> ClaudeLimits {
        var cred = credentials[account.service]
        if cred == nil || cred?.isExpired() == true { cred = try await Self.readSignIn(service: account.service) }
        guard var current = cred else { throw Failure.signedOut }
        credentials[account.service] = current
        do { return try await Self.fetchLimits(token: current.token) }
        catch Failure.rejected {
            // The token may have been refreshed by Claude Code since: read it once more.
            current = try await Self.readSignIn(service: account.service)
            credentials[account.service] = current
            return try await Self.fetchLimits(token: current.token)
        }
    }

    private func recordHistory(_ service: String, _ l: ClaudeLimits) {
        let sample = ClaudeUsageSample(account: service, time: Date(), fiveHour: l.fiveHour?.fraction, sevenDay: l.sevenDay?.fraction)
        Self.history = ClaudeHistoryLogic.appended(Self.history, sample)
        Self.saveHistory()
        objectWillChange.send()
    }

    // MARK: History on disk (this Mac only)

    private static var historyURL: URL {
        let dir = (FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory)
            .appendingPathComponent("Notch apple", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("claude-usage-history.json")
    }
    private static var loaded = false
    static var history: [ClaudeUsageSample] = {
        let d = JSONDecoder(); d.dateDecodingStrategy = .secondsSince1970
        return (try? Data(contentsOf: historyURL)).flatMap { try? d.decode([ClaudeUsageSample].self, from: $0) } ?? []
    }()
    private static func saveHistory() {
        let e = JSONEncoder(); e.dateEncodingStrategy = .secondsSince1970
        if let data = try? e.encode(history) { try? data.write(to: historyURL, options: .atomic) }
    }

    /// The last 30 days for the account being shown.
    func days() -> [ClaudeUsageDay] {
        ClaudeHistoryLogic.dailyPeaks(Self.history, account: active?.service ?? ClaudeLimitsLogic.keychainService)
    }

    // MARK: Keychain and network

    /// Finds Claude Code's sign-in: its credentials file, then the keychain (plain name, then `-<hash>` names).
    /// macOS shows its own permission prompt for the keychain.
    nonisolated private static func readSignIn(service: String) async throws -> ClaudeLimitsLogic.Credential {
        try await withCheckedThrowingContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                cont.resume(with: Result { try readSignInNow(service: service) })
            }
        }
    }

    /// Every Claude Code account on this Mac: the plain keychain name and each `-<hash>` name, labelled with the
    /// email Claude Code recorded for its config folder when there is one.
    nonisolated private static func discoverAccounts() async -> [ClaudeAccount] {
        await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                var services: [String] = []
                if let dump = security(["dump-keychain"], timeout: 8), dump.status == 0 {
                    services = ClaudeLimitsLogic.credentialServices(fromDump: String(decoding: dump.out, as: UTF8.self))
                }
                let fm = FileManager.default
                let home = fm.homeDirectoryForCurrentUser.path
                var dirs = [home + "/.claude"]
                dirs += ((try? fm.contentsOfDirectory(atPath: home)) ?? []).filter { $0.hasPrefix(".claude-") }.map { home + "/" + $0 }
                var emails: [String: String] = [:]
                for dir in dirs {
                    // The default folder keeps its settings in ~/.claude.json, the others inside the folder.
                    let file = dir == home + "/.claude" ? home + "/.claude.json" : dir + "/.claude.json"
                    guard let data = fm.contents(atPath: file),
                          let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                          let email = (root["oauthAccount"] as? [String: Any])?["emailAddress"] as? String else { continue }
                    emails[ClaudeAccountLogic.service(forConfigDir: dir, home: home)] = email
                }
                cont.resume(returning: ClaudeAccountLogic.accounts(services: services, emails: emails))
            }
        }
    }

    nonisolated private static func readSignInNow(service: String) throws -> ClaudeLimitsLogic.Credential {
        if service == ClaudeLimitsLogic.keychainService {
            let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/.credentials.json")
            if let data = try? Data(contentsOf: file), let c = ClaudeLimitsLogic.credential(from: data), !c.isExpired() { return c }
        }
        guard let r = security(["find-generic-password", "-s", service, "-w"], timeout: 60) else { throw Failure.denied }
        // 44: no such item. Anything else: the person said no, or the keychain is locked.
        if r.status != 0 { throw r.status == 44 ? Failure.signedOut : Failure.denied }
        guard let c = ClaudeLimitsLogic.credential(from: r.out) else { throw Failure.signedOut }
        return c      // maybe expired: the usage call will say so and we ask to open Claude Code
    }

    /// Runs `/usr/bin/security`, giving up after `timeout` seconds (nil on failure to start or on timeout).
    nonisolated private static func security(_ args: [String], timeout: TimeInterval) -> (status: Int32, out: Data)? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/security")
        p.arguments = args
        let out = Pipe()
        p.standardOutput = out; p.standardError = Pipe(); p.standardInput = FileHandle.nullDevice
        do { try p.run() } catch { return nil }
        var data = Data()
        let reader = DispatchGroup()
        reader.enter()
        DispatchQueue.global().async { data = out.fileHandleForReading.readDataToEndOfFile(); reader.leave() }
        let done = DispatchSemaphore(value: 0)
        DispatchQueue.global().async { p.waitUntilExit(); done.signal() }
        if done.wait(timeout: .now() + timeout) == .timedOut { p.terminate(); return nil }
        reader.wait()
        return (p.terminationStatus, data)
    }

    /// The usage endpoint first; if Anthropic has turned it off, read the same limits from the headers of a
    /// one-token reply (a request that costs almost nothing).
    nonisolated private static func fetchLimits(token: String) async throws -> ClaudeLimits {
        do {
            let data = try await fetch(token: token)
            if let parsed = ClaudeLimitsLogic.parse(data) { return parsed }
        } catch Failure.rejected {
            // A rejected token may only mean the endpoint is off; the headers path settles it.
        } catch Failure.offline { throw Failure.offline }
        catch {}
        return try await fetchFromHeaders(token: token)
    }

    nonisolated private static func fetchFromHeaders(token: String) async throws -> ClaudeLimits {
        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("oauth-2025-04-20", forHTTPHeaderField: "anthropic-beta")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("claude-code/2.1.5", forHTTPHeaderField: "User-Agent")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "model": "claude-haiku-4-5-20251001", "max_tokens": 1,
            "messages": [["role": "user", "content": "hi"]]] as [String: Any])
        let response: URLResponse
        do { (_, response) = try await URLSession.shared.data(for: request) } catch { throw Failure.offline }
        guard let http = response as? HTTPURLResponse else { throw Failure.unreadable }
        // A 429 still carries the headers, and is exactly when the numbers matter.
        let headers = http.allHeaderFields.reduce(into: [String: String]()) { if let k = $1.key as? String, let v = $1.value as? String { $0[k] = v } }
        if let limits = ClaudeLimitsLogic.parse(headers: headers) { return limits }
        switch http.statusCode {
        case 401, 403: throw Failure.rejected
        case 200..<300: throw Failure.unreadable
        default: throw Failure.http(http.statusCode)
        }
    }

    nonisolated private static func fetch(token: String) async throws -> Data {
        var request = URLRequest(url: endpoint)
        request.timeoutInterval = 20
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("oauth-2025-04-20", forHTTPHeaderField: "anthropic-beta")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("NotchApple", forHTTPHeaderField: "User-Agent")
        let data: Data, response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: request) }
        catch { throw Failure.offline }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch status {
        case 200..<300: return data
        case 401, 403: throw Failure.rejected
        default: throw Failure.http(status)
        }
    }
}
