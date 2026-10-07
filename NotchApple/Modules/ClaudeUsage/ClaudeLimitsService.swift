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
    @Published private(set) var limits: ClaudeLimits?
    @Published private(set) var fetched: Date?
    /// True once you have connected; refreshes then happen quietly in the background.
    @AppStorage("claudeUsage.connected") private var wantsConnection = false

    private var credential: ClaudeLimitsLogic.Credential?
    private var lastAttempt = Date.distantPast
    private var backoffUntil = Date.distantPast
    private var busy = false

    private init() { state = UserDefaults.standard.bool(forKey: "claudeUsage.connected") ? .connected : .notConnected }

    var isConnected: Bool { wantsConnection }

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
        credential = nil; limits = nil; fetched = nil
        state = .notConnected
    }

    /// Called whenever the tab or the Home card refreshes; quiet, and at most once a minute.
    func refresh() async {
        guard wantsConnection, Date().timeIntervalSince(lastAttempt) >= 60, Date() >= backoffUntil else { return }
        await run(userInitiated: false)
    }

    // MARK: Work

    private func run(userInitiated: Bool) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        lastAttempt = Date()
        if userInitiated { state = .connecting; backoffUntil = .distantPast }
        do {
            var cred = credential
            if cred == nil || cred?.isExpired() == true { cred = try await Self.readSignIn() }
            guard var current = cred else { throw Failure.signedOut }
            credential = current
            var data: Data
            do { data = try await Self.fetch(token: current.token) }
            catch Failure.rejected {
                // The token may have been refreshed by Claude Code since: read it once more.
                current = try await Self.readSignIn()
                credential = current
                data = try await Self.fetch(token: current.token)
            }
            guard let parsed = ClaudeLimitsLogic.parse(data) else { throw Failure.unreadable }
            limits = parsed; fetched = Date(); state = .connected; wantsConnection = true
        } catch let failure as Failure {
            credential = nil
            // Keep showing the last good numbers; only say something when asked, or when nothing was ever read.
            if userInitiated || limits == nil { state = .failed(failure.message) }
            if !userInitiated { backoffUntil = Date().addingTimeInterval(600) }   // never nag the keychain every minute
        } catch {
            if userInitiated { state = .failed(Failure.offline.message) }
        }
    }

    // MARK: Keychain and network

    /// Reads Claude Code's sign-in with the system `security` tool. macOS shows its own permission prompt.
    nonisolated private static func readSignIn() async throws -> ClaudeLimitsLogic.Credential {
        try await withCheckedThrowingContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/usr/bin/security")
                p.arguments = ["find-generic-password", "-s", "Claude Code-credentials", "-w"]
                let out = Pipe()
                p.standardOutput = out
                p.standardError = Pipe()
                p.standardInput = FileHandle.nullDevice
                do { try p.run() } catch { cont.resume(throwing: Failure.denied); return }
                let data = out.fileHandleForReading.readDataToEndOfFile()
                p.waitUntilExit()
                guard p.terminationStatus == 0 else {
                    // 44: no such item. Anything else: the person said no, or the keychain is locked.
                    cont.resume(throwing: p.terminationStatus == 44 ? Failure.signedOut : Failure.denied)
                    return
                }
                guard let credential = ClaudeLimitsLogic.credential(from: data) else { cont.resume(throwing: Failure.signedOut); return }
                cont.resume(returning: credential)
            }
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
