//
//  AIProviders.swift
//  Notch apple
//
//  The AI tab works with several providers, so nobody has to pay to use it:
//
//   Provider     Cost                           Key                          Screenshots
//   ─────────    ────────────────────────────   ───────────────────────────  ───────────
//   Gemini       Free tier, no billing          aistudio.google.com/apikey   Yes
//   Groq         Free tier, no billing          console.groq.com/keys        Some models
//   OpenRouter   Free models (":free")          openrouter.ai/keys           Some models
//   Ollama       Free, runs on this Mac         none (ollama.com)            Vision models
//   Claude       Paid (your Anthropic account)  console.anthropic.com        Yes
//   OpenAI       Paid (your OpenAI account)     platform.openai.com          Yes
//
//  OpenRouter's free list changes over time (open models such as Qwen, Llama,
//  and DeepSeek when available); the official DeepSeek and OpenAI APIs require
//  billing. Model lists are fetched live from each
//  provider so they never go stale; you can also type any model ID.
//  Keys are stored in the Keychain and sent only to that provider.
//

import Foundation

enum AIProvider: String, CaseIterable, Identifiable, Codable {
    case gemini, groq, openRouter, ollama, claude, openAI

    var id: String { rawValue }

    var title: String {
        switch self {
        case .gemini: "Google Gemini"
        case .groq: "Groq"
        case .openRouter: "OpenRouter"
        case .ollama: "Ollama (on this Mac)"
        case .claude: "Claude"
        case .openAI: "ChatGPT (OpenAI)"
        }
    }

    var costNote: String {
        switch self {
        case .gemini: "Free tier, no billing needed"
        case .groq: "Free tier, no billing needed"
        case .openRouter: "Free models, no billing needed"
        case .ollama: "Free, private, works offline"
        case .claude: "Paid, billed to your Anthropic account"
        case .openAI: "Paid, billed to your OpenAI account"
        }
    }

    var isFree: Bool { ![.claude, .openAI].contains(self) }
    var needsKey: Bool { self != .ollama }

    var keychainKey: KeychainHelper.Key {
        switch self {
        case .claude: .anthropicAPIKey
        case .gemini: .geminiAPIKey
        case .groq: .groqAPIKey
        case .openRouter: .openRouterAPIKey
        case .openAI: .openAIAPIKey
        case .ollama: .anthropicAPIKey   // unused (no key)
        }
    }

    var keyURL: URL {
        switch self {
        case .gemini: URL(string: "https://aistudio.google.com/apikey")!
        case .groq: URL(string: "https://console.groq.com/keys")!
        case .openRouter: URL(string: "https://openrouter.ai/keys")!
        case .ollama: URL(string: "https://ollama.com/download")!
        case .claude: URL(string: "https://console.anthropic.com/settings/keys")!
        case .openAI: URL(string: "https://platform.openai.com/api-keys")!
        }
    }

    var keyPlaceholder: String {
        switch self {
        case .gemini: "AIza…"
        case .groq: "gsk_…"
        case .openRouter: "sk-or-…"
        case .claude: "sk-ant-…"
        case .openAI: "sk-…"
        case .ollama: ""
        }
    }

    /// Used until the live list loads, or if it can't.
    var fallbackModel: String {
        switch self {
        case .gemini: "gemini-2.5-flash"
        case .groq: "llama-3.3-70b-versatile"
        case .openRouter: "meta-llama/llama-3.3-70b-instruct:free"
        case .ollama: "llama3.2"
        case .claude: "claude-sonnet-5"
        case .openAI: "gpt-4o-mini"
        }
    }

    var apiKey: String? {
        needsKey ? KeychainHelper.get(keychainKey).flatMap { $0.isEmpty ? nil : $0 } : nil
    }

    var isConfigured: Bool { !needsKey || apiKey != nil }
}

enum AIError: LocalizedError {
    case missingKey(AIProvider), http(Int, String), empty, ollamaNotRunning

    var errorDescription: String? {
        switch self {
        case .missingKey(let p): "Add your \(p.title) key in Settings → AI."
        case .http(let code, let msg): "Error \(code): \(msg)"
        case .empty: "The model returned an empty response."
        case .ollamaNotRunning: "Ollama isn't running. Install it from ollama.com and run a model (e.g. `ollama run llama3.2`)."
        }
    }
}

enum AIClient {
    static let systemPrompt = "You are a helpful assistant living in the user's MacBook notch. Be concise. When given a screenshot, describe or reason about what's on screen as asked."

    // MARK: Chat

    static func send(_ history: [ChatMessage], provider: AIProvider, model: String) async throws -> String {
        switch provider {
        case .claude: return try await ClaudeClient.send(history, model: model)
        case .gemini: return try await sendGemini(history, model: model)
        case .groq, .openRouter, .ollama, .openAI: return try await sendOpenAICompatible(history, provider: provider, model: model)
        }
    }

    private static func sendGemini(_ history: [ChatMessage], model: String) async throws -> String {
        guard let key = AIProvider.gemini.apiKey else { throw AIError.missingKey(.gemini) }
        let escaped = model.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? model
        var request = URLRequest(url: URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(escaped):generateContent")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue(key, forHTTPHeaderField: "x-goog-api-key")   // header, not URL, so it isn't logged
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        let contents: [[String: Any]] = history.map { msg in
            var parts: [[String: Any]] = []
            if let img = msg.imageBase64 { parts.append(["inline_data": ["mime_type": "image/jpeg", "data": img]]) }
            parts.append(["text": msg.text])
            return ["role": msg.role == .user ? "user" : "model", "parts": parts]
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "system_instruction": ["parts": [["text": systemPrompt]]],
            "contents": contents,
        ])
        let json = try await perform(request)
        let text = ((json["candidates"] as? [[String: Any]])?.first?["content"] as? [String: Any])
            .flatMap { $0["parts"] as? [[String: Any]] }?
            .compactMap { $0["text"] as? String }.joined() ?? ""
        guard !text.isEmpty else { throw AIError.empty }
        return text
    }

