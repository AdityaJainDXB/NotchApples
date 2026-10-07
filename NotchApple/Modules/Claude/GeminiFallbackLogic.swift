//
//  GeminiFallbackLogic.swift
//  Notch apple
//
//  Which Gemini models to try, in what order, when the chosen one fails (rate limit, timeout, a model that
//  can't take the image). Pure, so it is tested without the network.
//

import Foundation

enum GeminiFallbackLogic {
    /// Used after the live model list, and when it can't be loaded.
    static let known = ["gemini-3.8-flash", "gemini-3-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"]

    /// How many different models are tried for one request.
    static let maxAttempts = 4

    /// The chosen model first, then the live list (already best-first), then the known names; no repeats.
    static func candidates(chosen: String, live: [String]) -> [String] {
        var seen = Set<String>(), out: [String] = []
        for m in [chosen] + live + known where !m.isEmpty && seen.insert(m).inserted { out.append(m) }
        return Array(out.prefix(maxAttempts))
    }
}
