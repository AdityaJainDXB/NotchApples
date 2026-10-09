//
//  GeminiFallback.swift
//  Notch apple
//
//  Gemini sometimes refuses a request (rate limit on one model, a timeout, a model that can't take the image).
//  When that happens before any text has arrived, the same request is retried on the next Gemini model, one after
//  another, until one answers or the candidates run out. The chat shows a quiet notice and the notch a short toast.
//  A wrong API key, being offline or pressing Stop are never retried.
//

import Foundation

enum GeminiFallback {
    /// Whether another model could succeed where this failure happened.
    static func isRetryable(_ error: Error) -> Bool {
        if error is CancellationError { return false }
        if let f = error as? AIFailure {
            switch f {
            case .invalidKey, .offline: return false
            default: return true
            }
        }
        if let e = error as? AIError {
            switch e {
            case .missingKey: return false
            default: return true
            }
        }
        return (error as? URLError).map { $0.code != .cancelled && $0.code != .notConnectedToInternet } ?? true
    }

    private static func candidates(_ chosen: String) async -> [String] {
        let live = (try? await AIClient.models(for: .gemini)) ?? []
        return GeminiFallbackLogic.candidates(chosen: chosen, live: live)
    }

    /// Set by the AI tab's model, which decides whether to show the notice (and only in the AI tab, never the closed notch).
    @MainActor static var onSwitch: ((_ newModel: String) -> Void)?

    private static func announce(from old: String, to new: String) {
        Task { @MainActor in onSwitch?(new) }
    }

    /// How long a model gets to start answering before the next one is tried.
    static let firstAnswerDeadline: TimeInterval = 25

    private final class Flag: @unchecked Sendable {
        private let lock = NSLock()
        private var on = false
        func set() { lock.lock(); on = true; lock.unlock() }
        var isSet: Bool { lock.lock(); defer { lock.unlock() }; return on }
    }

    /// Streaming: moves on only while nothing has been shown yet, so a half-written answer is never replaced.
    static func stream(_ history: [ChatMessage], model: String, system: String) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                let models = await candidates(model)
                var lastError: Error = AIError.empty
                for (i, candidate) in models.enumerated() {
                    let started = Flag()
                    do {
                        try await withThrowingTaskGroup(of: Void.self) { group in
                            group.addTask {
                                for try await piece in AIClient.streamOnce(history, provider: .gemini, model: candidate, system: system) {
                                    started.set()
                                    continuation.yield(piece)
                                }
                            }
                            // A model that never starts answering must not freeze the chat: give up on it and move on.
                            group.addTask {
                                try await Task.sleep(for: .seconds(firstAnswerDeadline))
                                if !started.isSet { throw AIFailure.timedOut }
                                try await Task.sleep(for: .seconds(3600))   // answering: wait to be cancelled
                            }
                            try await group.next()
                            group.cancelAll()
                        }
                        continuation.finish()
                        return
                    } catch {
                        lastError = error
                        if started.isSet || !isRetryable(error) || i == models.count - 1 { break }
                        announce(from: candidate, to: models[i + 1])
                    }
                }
                continuation.finish(throwing: lastError)
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Non-streaming version for callers that wait for the whole reply.
    static func send(_ history: [ChatMessage], model: String) async throws -> String {
        let models = await candidates(model)
        var lastError: Error = AIError.empty
        for (i, candidate) in models.enumerated() {
            do {
                return try await withThrowingTaskGroup(of: String.self) { group in
                    group.addTask { try await AIClient.sendOnce(history, provider: .gemini, model: candidate) }
                    group.addTask { try await Task.sleep(for: .seconds(45)); throw AIFailure.timedOut }
                    let first = try await group.next() ?? ""
                    group.cancelAll()
                    return first
                }
            } catch {
                lastError = error
                if !isRetryable(error) || i == models.count - 1 { break }
                announce(from: candidate, to: models[i + 1])
            }
        }
        throw lastError
    }
}
