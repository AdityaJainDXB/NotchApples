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

    /// Redeems a top-up code (emailed after buying extra words on Whop). The server accepts each code once and says how many words
    /// it holds; they are added to this Mac's extra words, which never run out with the month. Returns a sentence for the person.
    func redeem(_ raw: String) async -> String {
        let code = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else { return "Enter the code from your email." }
        guard let base = await LicenseServer.url() else { return "Couldn't reach the server. Check your connection and try again." }
        var r = URLRequest(url: base.appendingPathComponent("humanizer/redeem"), timeoutInterval: 30)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "content-type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["code": code, "device": Self.deviceID])
        guard let (data, response) = try? await URLSession.shared.data(for: r) else { return "Couldn't reach the server. Check your connection and try again." }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (response as? HTTPURLResponse)?.statusCode == 200, let words = json["words"] as? Int, words > 0 else {
            return (json["error"] as? String) ?? "That code didn't work. Check it and try again."
        }
        var u = now
        u.credits += words
        usage = u
        if let data = try? JSONEncoder().encode(u) { UserDefaults.standard.set(data, forKey: Self.key) }
        let f = NumberFormatter(); f.numberStyle = .decimal
        return "Added \(f.string(from: NSNumber(value: words)) ?? "\(words)") words. They never run out with the month."
    }

    /// A random id for this Mac (only used so the server can tell you whether a code was already added here).
    private static var deviceID: String {
        if let d = UserDefaults.standard.string(forKey: "humanizer.device"), d.count >= 16 { return d }
        let d = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        UserDefaults.standard.set(d, forKey: "humanizer.device")
        return d
    }

    /// A rewrite and what the checker found before and after (the AI habits it counted in each).
    struct Result { let text: String; let before: AITellChecker.Report; let after: AITellChecker.Report }

    /// The person's own writing sample for "write like me" (kept on this Mac).
    static let styleKey = "humanizer.style"
    var style: String { UserDefaults.standard.string(forKey: Self.styleKey) ?? "" }

    private func ask(_ user: String) async throws -> String {
        let config = AIConfig.shared
        var reply = ""
        for try await piece in AIClient.stream([ChatMessage(role: .user, text: user)], provider: config.provider, model: config.model, system: HumanizerLogic.system) { reply += piece }
        return HumanizerLogic.clean(reply)
    }

    /// Rewrites `text`: a first rewrite, a safe tidy in code, then (if the checker still finds habits) a second pass on only those.
    /// Throws a sentence for the person when a limit or the model stops it; the words are counted only when a rewrite comes back.
    func humanize(_ text: String) async throws -> Result {
        let words = HumanizerLogic.wordCount(text)
        let decision = HumanizerLogic.decide(words: words, tier: tier, usage: now)
        if let message = HumanizerLogic.message(for: decision, tier: tier) { throw Failure.stopped(message) }
        guard !busy else { throw Failure.stopped("Already working on one. Wait a moment.") }
        let config = AIConfig.shared
        guard config.provider.isConfigured else { throw Failure.stopped("Choose an AI model in Settings → AI first.") }
        busy = true
        defer { busy = false }
        try await NotchAIGuard.check(provider: config.provider, model: config.model)
        let before = AITellChecker.report(text)
        var out = AITellChecker.autoFix(try await ask(HumanizerLogic.userMessage(text, style: style)))
        guard !out.isEmpty else { throw Failure.stopped("The model sent nothing back. Try again.") }
        // Second pass: only if the checker still sees habits, and only about those. Kept only if it comes back clean enough and not shorter by half.
        let hint = AITellChecker.remainingHint(out)
        if !hint.isEmpty, let second = try? await ask(HumanizerLogic.editMessage(draft: out, habits: hint)) {
            let fixed = AITellChecker.autoFix(second)
            if !fixed.isEmpty, AITellChecker.report(fixed).total <= AITellChecker.report(out).total,
               HumanizerLogic.wordCount(fixed) * 2 >= HumanizerLogic.wordCount(out) { out = fixed }
        }
        usage = HumanizerLogic.applying(decision, to: now)
        if let data = try? JSONEncoder().encode(usage) { UserDefaults.standard.set(data, forKey: Self.key) }
        return Result(text: out, before: before, after: AITellChecker.report(out))
    }
}
