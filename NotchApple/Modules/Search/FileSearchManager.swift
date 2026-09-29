//
//  FileSearchManager.swift
//  Notch apple
//
//  Instant file search on top of Spotlight (`NSMetadataQuery`). No directory
//  walking: Spotlight's index answers the query, we only filter and rank the
//  first few hundred hits and show the best 30.
//

import SwiftUI
import Combine

struct SearchResult: Identifiable, Hashable {
    let url: URL
    let name: String
    let kind: String
    let size: Int64?
    let isApp: Bool
    var id: URL { url }

    /// Path with the home folder abbreviated, e.g. `~/Documents/Taxes`.
    var folder: String {
        (url.deletingLastPathComponent().path as NSString).abbreviatingWithTildeInPath
    }

    var detail: String {
        var parts = [kind]
        if let size { parts.append(ByteCountFormatter.string(fromByteCount: size, countStyle: .file)) }
        return parts.joined(separator: " · ")
    }
}

@MainActor
final class FileSearchManager: ObservableObject {
    static let shared = FileSearchManager()

    static let resultLimit = 30
    /// How many raw Spotlight hits we look at before filtering and ranking.
    private static let candidateLimit = 400

    @Published private(set) var results: [SearchResult] = []
    @Published private(set) var isSearching = false
    /// True when a protected folder could not be read, so Spotlight results may be incomplete.
    @Published private(set) var needsFullDiskAccess = false

    private let query = NSMetadataQuery()
    private var debounce: Task<Void, Never>?
    private var observer: NSObjectProtocol?
    private var currentText = ""
    private let settings = SettingsManager.shared

