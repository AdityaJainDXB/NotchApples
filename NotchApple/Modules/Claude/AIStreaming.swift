//
//  AIStreaming.swift
//  Notch apple
//
//  Streams replies word by word from every provider (server-sent events), so
//  answers appear as they're written and Stop keeps whatever arrived. Each
//  provider speaks its own dialect:
//
//   • OpenAI-compatible (Groq, OpenRouter, Ollama, DeepSeek, OpenAI): choices[0].delta.content
//   • Gemini: streamGenerateContent?alt=sse → candidates[0].content.parts[].text
//   • Claude: content_block_delta → delta.text
//
//  Errors are turned into plain sentences with a next step (see AIFailure).
//

import Foundation

enum AIFailure: LocalizedError {
    case offline, timedOut, invalidKey(AIProvider), rateLimited(AIProvider), modelUnavailable(String),
         visionUnsupported(String), providerDown(AIProvider, Int), malformed, other(String)

    var errorDescription: String? {
        switch self {
        case .offline: "You're offline. Check your internet connection, or switch to Ollama to use AI on this Mac without internet."
        case .timedOut: "The provider took too long to answer. Press Retry, or pick a faster model."
        case .invalidKey(let p): "\(p.title) didn't accept your API key. Check it in Settings → AI, or get a new one."
        case .rateLimited(let p): "\(p.title) is rate-limiting you (too many requests on the free tier). Wait a minute and press Retry, or switch provider."
        case .modelUnavailable(let m): "The model \(m) isn't available. Pick another one from the model menu."
        case .visionUnsupported(let m): "\(m) can't read images. Choose a vision model (for example a Gemini model), or ask about text instead."
        case .providerDown(let p, let code): "\(p.title) is having problems right now (error \(code)). Press Retry in a moment, or switch provider."
        case .malformed: "The provider sent back something unreadable. Press Retry."
        case .other(let message): message
        }
    }

    /// Maps an HTTP status and message from a provider to a useful failure.
    static func from(status: Int, message: String, provider: AIProvider, model: String) -> AIFailure {
        let m = message.lowercased()
        if (m.contains("image") || m.contains("vision") || m.contains("multimodal")) && (m.contains("support") || m.contains("not") || m.contains("invalid")) {
            return .visionUnsupported(model)
        }
        switch status {
        case 401, 403: return .invalidKey(provider)
        case 429: return .rateLimited(provider)
        case 404: return .modelUnavailable(model)
        case 400 where m.contains("api key") || m.contains("api_key"): return .invalidKey(provider)
        case 400 where m.contains("model"): return .modelUnavailable(model)
        case 500...599: return .providerDown(provider, status)
        default: return .other("\(provider.title) error \(status): \(message.prefix(240))")
        }
    }

    static func from(_ error: Error) -> Error {
        guard let u = error as? URLError else { return error }
        switch u.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed: return AIFailure.offline
        case .timedOut: return AIFailure.timedOut
        case .cancelled: return CancellationError()
        default: return error
        }
    }
}

extension AIClient {
    /// Settings → AI → Temperature. Negative means "the provider's default".
    static var temperature: Double? {
        let t = UserDefaults.standard.object(forKey: "ai.temperature") as? Double ?? -1
        return t < 0 ? nil : t
    }

    /// System prompt plus the mode's style rules.
    static func system(for mode: AIMode?) -> String {
        var s = systemPrompt + " Use Markdown. Write math in LaTeX ($…$ inline, $$…$$ for display)."
        if mode == .answerOnly { s += " Be extremely brief." }
        return s
    }

    /// Streams the reply as text chunks. Cancelling the task stops the request.
    static func stream(_ history: [ChatMessage], provider: AIProvider, model: String, system: String) -> AsyncThrowingStream<String, Error> {
        // Gemini: if this model fails before answering, try the next Gemini model (see GeminiFallback).
        if provider == .gemini { return GeminiFallback.stream(history, model: model, system: system) }
        return streamOnce(history, provider: provider, model: model, system: system)
    }

