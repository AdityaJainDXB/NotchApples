//
//  NotchAIGuard.swift
//  Notch Apple
//
//  "Local first": while Settings → AI → "Allow cloud models" is off, NotchAI only talks to a model that is verified
//  to run on this Mac (Ollama's own model list says so) or to Apple Intelligence. Any other provider, or a model
//  whose location cannot be verified, is refused BEFORE a request is made, so nothing is sent anywhere.
//

import Foundation

enum NotchAIGuard {
    static func check(provider: AIProvider, model: String) async throws {
        guard !ModelLocality.allowCloud else { return }
        try await ModelLocality.requireVerifiedLocal(provider: provider, model: model)
    }

    /// True when Local first will refuse this provider before any request (a cloud provider while cloud is not allowed).
    /// Ollama and custom endpoints are decided later, from the server's own model list.
    static func refusesProvider(_ provider: AIProvider) -> Bool {
        !ModelLocality.allowCloud && ![.ollama, .custom, .apple].contains(provider)
    }
}
