//
//  ClaudeClient.swift
//  Notch apple
//
//  Minimal client for the Anthropic Messages API (https://docs.anthropic.com).
//  Uses the user's own API key (saved on this Mac) — the developer pays nothing
//  and no proxy server is involved. Requests go straight from the Mac to
//  api.anthropic.com.
//

import Foundation

struct ChatMessage: Identifiable, Equatable {
    enum Role: String { case user, assistant }
    let id = UUID()
    let role: Role
    var text: String
    /// Base64 JPEG attached to this (user) message: a capture, pasted image or Share Screen.
    var imageBase64: String?
    /// What the bubble shows instead of the full instruction, e.g. "Solve".
    var display: String? = nil
    /// The reply was stopped part-way.
    var stopped = false
    /// The model that wrote this reply.
    var model: String? = nil
}

enum ClaudeError: LocalizedError {
    case missingKey, http(Int, String), empty

    var errorDescription: String? {
        switch self {
        case .missingKey: "Add your Anthropic API key in Settings → Claude."
        case .http(let code, let msg): "Claude API error \(code): \(msg)"
        case .empty: "Claude returned an empty response."
        }
    }
}

enum ClaudeClient {
    static let endpoint = URL(string: "https://api.anthropic.com/v1/messages")!

    /// Models offered in Settings. Users choose based on their own budget.
    static let models = ["claude-sonnet-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"]

    /// Sends the full conversation and returns the assistant's reply text.
    static func send(_ history: [ChatMessage], model: String) async throws -> String {
        guard let key = KeychainHelper.get(.anthropicAPIKey), !key.isEmpty else { throw ClaudeError.missingKey }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue(key, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.setValue("application/json", forHTTPHeaderField: "content-type")

        let messages: [[String: Any]] = history.map { msg in
            var content: [[String: Any]] = []
            if let img = msg.imageBase64 {
                content.append(["type": "image",
                                "source": ["type": "base64", "media_type": "image/jpeg", "data": img]])
            }
            content.append(["type": "text", "text": msg.text])
            return ["role": msg.role.rawValue, "content": content]
        }

        let body: [String: Any] = [
            "model": model,
            "max_tokens": 2048,
            "system": "You are Claude, living in the user's MacBook notch. Be concise and helpful. When given a screenshot, describe or reason about what's on screen as asked.",
            "messages": messages,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        guard status == 200 else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
                .flatMap { ($0["error"] as? [String: Any])?["message"] as? String }
                ?? String(decoding: data, as: UTF8.self)
            throw ClaudeError.http(status, msg)
        }

        struct Resp: Decodable { struct Block: Decodable { let type: String; let text: String? }; let content: [Block] }
        let text = try JSONDecoder().decode(Resp.self, from: data)
            .content.compactMap { $0.type == "text" ? $0.text : nil }.joined()
        guard !text.isEmpty else { throw ClaudeError.empty }
        return text
    }
}
