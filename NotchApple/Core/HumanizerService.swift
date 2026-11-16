//
//  HumanizerService.swift
//  Notch Apple
//
//  Runs the Humanizer with the model chosen in NotchAI (Local first still applies) and keeps the word count on this Mac.
//  Used by the Humanizer page in Tools and by the Humanize button under NotchAI replies. The rules are in HumanizerLogic.swift.
//

import Foundation

@MainActor
final class HumanizerService: ObservableObject {
    static let shared = HumanizerService()
    private static let key = "humanizer.usage"

    @Published private(set) var usage: HumanizerLogic.Usage
    @Published private(set) var busy = false

    init() {
        let stored = UserDefaults.standard.data(forKey: Self.key).flatMap { try? JSONDecoder().decode(HumanizerLogic.Usage.self, from: $0) }
        usage = HumanizerLogic.current(stored, now: Date())
    }

    var tier: Tier { Entitlements.shared.tier }
    private var now: HumanizerLogic.Usage { HumanizerLogic.current(usage, now: Date()) }
    var monthlyLeft: Int { HumanizerLogic.monthlyLeft(now, tier: tier) }
    var credits: Int { now.credits }
    var perRequestLimit: Int? { HumanizerLogic.perRequestLimit(for: tier) }
    /// "2,100 of 3,000 words left this month".
    var summary: String {
        let f = NumberFormatter(); f.numberStyle = .decimal
        func n(_ v: Int) -> String { f.string(from: NSNumber(value: v)) ?? "\(v)" }
        let base = "\(n(monthlyLeft)) of \(n(HumanizerLogic.monthlyAllowance(for: tier))) words left this month"
        return credits > 0 ? "\(base) + \(n(credits)) extra" : base
    }

    /// Whether `text` may go through now, and the sentence to show when it may not.
    func check(_ text: String) -> (ok: Bool, message: String?) {
        let d = HumanizerLogic.decide(words: HumanizerLogic.wordCount(text), tier: tier, usage: now)
        if case .allowed = d { return (true, nil) }
        return (false, HumanizerLogic.message(for: d, tier: tier))
    }

    enum Failure: LocalizedError {
        case stopped(String)
        var errorDescription: String? { if case .stopped(let m) = self { m } else { nil } }
    }

    /// Rewrites `text`. Throws a sentence for the person when a limit or the model stops it; the words are counted only when a rewrite comes back.
    func humanize(_ text: String) async throws -> String {
        let words = HumanizerLogic.wordCount(text)
        let decision = HumanizerLogic.decide(words: words, tier: tier, usage: now)
        if let message = HumanizerLogic.message(for: decision, tier: tier) { throw Failure.stopped(message) }
        guard !busy else { throw Failure.stopped("Already working on one. Wait a moment.") }
        let config = AIConfig.shared
        guard config.provider.isConfigured else { throw Failure.stopped("Choose an AI model in Settings → AI first.") }
        busy = true
        defer { busy = false }
        try await NotchAIGuard.check(provider: config.provider, model: config.model)
        var reply = ""
        let asked = [ChatMessage(role: .user, text: HumanizerLogic.userMessage(text))]
        for try await piece in AIClient.stream(asked, provider: config.provider, model: config.model, system: HumanizerLogic.system) { reply += piece }
        let out = HumanizerLogic.clean(reply)
        guard !out.isEmpty else { throw Failure.stopped("The model sent nothing back. Try again.") }
        usage = HumanizerLogic.applying(decision, to: now)
        if let data = try? JSONEncoder().encode(usage) { UserDefaults.standard.set(data, forKey: Self.key) }
        return out
    }
}
