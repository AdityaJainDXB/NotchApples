//
//  ModelLocality.swift
//  Notch Apple
//
//  Where a model actually runs: on this Mac, or on someone else's server. NotchAI shows it next to every model
//  and refuses to use an Ollama *cloud* model unless the user has switched that on in Settings → AI, so a prompt
//  is never sent to a remote (possibly billed) service by accident. Pure logic, unit tested.
//

import Foundation

enum ModelLocality: String {
    case local, cloud

    var label: String { self == .local ? "Local" : "Cloud" }
    var symbol: String { self == .local ? "desktopcomputer" : "cloud.fill" }

    /// Ollama's hosted models are named "...-cloud" or "...:cloud" (e.g. gpt-oss:120b-cloud); a local Ollama
    /// just proxies them to ollama.com.
    static func isOllamaCloudName(_ model: String) -> Bool {
        let m = model.lowercased()
        return m.hasSuffix("-cloud") || m.hasSuffix(":cloud") || m.contains(":cloud-") || m.contains("-cloud:")
    }

    /// True for this Mac, loopback and private-network / .local hosts.
    static func isLocalHost(_ urlString: String) -> Bool {
        guard let host = URL(string: urlString)?.host?.lowercased(), !host.isEmpty else { return false }
        if host == "localhost" || host == "::1" || host.hasSuffix(".localhost") || host.hasSuffix(".local") { return true }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4 else { return false }
        return parts[0] == 127 || parts[0] == 10 || (parts[0] == 192 && parts[1] == 168) || (parts[0] == 172 && (16...31).contains(parts[1]))
    }

    static func of(provider: AIProvider, model: String, customBaseURL: String = AIProvider.customBaseURL) -> ModelLocality {
        switch provider {
        case .apple: return .local
        case .ollama: return isOllamaCloudName(model) ? .cloud : .local
        case .custom: return isLocalHost(customBaseURL) && !isOllamaCloudName(model) ? .local : .cloud
        default: return .cloud
        }
    }

    /// The one gate: may this model be used now? Only Ollama cloud models need the user's explicit permission
    /// (a custom URL the user typed themselves counts as their own choice).
    static func isBlocked(provider: AIProvider, model: String, allowCloud: Bool) -> Bool {
        guard provider == .ollama || provider == .custom else { return false }
        return isOllamaCloudName(model) && !allowCloud
    }

    static let allowCloudKey = "ai.allowOllamaCloud"
    static var allowCloud: Bool { UserDefaults.standard.bool(forKey: allowCloudKey) }

    // MARK: Verifying from the server's own metadata (fail closed)

    enum Verdict: Equatable {
        case local
        case cloud(String)
        case unverified(String)
    }

    /// Reads Ollama's /api/tags entries. A model is verified local only if the server lists it with real weights on
    /// disk (a digest and a non-zero size) and no `remote_host` / `remote_model` (what Ollama sets for cloud models).
    /// A cloud-looking name is always cloud. Anything that is not clearly local is NOT local.
    static func verdict(tags: [[String: Any]], model: String) -> Verdict {
        if isOllamaCloudName(model) { return .cloud("the name marks it as an Ollama Cloud model") }
        let wanted = model.lowercased()
        let entry = tags.first { e in
            [e["name"], e["model"]].compactMap { ($0 as? String)?.lowercased() }.contains { $0 == wanted || $0 == wanted + ":latest" }
        }
        guard let e = entry else { return .unverified("the server doesn't list \(model) as installed") }
        func nonEmpty(_ k: String) -> Bool { !(((e[k] as? String) ?? "").isEmpty) }
        if nonEmpty("remote_host") || nonEmpty("remote_model") { return .cloud("the server says it runs remotely") }
        let size = (e["size"] as? NSNumber)?.int64Value ?? 0
        if size <= 0 { return .cloud("it has no weights on this machine") }
        guard nonEmpty("digest") else { return .unverified("the server gave no digest for it") }
        return .local
    }

    /// Where to ask for the model list: Ollama itself, or a server on this Mac / your network.
    static func tagsURL(provider: AIProvider, customBaseURL: String = AIProvider.customBaseURL) -> URL? {
        switch provider {
        case .ollama: return URL(string: "http://localhost:11434/api/tags")
        case .custom:
            guard isLocalHost(customBaseURL), var c = URLComponents(string: customBaseURL) else { return nil }
            c.path = "/api/tags"; c.query = nil
            return c.url
        default: return nil
        }
    }

    // MARK: Remembering a verified answer (faster, still fail closed)

    typealias TagsFetch = @Sendable (URL) async throws -> Data

    /// The real request for a server's model list: short timeout, so a server that hangs is refused quickly.
    static let liveFetch: TagsFetch = { url in
        var r = URLRequest(url: url)
        r.timeoutInterval = 3
        return try await URLSession.shared.data(for: r).0
    }

    /// Keeps the last good model list from a local server for a short time, so a chat does not repeat the request
    /// on every message. It can only ever *skip* a request for a model that the list already proved local; it never
    /// turns a refusal into an answer. Cloud, unlisted and unverifiable models always ask the server again, a failed
    /// or odd answer clears it, and a changed server address is a different entry. Entries expire after `ttl`.
    final class TagsCache: @unchecked Sendable {
        static let shared = TagsCache()
        static let ttl: TimeInterval = 30
        private let lock = NSLock()
        private var entries: [String: (tags: [[String: Any]], at: Date)] = [:]