    private static func sendOpenAICompatible(_ history: [ChatMessage], provider: AIProvider, model: String) async throws -> String {
        let base: String
        switch provider {
        case .groq: base = "https://api.groq.com/openai/v1"
        case .openRouter: base = "https://openrouter.ai/api/v1"
        case .ollama: base = "http://localhost:11434/v1"
        default: base = "https://api.openai.com/v1"
        }
        var request = URLRequest(url: URL(string: "\(base)/chat/completions")!)
        request.httpMethod = "POST"
        request.timeoutInterval = provider == .ollama ? 300 : 120
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        if provider.needsKey {
            guard let key = provider.apiKey else { throw AIError.missingKey(provider) }
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        }
        if provider == .openRouter {
            request.setValue("https://github.com/AdityaJainDXB/NotchApples", forHTTPHeaderField: "HTTP-Referer")
            request.setValue("Notch apple", forHTTPHeaderField: "X-Title")
        }
        var messages: [[String: Any]] = [["role": "system", "content": systemPrompt]]
        for msg in history {
            if let img = msg.imageBase64 {
                messages.append(["role": msg.role.rawValue, "content": [
                    ["type": "text", "text": msg.text],
                    ["type": "image_url", "image_url": ["url": "data:image/jpeg;base64,\(img)"]],
                ]])
            } else {
                messages.append(["role": msg.role.rawValue, "content": msg.text])
            }
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: ["model": model, "messages": messages])
        let json: [String: Any]
        do { json = try await perform(request) } catch let error as URLError where provider == .ollama {
            if error.code == .cannotConnectToHost || error.code == .networkConnectionLost { throw AIError.ollamaNotRunning }
            throw error
        }
        let text = ((json["choices"] as? [[String: Any]])?.first?["message"] as? [String: Any])?["content"] as? String ?? ""
        guard !text.isEmpty else { throw AIError.empty }
        return text
    }

    // MARK: Models

    /// Fetches the provider's current models (free ones only for OpenRouter).
    static func models(for provider: AIProvider) async throws -> [String] {
        switch provider {
        case .claude:
            return ClaudeClient.models
        case .gemini:
            guard let key = provider.apiKey else { throw AIError.missingKey(provider) }
            var r = URLRequest(url: URL(string: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200")!)
            r.setValue(key, forHTTPHeaderField: "x-goog-api-key")
            let json = try await perform(r)
            return ((json["models"] as? [[String: Any]]) ?? [])
                .filter { (($0["supportedGenerationMethods"] as? [String]) ?? []).contains("generateContent") }
                .compactMap { ($0["name"] as? String)?.replacingOccurrences(of: "models/", with: "") }
                .filter { $0.hasPrefix("gemini") }
                .sorted { rank($0) > rank($1) }
        case .openRouter:
            let json = try await perform(URLRequest(url: URL(string: "https://openrouter.ai/api/v1/models")!))
            return ((json["data"] as? [[String: Any]]) ?? []).compactMap { m -> String? in
                guard let id = m["id"] as? String, let p = m["pricing"] as? [String: Any],
                      (p["prompt"] as? String) == "0", (p["completion"] as? String) == "0" else { return nil }
                return id
            }.sorted { ($0.contains("deepseek") ? 0 : 1, $0) < ($1.contains("deepseek") ? 0 : 1, $1) }
        case .ollama:
            do {
                let json = try await perform(URLRequest(url: URL(string: "http://localhost:11434/api/tags")!))
                return ((json["models"] as? [[String: Any]]) ?? []).compactMap { $0["name"] as? String }
            } catch { throw AIError.ollamaNotRunning }
        case .groq, .openAI:
            guard let key = provider.apiKey else { throw AIError.missingKey(provider) }
            let base = provider == .groq ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1"
            var r = URLRequest(url: URL(string: "\(base)/models")!)
            r.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
            let json = try await perform(r)
            return ((json["data"] as? [[String: Any]]) ?? []).compactMap { $0["id"] as? String }
                .filter { provider == .groq ? !$0.contains("whisper") && !$0.contains("tts") && !$0.contains("guard") : $0.hasPrefix("gpt") }
                .sorted()
        }
    }

    /// Prefer "flash" and newer Gemini models at the top of the list.
    private static func rank(_ id: String) -> Int {
        var score = 0
        if id.contains("flash") { score += 10 }
        if id.contains("latest") { score += 2 }
        if id.contains("exp") || id.contains("preview") { score -= 5 }
        if let v = id.split(separator: "-").dropFirst().first, let n = Double(v) { score += Int(n * 10) }
        return score
    }

    // MARK: Helpers

    private static func perform(_ request: URLRequest) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else {
            let message = (json["error"] as? [String: Any])?["message"] as? String
                ?? (json["error"] as? String)
                ?? String(decoding: data.prefix(300), as: UTF8.self)
            throw AIError.http(status, message)
        }
        return json
    }
}
