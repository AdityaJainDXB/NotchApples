//
//  OpenRouterFallback.swift
//  Notch apple
//
//  OpenRouter's free models are shared and often rate-limited ("429 Provider
//  returned error"), and many of them can't read images. This picks a model
//  that suits the question, retries once when the host is busy, and falls back
//  to other free models rather than giving up on the first refusal.
//

import Foundation

struct OpenRouterModel: Equatable {
    let id: String
    let isFree: Bool
    let canSeeImages: Bool
    /// False for music, image and other non-chat models.
    let outputsText: Bool
}

enum OpenRouterFallback {
    /// Result of a resilient send: the reply, the model that answered, and why it wasn't the first choice.
    struct Outcome {
        let reply: String
        let model: String
        /// Set when the chosen model couldn't be used: "can't read images" or "was busy".
        let note: String?
        /// True when the chosen model can never do this job (e.g. no image input), so it's worth switching to `model`.
        let shouldSwitch: Bool
    }

    /// At most this many models are tried for one question.
    static let maxAttempts = 5

    // MARK: Model list

    private static var cache: (models: [OpenRouterModel], date: Date)?

    /// OpenRouter's model list with price and input types. Cached for 10 minutes; empty if unreachable.
    static func models() async -> [OpenRouterModel] {
        if let cache, Date().timeIntervalSince(cache.date) < 600 { return cache.models }
        guard let url = URL(string: "https://openrouter.ai/api/v1/models"),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = json["data"] as? [[String: Any]] else { return cache?.models ?? [] }
        let models = list.compactMap { m -> OpenRouterModel? in
            guard let id = m["id"] as? String else { return nil }
            let pricing = m["pricing"] as? [String: Any]
            let free = (pricing?["prompt"] as? String) == "0" && (pricing?["completion"] as? String) == "0"
            let architecture = m["architecture"] as? [String: Any]
            let inputs = (architecture?["input_modalities"] as? [String]) ?? []
            let outputs = (architecture?["output_modalities"] as? [String]) ?? ["text"]
            return OpenRouterModel(id: id, isFree: free, canSeeImages: inputs.contains("image"), outputsText: outputs == ["text"])
        }
        cache = (models, Date())
        return models
    }

    // MARK: Choosing candidates

    /// Free chat models we'd rather not use: safety classifiers, embeddings and similar aren't chatbots.
    private static func isChatModel(_ id: String) -> Bool {
        !["safety", "guard", "embed", "moderation", "rerank"].contains { id.lowercased().contains($0) }
    }

    private static func preference(_ id: String) -> Int {
        let s = id.lowercased()
        if s.contains("gemma") { return 0 }
        if s.contains("qwen") { return 1 }
        if s.contains("llama") { return 2 }
        return 3
    }

    /// Models to try, best first. The chosen model leads when it can do the job (image input if needed);
    /// otherwise it is skipped. Fallbacks are free models that can do the job.
    static func candidates(chosen: String, needsImages: Bool, from models: [OpenRouterModel]) -> [String] {
        let known = models.first { $0.id == chosen }
        // If the list couldn't be loaded, just use the chosen model as before.
        guard !models.isEmpty else { return [chosen] }
        var result: [String] = []
        if known == nil || !needsImages || known!.canSeeImages { result.append(chosen) }
        let fallbacks = models
            .filter { $0.isFree && $0.outputsText && $0.id != chosen && isChatModel($0.id) && (!needsImages || $0.canSeeImages) }
            .map(\.id)
            .sorted { (preference($0), $0) < (preference($1), $1) }
        result += fallbacks
        return Array(result.prefix(maxAttempts))
    }

    /// True for the failures worth retrying elsewhere: rate limits, host errors and "no endpoint" answers.
    static func isBusy(_ error: Error) -> Bool {
        if let e = error as? AIError, case .http(let code, let message) = e {
            return code == 429 || code == 408 || code >= 500 || code == 404 && message.contains("No endpoints")
        }
        return (error as? URLError) != nil
    }

    // MARK: Sending

    /// Tries `candidates` in order with `attempt` (which sends the request to one model). Retries the first model
    /// once after a short wait when it is only busy. `sleep` is injectable so tests don't wait.
    static func run(chosen: String, needsImages: Bool, models: [OpenRouterModel],
                    sleep: @escaping (Double) async -> Void = { try? await Task.sleep(for: .seconds($0)) },
                    attempt: (String) async throws -> String) async throws -> Outcome {
        let order = candidates(chosen: chosen, needsImages: needsImages, from: models)
        let chosenCanSee = models.first { $0.id == chosen }?.canSeeImages ?? true
        var lastError: Error?
        var busyModels: [String] = []
        for (index, model) in order.enumerated() {
            for tryNumber in 0..<(index == 0 ? 2 : 1) {
                do {
                    let reply = try await attempt(model)
                    let note: String?
                    if model == chosen { note = nil }
                    else if needsImages && !chosenCanSee && !busyModels.contains(chosen) { note = "\(chosen) can't read images" }
                    else { note = "\(chosen) was busy" }
                    return Outcome(reply: reply, model: model, note: note,
                                   shouldSwitch: model != chosen && needsImages && !chosenCanSee)
                } catch {
                    lastError = error
                    guard isBusy(error) else { throw error }
                    if tryNumber == 0 && index == 0 && order.count > 0 { await sleep(2) } else { busyModels.append(model) }
                }
            }
        }
        if order.count <= 1, let lastError { throw lastError }
        throw AIError.allBusy(busyModels.prefix(3).joined(separator: ", "))
    }
}
