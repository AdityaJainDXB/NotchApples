//
//  AppleIntelligence.swift
//  Notch apple
//
//  Apple's on-device model (macOS 26 or newer with Apple Intelligence turned on),
//  as an AI provider: free, private and offline. Text only, and it's a small model,
//  so it's best for quick questions, rewriting and summaries.
//

import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

enum AppleIntelligence {
    /// True when the system model can answer right now.
    static var isAvailable: Bool {
        #if canImport(FoundationModels)
        if #available(macOS 26, *) {
            if case .available = SystemLanguageModel.default.availability { return true }
        }
        #endif
        return false
    }

    /// Why it can't be used, in plain words (nil when it can).
    static var unavailableReason: String? {
        #if canImport(FoundationModels)
        if #available(macOS 26, *) {
            switch SystemLanguageModel.default.availability {
            case .available: return nil
            case .unavailable(.deviceNotEligible): return "This Mac doesn't support Apple Intelligence."
            case .unavailable(.appleIntelligenceNotEnabled): return "Turn on Apple Intelligence in System Settings → Apple Intelligence & Siri."
            case .unavailable(.modelNotReady): return "Apple Intelligence is still downloading. Try again in a few minutes."
            case .unavailable: return "Apple Intelligence isn't available right now."
            }
        }
        #endif
        return "Apple Intelligence needs macOS 26 or newer."
    }

    static func stream(_ history: [ChatMessage], system: String) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            #if canImport(FoundationModels)
            if #available(macOS 26, *) {
                if let reason = unavailableReason { continuation.finish(throwing: AIFailure.other(reason)); return }
                if history.contains(where: { $0.imageBase64 != nil }) {
                    continuation.finish(throwing: AIFailure.visionUnsupported("Apple Intelligence")); return
                }
                let task = Task {
                    do {
                        let session = LanguageModelSession(instructions: system)
                        // Earlier turns become context; the last message is the question.
                        let earlier = history.dropLast().map { "\($0.role == .user ? "User" : "Assistant"): \($0.text)" }.joined(separator: "\n\n")
                        let question = history.last?.text ?? ""
                        let prompt = earlier.isEmpty ? question : "Conversation so far:\n\(earlier)\n\nUser: \(question)"
                        var sent = ""
                        var options = GenerationOptions()
                        if let t = AIClient.temperature { options.temperature = min(t, 2) }
                        for try await snapshot in session.streamResponse(to: prompt, options: options) {
                            let full = snapshot.content
                            if full.hasPrefix(sent) { continuation.yield(String(full.dropFirst(sent.count))) } else { continuation.yield(full) }
                            sent = full
                        }
                        if sent.isEmpty { throw AIError.empty }
                        continuation.finish()
                    } catch is CancellationError {
                        continuation.finish()
                    } catch {
                        continuation.finish(throwing: AIFailure.other("Apple Intelligence: \(error.localizedDescription)"))
                    }
                }
                continuation.onTermination = { _ in task.cancel() }
                return
            }
            #endif
            continuation.finish(throwing: AIFailure.other(unavailableReason ?? "Apple Intelligence isn't available."))
        }
    }
}
