//
//  NotchAIDocumentLogic.swift
//  Notch Apple
//
//  The documents list: files the user dragged onto NotchAI or chose, and files an agent read, kept beside the conversation.
//  Pure rules (what may be added, the size limits, duplicates, the cap), unit tested. Files are only ever read, never changed;
//  the list stores paths, not contents.
//

import Foundation

struct NotchAIDocument: Codable, Identifiable, Equatable {
    enum Source: String, Codable { case dropped, chosen, read }
    var id = UUID()
    var path: String
    var name: String
    var kind: String
    var size: Int
    var added = Date()
    var source: Source

    var sourceLabel: String {
        switch source { case .dropped: "Dropped"; case .chosen: "Chosen"; case .read: "Read by an agent" }
    }
}

enum DocumentRejection: Equatable, LocalizedError {
    case notAFile, unsupported(String), tooBig(limitMB: Int), missing

    var errorDescription: String? {
        switch self {
        case .notAFile: "That is a folder or not a regular file. Drop a file."
        case .unsupported(let e): "\(e.isEmpty ? "That kind of" : ".\(e)") file is not supported (text, Markdown, CSV, JSON, code, PDF, Word, Excel, PowerPoint and images are)."
        case .tooBig(let mb): "That file is larger than \(mb) MB, which is the most NotchAI reads."
        case .missing: "That file no longer exists."
        }
    }
}

enum DocumentLogic {
    static let maxDocuments = 50

    /// The most a file of this kind may weigh, in bytes. Matches what the reader accepts.
    static func limitBytes(for kind: ResearchLogic.FileKind) -> Int {
        switch kind {
        case .office: 25_000_000
        case .pdf, .image: 200_000_000
        default: 4_000_000
        }
    }

    static func check(exists: Bool, isRegularFile: Bool, size: Int, ext: String) -> DocumentRejection? {
        guard exists else { return .missing }
        guard isRegularFile else { return .notAFile }
        let kind = ResearchLogic.kind(forExtension: ext)
        if kind == .unsupported { return .unsupported(ext.lowercased()) }
        if size > limitBytes(for: kind) { return .tooBig(limitMB: limitBytes(for: kind) / 1_000_000) }
        return nil
    }

    /// Puts a document at the top. The same path is listed once (its source and date are refreshed); the list is capped.
    static func adding(_ doc: NotchAIDocument, to list: [NotchAIDocument]) -> [NotchAIDocument] {
        var out = list.filter { $0.path != doc.path }
        out.insert(doc, at: 0)
        return Array(out.prefix(maxDocuments))
    }

    static func removing(id: UUID, from list: [NotchAIDocument]) -> [NotchAIDocument] { list.filter { $0.id != id } }

    /// Drops entries whose file is gone.
    static func pruned(_ list: [NotchAIDocument], exists: (String) -> Bool) -> [NotchAIDocument] { list.filter { exists($0.path) } }

    static func describe(size: Int) -> String {
        if size < 1_000 { return "\(size) B" }
        if size < 1_000_000 { return String(format: "%.0f KB", Double(size) / 1_000) }
        return String(format: "%.1f MB", Double(size) / 1_000_000)
    }
}