        /// The remembered list for this server, or nil if there is none, it is older than `ttl`, or the clock went backwards.
        func fresh(for url: URL, now: Date) -> [[String: Any]]? {
            lock.lock(); defer { lock.unlock() }
            guard let e = entries[url.absoluteString] else { return nil }
            let age = now.timeIntervalSince(e.at)
            return age >= 0 && age < Self.ttl ? e.tags : nil
        }
        func store(_ tags: [[String: Any]], for url: URL, now: Date) {
            lock.lock(); defer { lock.unlock() }
            entries[url.absoluteString] = (tags, now)
        }
        func invalidate() {
            lock.lock(); defer { lock.unlock() }
            entries.removeAll()
        }
        var count: Int { lock.lock(); defer { lock.unlock() }; return entries.count }
    }

    private static func parseTags(_ data: Data) -> [[String: Any]]? {
        guard let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        return json["models"] as? [[String: Any]]
    }

    /// Throws unless this model is verified to run locally. Used whenever "Local first" is on.
    /// Order of events: a cloud-looking name is refused with no network at all; a fresh remembered list that already
    /// says this model is local lets it through; anything else asks the server now, and if the server cannot be asked
    /// or does not clearly say "local", the request is refused.
    static func requireVerifiedLocal(provider: AIProvider, model: String,
                                     cache: TagsCache = .shared,
                                     now: @Sendable () -> Date = { Date() },
                                     fetch: TagsFetch = ModelLocality.liveFetch) async throws {
        switch provider {
        case .apple: return
        case .ollama, .custom:
            if isOllamaCloudName(model) { throw AIError.notVerifiedLocal(model, "the name marks it as an Ollama Cloud model") }
            guard let url = tagsURL(provider: provider) else {
                throw AIError.notVerifiedLocal(model, "that server isn't on this Mac or your network")
            }
            if let cached = cache.fresh(for: url, now: now()), case .local = verdict(tags: cached, model: model) { return }
            let data: Data
            do { data = try await fetch(url) }
            catch {
                cache.invalidate()
                throw AIError.notVerifiedLocal(model, "the server didn't answer a model-list request, so where it runs can't be checked")
            }
            guard let tags = parseTags(data) else {
                cache.invalidate()
                throw AIError.notVerifiedLocal(model, "the server isn't Ollama, so where the model runs can't be checked")
            }
            cache.store(tags, for: url, now: now())
            switch verdict(tags: tags, model: model) {
            case .local: return
            case .cloud(let why), .unverified(let why): throw AIError.notVerifiedLocal(model, why)
            }
        default:
            throw AIError.notVerifiedLocal(model, "\(provider.title) is a cloud service")
        }
    }

    // MARK: Labels for the model picker (display only; never used to allow or block anything)

    enum Badge: Equatable {
        case local, localNetwork, cloud, unverified
        var label: String {
            switch self {
            case .local: "Local"
            case .localNetwork: "Local network"
            case .cloud: "Cloud"
            case .unverified: "Unverified"
            }
        }
        var symbol: String {
            switch self {
            case .local: "desktopcomputer"
            case .localNetwork: "network"
            case .cloud: "cloud.fill"
            case .unverified: "questionmark.circle"
            }
        }
    }

    /// True only for this Mac itself (not the rest of your network).
    static func isLoopbackHost(_ urlString: String) -> Bool {
        guard let host = URL(string: urlString)?.host?.lowercased(), !host.isEmpty else { return false }
        if host == "localhost" || host == "::1" || host.hasSuffix(".localhost") { return true }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        return parts.count == 4 && parts[0] == 127
    }

    /// What to print next to a model. "Local" needs the server's own metadata (a `verdict` of .local) or Apple
    /// Intelligence; a server on your network says "Local network"; remote servers and cloud providers say "Cloud";
    /// anything that can't be confirmed says "Unverified". The rules that block models are unchanged.
    static func badge(provider: AIProvider, model: String, customBaseURL: String = AIProvider.customBaseURL, verdict v: Verdict?) -> Badge {
        switch provider {
        case .apple: return .local
        case .ollama, .custom:
            if provider == .custom && !isLocalHost(customBaseURL) { return .cloud }
            if isOllamaCloudName(model) { return .cloud }
            switch v {
            case .some(.local): return provider == .custom && !isLoopbackHost(customBaseURL) ? .localNetwork : .local
            case .some(.cloud): return .cloud
            case .some(.unverified), .none: return .unverified
            }
        default: return .cloud
        }
    }

    /// The server's verdict for each listed model, from one model-list request (or the remembered list), for the picker.
    static func verdicts(provider: AIProvider, models: [String], cache: TagsCache = .shared,
                         now: @Sendable () -> Date = { Date() }, fetch: TagsFetch = ModelLocality.liveFetch) async -> [String: Verdict] {
        guard let url = tagsURL(provider: provider) else { return [:] }
        var tags = cache.fresh(for: url, now: now())
        if tags == nil, let data = try? await fetch(url), let parsed = parseTags(data) {
            cache.store(parsed, for: url, now: now())
            tags = parsed
        }
        var out: [String: Verdict] = [:]
        for m in models { out[m] = tags.map { verdict(tags: $0, model: m) } ?? .unverified("the server didn't answer") }
        return out
    }
}