    /// One attempt on exactly this model.
    static func streamOnce(_ history: [ChatMessage], provider: AIProvider, model: String, system: String) -> AsyncThrowingStream<String, Error> {
        if provider == .apple { return AppleIntelligence.stream(history, system: system) }
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let request = try makeStreamRequest(history, provider: provider, model: model, system: system)
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    if !(200..<300).contains(status) {
                        var body = Data()
                        for try await b in bytes { body.append(b); if body.count > 20_000 { break } }
                        let json = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
                        let err = json?["error"]
                        let message = (err as? [String: Any])?["message"] as? String ?? (err as? String)
                            ?? ((json?["error"] as? [[String: Any]])?.first?["message"] as? String)
                            ?? String(decoding: body.prefix(300), as: UTF8.self)
                        throw AIFailure.from(status: status, message: message, provider: provider, model: model)
                    }
                    var gotAny = false
                    for try await line in bytes.lines {
                        try Task.checkCancellation()
                        guard line.hasPrefix("data:") else { continue }
                        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        if payload == "[DONE]" { break }
                        guard let data = payload.data(using: .utf8),
                              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                        if let err = json["error"] as? [String: Any] {
                            throw AIFailure.from(status: (err["code"] as? Int) ?? 500, message: err["message"] as? String ?? "", provider: provider, model: model)
                        }
                        if let piece = chunkText(json, provider: provider), !piece.isEmpty {
                            gotAny = true
                            continuation.yield(piece)
                        }
                    }
                    if !gotAny { throw AIError.empty }
                    continuation.finish()
                } catch {
                    if error is CancellationError || (error as? URLError)?.code == .cancelled { continuation.finish(); return }
                    if provider == .ollama, let u = error as? URLError, u.code == .cannotConnectToHost {
                        continuation.finish(throwing: AIError.ollamaNotRunning); return
                    }
                    continuation.finish(throwing: AIFailure.from(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private static func chunkText(_ json: [String: Any], provider: AIProvider) -> String? {
        switch provider {
        case .gemini:
            return ((json["candidates"] as? [[String: Any]])?.first?["content"] as? [String: Any])
                .flatMap { $0["parts"] as? [[String: Any]] }?.compactMap { $0["text"] as? String }.joined()
        case .claude:
            guard json["type"] as? String == "content_block_delta" else { return nil }
            return (json["delta"] as? [String: Any])?["text"] as? String
        default:
            return ((json["choices"] as? [[String: Any]])?.first?["delta"] as? [String: Any])?["content"] as? String
        }
    }

    private static func makeStreamRequest(_ history: [ChatMessage], provider: AIProvider, model: String, system: String) throws -> URLRequest {
        switch provider {
        case .gemini:
            guard let key = AIProvider.gemini.apiKey else { throw AIError.missingKey(.gemini) }
            let escaped = model.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? model
            var r = URLRequest(url: URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(escaped):streamGenerateContent?alt=sse")!)
            r.httpMethod = "POST"
            r.timeoutInterval = 120
            r.setValue(key, forHTTPHeaderField: "x-goog-api-key")
            r.setValue("application/json", forHTTPHeaderField: "content-type")
            let contents: [[String: Any]] = history.map { msg in
                var parts: [[String: Any]] = []
                if let img = msg.imageBase64 { parts.append(["inline_data": ["mime_type": "image/jpeg", "data": img]]) }
                parts.append(["text": msg.text])
                return ["role": msg.role == .user ? "user" : "model", "parts": parts]
            }
            var body: [String: Any] = ["system_instruction": ["parts": [["text": system]]], "contents": contents]
            if let t = temperature { body["generationConfig"] = ["temperature": t] }
            r.httpBody = try JSONSerialization.data(withJSONObject: body)
            return r

        case .claude:
            guard let key = KeychainHelper.get(.anthropicAPIKey), !key.isEmpty else { throw AIError.missingKey(.claude) }
            var r = URLRequest(url: ClaudeClient.endpoint)
            r.httpMethod = "POST"
            r.timeoutInterval = 120
            r.setValue(key, forHTTPHeaderField: "x-api-key")
            r.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
            r.setValue("application/json", forHTTPHeaderField: "content-type")
            let messages: [[String: Any]] = history.map { msg in
                var content: [[String: Any]] = []
                if let img = msg.imageBase64 {
                    content.append(["type": "image", "source": ["type": "base64", "media_type": "image/jpeg", "data": img]])
                }
                content.append(["type": "text", "text": msg.text])
                return ["role": msg.role.rawValue, "content": content]
            }
            var body: [String: Any] = ["model": model, "max_tokens": 4096, "stream": true, "system": system, "messages": messages]
            if let t = temperature { body["temperature"] = min(t, 1) }
            r.httpBody = try JSONSerialization.data(withJSONObject: body)
            return r

        default:
            let base: String
            switch provider {
            case .groq: base = "https://api.groq.com/openai/v1"
            case .openRouter: base = "https://openrouter.ai/api/v1"
            case .ollama: base = "http://localhost:11434/v1"
            case .deepSeek: base = "https://api.deepseek.com/v1"
            default: base = "https://api.openai.com/v1"
            }
            var r = URLRequest(url: URL(string: "\(base)/chat/completions")!)
            r.httpMethod = "POST"
            r.timeoutInterval = provider == .ollama ? 300 : 120
            r.setValue("application/json", forHTTPHeaderField: "content-type")
            if provider.needsKey {
                guard let key = provider.apiKey else { throw AIError.missingKey(provider) }
                r.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
            }
            if provider == .openRouter {
                r.setValue("https://github.com/AdityaJainDXB/NotchApples", forHTTPHeaderField: "HTTP-Referer")
                r.setValue("Notch apple", forHTTPHeaderField: "X-Title")
            }
            var messages: [[String: Any]] = [["role": "system", "content": system]]
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
            var body: [String: Any] = ["model": model, "messages": messages, "stream": true]
            if let t = temperature { body["temperature"] = t }
            r.httpBody = try JSONSerialization.data(withJSONObject: body)
            return r
        }
    }

    // MARK: Connection test

    /// Sends a tiny request to check the key, model and connection. Returns a short status line.
    static func testConnection(provider: AIProvider, model: String) async -> (ok: Bool, message: String) {
        let started = Date()
        do {
            var reply = ""
            for try await piece in stream([ChatMessage(role: .user, text: "Reply with just the word OK.")],
                                          provider: provider, model: model, system: "You are a connection test. Reply with OK.") {
                reply += piece
                if reply.count > 40 { break }
            }
            let ms = Int(Date().timeIntervalSince(started) * 1000)
            let vision = provider.likelySupportsVision(model) ? "can read images" : "text only"
            return (true, "Connected to \(provider.title) · \(model) · \(vision) · \(ms) ms")
        } catch {
            return (false, error.localizedDescription)
        }
    }
}
