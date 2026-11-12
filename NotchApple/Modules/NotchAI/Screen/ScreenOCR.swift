//
//  ScreenOCR.swift
//  Notch Apple
//
//  Reads the text in an image with Apple's Vision framework, on this Mac (no network, no model). Lines come back in
//  reading order (top to bottom, then left to right). Used by NotchAI's screen awareness.
//

import CoreGraphics
import Foundation
import Vision

enum ScreenOCR {
    struct Line: Equatable {
        var text: String
        /// Normalised box, origin bottom-left (Vision's convention).
        var box: CGRect
    }

    /// Recognises text. `languages` empty = automatic. Runs off the main thread.
    static func recognize(_ image: CGImage, languages: [String] = []) async throws -> [Line] {
        try await withCheckedThrowingContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.usesLanguageCorrection = true
                if !languages.isEmpty { request.recognitionLanguages = languages }
                do {
                    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
                    let lines = (request.results ?? []).compactMap { obs -> Line? in
                        guard let best = obs.topCandidates(1).first, !best.string.isEmpty else { return nil }
                        return Line(text: best.string, box: obs.boundingBox)
                    }
                    cont.resume(returning: ordered(lines))
                } catch {
                    cont.resume(throwing: error)
                }
            }
        }
    }

    /// Top to bottom; lines whose vertical centres are close count as one row and read left to right.
    static func ordered(_ lines: [Line]) -> [Line] {
        let rowHeight = max(0.01, (lines.map { $0.box.height }.sorted().dropFirst(lines.count / 2).first ?? 0.02) * 0.6)
        return lines.sorted { a, b in
            let ay = a.box.midY, by = b.box.midY
            if abs(ay - by) > rowHeight { return ay > by }
            return a.box.minX < b.box.minX
        }
    }

    static func text(_ lines: [Line]) -> String { lines.map(\.text).joined(separator: "\n") }
}
