//
//  NotchAIDocuments.swift
//  Notch Apple
//
//  The documents list and its views. Drag files onto the NotchAI tab (or the workspace window), or choose one; files an agent
//  read are listed too. From a document you can summarise it or ask about it: that runs as an ordinary task (Tasks section),
//  read-only, and answers cite the file. Nothing is uploaded and nothing is changed; the list keeps paths only.
//

import AppKit
import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class NotchAIDocuments: ObservableObject {
    static let shared = NotchAIDocuments()

    @Published private(set) var documents: [NotchAIDocument] = []
    @Published var note: String?
    private let url: URL

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Notch apple", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        url = dir.appendingPathComponent("notchai-documents.json")
        if let data = try? Data(contentsOf: url), let list = try? JSONDecoder().decode([NotchAIDocument].self, from: data) {
            documents = DocumentLogic.pruned(list) { FileManager.default.fileExists(atPath: $0) }
        }
    }

    /// Adds a file. Returns the reason if it was refused.
    @discardableResult
    func add(_ file: URL, source: NotchAIDocument.Source) -> DocumentRejection? {
        let path = file.standardizedFileURL.path
        var isDir: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: path, isDirectory: &isDir)
        let values = try? file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        let size = values?.fileSize ?? 0
        if let why = DocumentLogic.check(exists: exists, isRegularFile: (values?.isRegularFile ?? false) && !isDir.boolValue, size: size, ext: file.pathExtension) {
            if source != .read { note = why.errorDescription }
            return why
        }
        note = nil
        let doc = NotchAIDocument(path: path, name: file.lastPathComponent, kind: ResearchLogic.kind(forExtension: file.pathExtension).rawValue, size: size, source: source)
        documents = DocumentLogic.adding(doc, to: documents)
        save()
        return nil
    }

    /// A file an agent read (listed so the user can see what was used).
    func record(path: String) { add(URL(fileURLWithPath: path), source: .read) }

    func remove(_ id: UUID) { documents = DocumentLogic.removing(id: id, from: documents); save() }

    /// Takes dropped items. Returns true if there was anything to take.
    func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        guard providers.contains(where: { $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) }) else { return false }
        for p in providers {
            _ = p.loadObject(ofClass: URL.self) { url, _ in
                guard let url else { return }
                DispatchQueue.main.async { self.add(url, source: .dropped) }
            }
        }
        return true
    }

    func choose() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.message = "Choose files for NotchAI to read. They are only read, never changed."
        if panel.runModal() == .OK { for u in panel.urls { add(u, source: .chosen) } }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(documents) { try? data.write(to: url, options: .atomic) }
    }
}

/// The list with drop target, used in the NotchAI tab and in the workspace window.
struct NotchAIDocumentsView: View {
    @ObservedObject private var store = NotchAIDocuments.shared
    @State private var question = ""
    @State private var over = false
    private var unlocked: Bool { NotchAITier.allows(.pro) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if !unlocked { Label(NotchAITier.lockedMessage(.pro), systemImage: "lock.fill").font(.system(size: 11)).foregroundStyle(.orange) }
                HStack {
                    Text("Documents").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                    Spacer()
                    Button("Add files…") { store.choose() }
                }
                VStack(spacing: 4) {
                    Image(systemName: "tray.and.arrow.down").font(.system(size: 18))
                    Text("Drop files here").font(.system(size: 11, weight: .medium))
                    Text("Text, Markdown, CSV, JSON, code, PDF, Word, Excel, PowerPoint, images").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                .foregroundStyle(over ? Theme.accentBright : Theme.textSecondary)
                .frame(maxWidth: .infinity).padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 10).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [5])).foregroundStyle(over ? Theme.accentBright : Theme.separator))
                .onDrop(of: [.fileURL], isTargeted: $over) { store.handleDrop($0) }
                if let n = store.note { Text(n).font(.system(size: 11)).foregroundStyle(.orange) }
                TextField("A question about a file (leave empty to summarise)", text: $question).textFieldStyle(.roundedBorder)
                if store.documents.isEmpty {
                    Text("Nothing yet. Files you drop, choose, or that an agent reads show up here. They are only read, never changed.")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
                ForEach(store.documents) { d in row(d) }
            }
        }
    }

    private func row(_ d: NotchAIDocument) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon(d.kind)).foregroundStyle(Theme.accentBright)
            VStack(alignment: .leading, spacing: 1) {
                Text(d.name).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.textPrimary).lineLimit(1).truncationMode(.middle)
                Text("\(d.sourceLabel) · \(DocumentLogic.describe(size: d.size))").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            Button(question.isEmpty ? "Summarise" : "Ask") { ResearchAgent.shared.ask(about: URL(fileURLWithPath: d.path), question: question) }.disabled(!unlocked)
            Button { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: d.path)]) } label: { Image(systemName: "magnifyingglass") }.buttonStyle(.plain).help("Show in Finder")
            Button { store.remove(d.id) } label: { Image(systemName: "xmark.circle") }.buttonStyle(.plain).help("Remove from the list (the file is not touched)")
        }
        .padding(8).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
    }

    private func icon(_ kind: String) -> String {
        switch kind {
        case "pdf": "doc.richtext"
        case "image": "photo"
        case "office": "doc.text"
        case "csv": "tablecells"
        case "code", "json": "chevron.left.forwardslash.chevron.right"
        default: "doc"
        }
    }
}
