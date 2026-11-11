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

    /// Throws unless this model is verified to run locally. Used whenever "Local first" is on.
    static func requireVerifiedLocal(provider: AIProvider, model: String) async throws {
        switch provider {
        case .apple: return
        case .ollama, .custom:
            // Decide from the name first, with no network at all: a cloud-named model never gets as far as a request.
            if isOllamaCloudName(model) { throw AIError.notVerifiedLocal(model, "the name marks it as an Ollama Cloud model") }
            guard let url = tagsURL(provider: provider) else {
                throw AIError.notVerifiedLocal(model, "that server isn't on this Mac or your network")
            }
            var r = URLRequest(url: url); r.timeoutInterval = 3
            let data: Data
            do { (data, _) = try await URLSession.shared.data(for: r) }
            catch { throw AIError.notVerifiedLocal(model, "the server didn't answer a model-list request, so where it runs can't be checked") }
            guard let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let tags = json["models"] as? [[String: Any]] else {
                throw AIError.notVerifiedLocal(model, "the server isn't Ollama, so where the model runs can't be checked")
            }
            switch verdict(tags: tags, model: model) {
            case .local: return
            case .cloud(let why), .unverified(let why): throw AIError.notVerifiedLocal(model, why)
            }
        default:
            throw AIError.notVerifiedLocal(model, "\(provider.title) is a cloud service")
        }
    }
}
