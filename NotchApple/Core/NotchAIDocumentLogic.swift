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
        case .notAFile: "That is not a regular file. Drop a file or a folder."
        case .unsupported(let e): "\(e.isEmpty ? "That kind of" : ".\(e)") file is not supported (text, Markdown, CSV, JSON, code, PDF, Word, Excel, PowerPoint and images are; old .xls and .ppt are not)."
        case .tooBig(let mb): "That file is larger than \(mb) MB, which is the most NotchAI reads."
        case .missing: "That file no longer exists."
        }
    }
}

enum DocumentLogic {
    static let maxDocuments = 200

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

    // MARK: Folders

    /// The most files one folder adds, and how deep it is searched.
    static let maxFromFolder = 100
    static let maxFolderDepth = 4
    /// Folders that hold tools' own files, not the user's documents.
    static let skippedFolders: Set<String> = ["node_modules", "build", "dist", "target", "deriveddata", "pods", "vendor", "__pycache__", "venv"]

    struct FolderEntry: Equatable {
        /// Path below the folder, with "/" between parts ("notes/2026/plan.md").
        var relativePath: String
        var size: Int
    }

    struct FolderPick: Equatable {
        var files: [String]            // relative paths, in name order
        var skipped: Int               // hidden, unsupported, too big or too deep
        var cut: Bool                  // more usable files than `maxFromFolder`
    }

    /// Which files of a folder are added: supported kinds within their size limit, not hidden, not inside a hidden or
    /// tool folder, not too deep. Sorted by path so the result does not depend on the order the disk lists them.
    static func pick(from entries: [FolderEntry]) -> FolderPick {
        var ok: [String] = [], skipped = 0
        for e in entries.sorted(by: { $0.relativePath.localizedStandardCompare($1.relativePath) == .orderedAscending }) {
            let parts = e.relativePath.split(separator: "/").map(String.init)
            guard let file = parts.last else { continue }
            let folders = parts.dropLast()
            let ext = file.contains(".") ? String(file.split(separator: ".").last ?? "") : ""
            let kind = ResearchLogic.kind(forExtension: ext)
            let hidden = parts.contains { $0.hasPrefix(".") }
            let toolFolder = folders.contains { skippedFolders.contains($0.lowercased()) }
            if hidden || toolFolder || folders.count >= maxFolderDepth || kind == .unsupported || e.size > limitBytes(for: kind) || e.size == 0 { skipped += 1; continue }
            ok.append(e.relativePath)
        }
        return FolderPick(files: Array(ok.prefix(maxFromFolder)), skipped: skipped, cut: ok.count > maxFromFolder)
    }

    static func describe(_ pick: FolderPick, folder: String) -> String {
        if pick.files.isEmpty { return "No files NotchAI can read were found in “\(folder)”." }
        var s = "Added \(pick.files.count) file\(pick.files.count == 1 ? "" : "s") from “\(folder)”."
        if pick.cut { s += " It holds more; only the first \(maxFromFolder) were added." }
        if pick.skipped > 0 { s += " \(pick.skipped) skipped (hidden, unsupported, empty, too big or too deep)." }
        return s
    }

    // MARK: Search

    struct TextHit: Equatable {
        var line: Int                  // 1-based
        var snippet: String
    }

    /// The words of a query, lower case. Every word must be found (in any order).
    static func terms(_ query: String) -> [String] {
        query.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init).filter { !$0.isEmpty }
    }

    /// Documents whose name contains every word of the query.
    static func matchingNames(_ query: String, in list: [NotchAIDocument]) -> [NotchAIDocument] {
        let t = terms(query)
        guard !t.isEmpty else { return list }
        return list.filter { d in let n = d.name.lowercased(); return t.allSatisfy { n.contains($0) } }
    }

    /// Lines of `text` that contain every word of the query, with their line numbers, at most `limit`.
    static func hits(in text: String, query: String, limit: Int = 5, snippetLength: Int = 160) -> [TextHit] {
        let t = terms(query)
        guard !t.isEmpty else { return [] }
        var out: [TextHit] = []
        var number = 0
        text.enumerateLines { line, stop in
            number += 1
            let low = line.lowercased()
            guard t.allSatisfy({ low.contains($0) }) else { return }
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            // Show the part of a long line around the first word found.
            var snippet = trimmed
            if trimmed.count > snippetLength, let r = trimmed.lowercased().range(of: t[0]) {
                let at = trimmed.distance(from: trimmed.startIndex, to: r.lowerBound)
                let from = max(0, min(at - snippetLength / 3, trimmed.count - snippetLength))
                let start = trimmed.index(trimmed.startIndex, offsetBy: from)
                snippet = (from > 0 ? "…" : "") + String(trimmed[start...].prefix(snippetLength)) + (from + snippetLength < trimmed.count ? "…" : "")
            } else if trimmed.count > snippetLength {
                snippet = String(trimmed.prefix(snippetLength)) + "…"
            }
            out.append(TextHit(line: number, snippet: snippet))
            if out.count >= limit { stop = true }
        }
        return out
    }

    /// Kinds whose words can be searched quickly (images need OCR, so they are searched by name only).
    static func searchableInside(kind: String) -> Bool { kind != "image" && kind != "unsupported" }

    static func describe(size: Int) -> String {
        if size < 1_000 { return "\(size) B" }
        if size < 1_000_000 { return String(format: "%.0f KB", Double(size) / 1_000) }
        return String(format: "%.1f MB", Double(size) / 1_000_000)
    }
}