    private init() {
        query.sortDescriptors = [NSSortDescriptor(key: NSMetadataItemLastUsedDateKey, ascending: false)]
        query.notificationBatchingInterval = 0.1
        observer = NotificationCenter.default.addObserver(
            forName: .NSMetadataQueryDidFinishGathering, object: query, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.harvest() }
        }
        checkPermissions()
    }

    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }

    // MARK: Searching

    /// Runs a search shortly after the last keystroke.
    func search(_ text: String) {
        debounce?.cancel()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { cancel(); return }
        debounce = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(220))
            guard !Task.isCancelled else { return }
            self?.run(trimmed)
        }
    }

    func cancel() {
        debounce?.cancel()
        query.stop()
        results = []
        isSearching = false
    }

    private func run(_ text: String) {
        currentText = text
        query.stop()
        query.predicate = Self.predicate(for: text, settings: settings)
        query.searchScopes = Self.scopes(settings)
        isSearching = true
        query.start()
    }

    private func harvest() {
        query.disableUpdates()
        defer { query.enableUpdates(); query.stop(); isSearching = false }

        var found: [SearchResult] = []
        let count = min(query.resultCount, Self.candidateLimit)
        for i in 0..<count {
            guard let item = query.result(at: i) as? NSMetadataItem,
                  let path = item.value(forAttribute: NSMetadataItemPathKey) as? String,
                  !Self.isNoise(path) else { continue }
            let url = URL(fileURLWithPath: path)
            let contentTypes = item.value(forAttribute: NSMetadataItemContentTypeTreeKey) as? [String] ?? []
            found.append(SearchResult(
                url: url,
                name: item.value(forAttribute: NSMetadataItemDisplayNameKey) as? String ?? url.lastPathComponent,
                kind: item.value(forAttribute: "kMDItemKind") as? String ?? "File",
                size: (item.value(forAttribute: NSMetadataItemFSSizeKey) as? NSNumber)?.int64Value,
                isApp: contentTypes.contains("com.apple.application")))
        }
        results = Array(Self.rank(found, for: currentText).prefix(Self.resultLimit))
    }

    // MARK: Query construction

    static func predicate(for text: String, settings: SettingsManager) -> NSPredicate {
        // `LIKE` treats * and ? as wildcards, so strip them from what the user typed.
        let safe = text.replacingOccurrences(of: "*", with: "").replacingOccurrences(of: "?", with: "")
        let name = NSPredicate(format: "%K LIKE[cd] %@", NSMetadataItemDisplayNameKey, "*\(safe)*")

        var kinds: [NSPredicate] = []
        if settings.searchApps {
            kinds.append(NSPredicate(format: "%K == %@", NSMetadataItemContentTypeTreeKey, "com.apple.application"))
        }
        if settings.searchDocuments {
            for type in ["public.composite-content", "public.text", "public.spreadsheet", "public.presentation"] {
                kinds.append(NSPredicate(format: "%K == %@", NSMetadataItemContentTypeTreeKey, type))
            }
        }
        if settings.searchImages {
            kinds.append(NSPredicate(format: "%K == %@", NSMetadataItemContentTypeTreeKey, "public.image"))
        }
        if settings.searchPDFs {
            kinds.append(NSPredicate(format: "%K == %@", NSMetadataItemContentTypeTreeKey, "com.adobe.pdf"))
        }
        if settings.searchDownloads {
            let downloads = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads").path
            kinds.append(NSPredicate(format: "%K BEGINSWITH %@", NSMetadataItemPathKey, downloads + "/"))
        }
        // Every box ticked means "everything", including folders and other files.
        let allTicked = settings.searchApps && settings.searchDocuments && settings.searchImages
            && settings.searchPDFs && settings.searchDownloads
        if kinds.isEmpty || allTicked { return name }
        return NSCompoundPredicate(andPredicateWithSubpredicates: [name, NSCompoundPredicate(orPredicateWithSubpredicates: kinds)])
    }

    static func scopes(_ settings: SettingsManager) -> [Any] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if settings.searchWholeMac { return [NSMetadataQueryLocalComputerScope] }
        var scopes: [Any] = [home]
        if settings.searchApps { scopes += ["/Applications", "/System/Applications"] }
        return scopes
    }

    // MARK: Filtering and ranking

    /// Hidden files, caches, build output and other things nobody is looking for.
    nonisolated static func isNoise(_ path: String) -> Bool {
        let parts = path.split(separator: "/")
        if parts.contains(where: { $0.hasPrefix(".") }) { return true }
        let junk: Set<Substring> = ["node_modules", "Caches", "DerivedData", ".Trash", "__pycache__", "Pods"]
        if parts.contains(where: junk.contains) { return true }
        let home = NSHomeDirectory()
        let blocked = ["\(home)/Library/", "/Library/", "/System/Library/", "/private/", "/usr/", "/opt/", "/bin/", "/sbin/", "/var/", "/cores/"]
        // Applications inside app bundles are noise too (helpers, frameworks).
        if path.components(separatedBy: ".app/").count > 1 { return true }
        return blocked.contains { path.hasPrefix($0) }
    }

    /// Name prefix beats word prefix beats substring; apps float up within a tier.
    static func rank(_ items: [SearchResult], for text: String) -> [SearchResult] {
        func score(_ r: SearchResult) -> Int {
            let name = r.name.lowercased(), q = text.lowercased()
            var s = 0
            if name == q { s = 300 }
            else if name.hasPrefix(q) { s = 200 }
            else if name.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).contains(where: { $0.hasPrefix(q) }) { s = 100 }
            if r.isApp { s += 50 }
            return s
        }
        // Stable: equal scores keep Spotlight's most-recently-used order.
        return items.enumerated()
            .sorted { (score($0.element), -$0.offset) > (score($1.element), -$1.offset) }
            .map(\.element)
    }

    // MARK: Permissions

    /// Downloads, Documents and Desktop are TCC-protected; if reading one fails, results may be missing.
    func checkPermissions() {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser
        needsFullDiskAccess = ["Downloads", "Documents", "Desktop"].contains { name in
            do { _ = try fm.contentsOfDirectory(atPath: home.appendingPathComponent(name).path); return false }
            catch { return (error as NSError).code == NSFileReadNoPermissionError }
        }
    }

    static func openFullDiskAccessSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles") {
            NSWorkspace.shared.open(url)
        }
    }

    // MARK: Actions

    static func open(_ result: SearchResult) { NSWorkspace.shared.open(result.url) }
    static func reveal(_ result: SearchResult) { NSWorkspace.shared.selectFile(result.url.path, inFileViewerRootedAtPath: "") }
}
