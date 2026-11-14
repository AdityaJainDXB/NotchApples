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
    /// Search inside the listed files: results per document, and whether a search is running.
    @Published private(set) var found: [UUID: [DocumentLogic.TextHit]] = [:]
    @Published private(set) var searching = false
    @Published private(set) var searchedFor = ""
    private var searchTask: Task<Void, Never>?
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
        if exists, isDir.boolValue, source != .read { addFolder(file, source: source); return nil }
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

    /// Adds the readable files of a folder (see DocumentLogic.pick): only listed and read, never changed.
    func addFolder(_ folder: URL, source: NotchAIDocument.Source) {
        let base = folder.standardizedFileURL
        var entries: [DocumentLogic.FolderEntry] = []
        let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey]
        // Packages (apps, bundles) are not opened, and the walk stops after a generous number of entries.
        if let walker = FileManager.default.enumerator(at: base, includingPropertiesForKeys: keys, options: [.skipsPackageDescendants]) {
            var seen = 0
            for case let u as URL in walker {
                seen += 1
                if seen > 20_000 { break }
                let name = u.lastPathComponent
                if name.hasPrefix(".") || DocumentLogic.skippedFolders.contains(name.lowercased()) { walker.skipDescendants(); continue }
                if walker.level > DocumentLogic.maxFolderDepth { walker.skipDescendants(); continue }
                guard let v = try? u.resourceValues(forKeys: Set(keys)), v.isRegularFile == true else { continue }
                let rel = String(u.standardizedFileURL.path.dropFirst(base.path.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                entries.append(.init(relativePath: rel, size: v.fileSize ?? 0))
            }
        }
        let pick = DocumentLogic.pick(from: entries)
        for rel in pick.files.reversed() {                    // reversed, so the list ends up in name order
            let u = base.appendingPathComponent(rel)
            let size = (try? u.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            let doc = NotchAIDocument(path: u.path, name: u.lastPathComponent, kind: ResearchLogic.kind(forExtension: u.pathExtension).rawValue, size: size, source: source)
            documents = DocumentLogic.adding(doc, to: documents)
        }
        save()
        note = DocumentLogic.describe(pick, folder: folder.lastPathComponent)
    }

    /// Looks for the words inside every listed file (read-only, on this Mac). Images are matched by name only.
    func searchInside(_ query: String) {
        searchTask?.cancel()
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !DocumentLogic.terms(q).isEmpty else { found = [:]; searchedFor = ""; searching = false; return }
        searching = true; found = [:]; searchedFor = q
        let docs = documents.filter { DocumentLogic.searchableInside(kind: $0.kind) }
        searchTask = Task {
            for d in docs {
                if Task.isCancelled { return }
                guard let source = try? await ResearchIO.read(URL(fileURLWithPath: d.path)) else { continue }
                let hits = DocumentLogic.hits(in: source.text, query: q)
                if !hits.isEmpty, !Task.isCancelled { found[d.id] = hits }
            }
            if !Task.isCancelled { searching = false }
        }
    }

    func clearSearch() { searchTask?.cancel(); found = [:]; searchedFor = ""; searching = false }

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
        panel.canChooseDirectories = true
        panel.message = "Choose files or a folder for NotchAI to read. They are only read, never changed."
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
    @State private var search = ""
    @State private var over = false
    private var unlocked: Bool { NotchAITier.allows(.pro) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if !unlocked { Label(NotchAITier.lockedMessage(.pro), systemImage: "lock.fill").font(.system(size: 11)).foregroundStyle(.orange) }
                HStack {
                    Text("Documents").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                    Spacer()
                    Button("Add files or a folder…") { store.choose() }
                }
                VStack(spacing: 4) {
                    Image(systemName: "tray.and.arrow.down").font(.system(size: 18))
                    Text("Drop files or a folder here").font(.system(size: 11, weight: .medium))
                    Text("Text, Markdown, CSV, JSON, code, PDF, Word, Excel, PowerPoint, images").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                .foregroundStyle(over ? Theme.accentBright : Theme.textSecondary)
                .frame(maxWidth: .infinity).padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 10).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [5])).foregroundStyle(over ? Theme.accentBright : Theme.separator))
                .onDrop(of: [.fileURL], isTargeted: $over) { store.handleDrop($0) }
                if let n = store.note { Text(n).font(.system(size: 11)).foregroundStyle(.orange) }
                TextField("A question about a file (leave empty to summarise)", text: $question).textFieldStyle(.roundedBorder).foregroundStyle(Theme.textPrimary)
                HStack {
                    TextField("Find a file by name, or search inside the files", text: $search).textFieldStyle(.roundedBorder).foregroundStyle(Theme.textPrimary)
                        .onSubmit { store.searchInside(search) }
                    Button("Search inside") { store.searchInside(search) }.disabled(search.trimmingCharacters(in: .whitespaces).isEmpty || store.searching)
                    if store.searching { ProgressView().controlSize(.small) }
                    if !store.searchedFor.isEmpty { Button("Clear") { search = ""; store.clearSearch() } }
                }
                if !store.searchedFor.isEmpty, !store.searching {
                    Text(store.found.isEmpty ? "“\(store.searchedFor)” was not found inside any listed file." : "“\(store.searchedFor)” was found in \(store.found.count) file\(store.found.count == 1 ? "" : "s").")
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                if store.documents.isEmpty {
                    Text("Nothing yet. Files you drop, choose, or that an agent reads show up here. They are only read, never changed.")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
                ForEach(shown) { d in
                    row(d)
                    ForEach(store.found[d.id] ?? [], id: \.line) { hit in
                        Text("line \(hit.line): \(hit.snippet)").font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.textSecondary)
                            .lineLimit(2).frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 28)
                    }
                }
            }
        }
    }

    /// While a search inside the files has results, the files that contain the words; otherwise the files whose name matches.
    private var shown: [NotchAIDocument] {
        if !store.searchedFor.isEmpty, !store.found.isEmpty { return store.documents.filter { store.found[$0.id] != nil } }
        return DocumentLogic.matchingNames(search, in: store.documents)
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
            Button { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: d.path)]) } label: { Image(systemName: "magnifyingglass") }.buttonStyle(MetalPlainStyle()).help("Show in Finder")
            Button { store.remove(d.id) } label: { Image(systemName: "xmark.circle") }.buttonStyle(MetalPlainStyle()).help("Remove from the list (the file is not touched)")
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
