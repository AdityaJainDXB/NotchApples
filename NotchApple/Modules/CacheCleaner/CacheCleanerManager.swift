//
//  CacheCleanerManager.swift
//  Notch apple
//
//  Ultimate: finds the space the Mac can safely give back and clears it in one click.
//  It only ever touches four places in your own Library and temporary folder, and only the
//  *contents* of them (apps rebuild caches, Xcode rebuilds derived data, logs are just history):
//
//   • App caches        ~/Library/Caches (not Apple's own com.apple.* caches, and not this app's)
//   • Xcode derived data ~/Library/Developer/Xcode/DerivedData
//   • Logs              ~/Library/Logs
//   • Temporary files   the user temp folder, only items untouched for 3 days
//
//  Nothing is deleted until you press Clean, and every item is checked to still be inside its
//  folder first, so a stray link can't point the cleaner anywhere else.
//

import Foundation
import SwiftUI

enum CacheKind: String, CaseIterable, Identifiable {
    case appCaches, derivedData, logs, temporary
    var id: String { rawValue }

    var title: String {
        switch self {
        case .appCaches: "App caches"
        case .derivedData: "Xcode derived data"
        case .logs: "Logs"
        case .temporary: "Temporary files"
        }
    }

    var detail: String {
        switch self {
        case .appCaches: "Safe to clear. Apps rebuild what they need."
        case .derivedData: "Build output from Xcode. Rebuilt the next time you build."
        case .logs: "Old log files from apps."
        case .temporary: "Temporary files nothing has touched for 3 days."
        }
    }

    var symbol: String {
        switch self {
        case .appCaches: "square.stack.3d.down.right.fill"
        case .derivedData: "hammer.fill"
        case .logs: "doc.text.fill"
        case .temporary: "clock.arrow.circlepath"
        }
    }

    var color: Color {
        switch self {
        case .appCaches: .purple
        case .derivedData: .blue
        case .logs: .orange
        case .temporary: .green
        }
    }

    var root: URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        switch self {
        case .appCaches: return home.appendingPathComponent("Library/Caches", isDirectory: true)
        case .derivedData: return home.appendingPathComponent("Library/Developer/Xcode/DerivedData", isDirectory: true)
        case .logs: return home.appendingPathComponent("Library/Logs", isDirectory: true)
        case .temporary: return URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        }
    }
}

/// The rules for what may be removed. No file access, so they can be checked on their own.
enum CacheRules {
    /// Names never removed: Apple's own caches, this app's, and a few that break things when cleared mid-use.
    static func isProtected(name: String, kind: CacheKind, ownBundleID: String = Bundle.main.bundleIdentifier ?? "") -> Bool {
        if name.hasPrefix(".") { return true }
        if kind == .appCaches {
            if name.hasPrefix("com.apple.") || name == ownBundleID || name.hasPrefix("CloudKit") || name == "Homebrew" { return true }
        }
        if kind == .temporary, name.hasPrefix("com.apple.") || name == "TemporaryItems" { return true }
        return false
    }

    /// True when `child` really sits inside `root` (after resolving ".." and symlinks).
    static func isInside(_ child: URL, root: URL) -> Bool {
        let c = child.resolvingSymlinksInPath().standardizedFileURL.path
        let r = root.resolvingSymlinksInPath().standardizedFileURL.path
        return c.hasPrefix(r.hasSuffix("/") ? r : r + "/")
    }

    static func staleEnough(modified: Date?, now: Date = .now) -> Bool {
        guard let modified else { return false }
        return now.timeIntervalSince(modified) > 3 * 24 * 3600
    }

    static func format(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: max(0, bytes), countStyle: .file)
    }
}

struct CacheItem: Identifiable, Equatable {
    var id: URL { url }
    let url: URL
    let kind: CacheKind
    let bytes: Int64
}

@MainActor
final class CacheCleanerManager: ObservableObject {
    static let shared = CacheCleanerManager()

    enum Phase: Equatable { case idle, scanning, ready, cleaning, done(freed: Int64) }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var items: [CacheItem] = []
    @Published var included: Set<CacheKind> = Set(CacheKind.allCases)
    @Published private(set) var failed = 0
    /// Everything this Mac has freed with the cleaner, kept across launches.
    @Published private(set) var totalFreed: Int64 = Int64(UserDefaults.standard.integer(forKey: "cache.totalFreed"))

    func bytes(_ kind: CacheKind) -> Int64 { items.filter { $0.kind == kind }.reduce(0) { $0 + $1.bytes } }
    var scannedBytes: Int64 { items.reduce(0) { $0 + $1.bytes } }
    var selectedBytes: Int64 { items.filter { included.contains($0.kind) }.reduce(0) { $0 + $1.bytes } }

    func scan() {
        guard phase != .scanning, phase != .cleaning else { return }
        phase = .scanning
        Task {
            let found = await Task.detached(priority: .utility) { Self.findItems() }.value
            items = found
            phase = .ready
        }
    }

    func clean() {
        guard phase == .ready else { return }
        let chosen = items.filter { included.contains($0.kind) }
        phase = .cleaning
        failed = 0
        Task {
            let (freed, failures) = await Task.detached(priority: .utility) { Self.remove(chosen) }.value
            totalFreed += freed
            UserDefaults.standard.set(Int(totalFreed), forKey: "cache.totalFreed")
            failed = failures
            items = []
            phase = .done(freed: freed)
        }
    }

    // MARK: Work (off the main thread)

    nonisolated private static func findItems() -> [CacheItem] {
        let fm = FileManager.default
        var out: [CacheItem] = []
        for kind in CacheKind.allCases {
            guard let names = try? fm.contentsOfDirectory(atPath: kind.root.path) else { continue }
            for name in names where !CacheRules.isProtected(name: name, kind: kind) {
                let url = kind.root.appendingPathComponent(name)
                guard CacheRules.isInside(url, root: kind.root) else { continue }
                let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .isSymbolicLinkKey])
                if values?.isSymbolicLink == true { continue }
                if kind == .temporary, !CacheRules.staleEnough(modified: values?.contentModificationDate) { continue }
                let size = allocatedSize(of: url)
                if size > 0 { out.append(CacheItem(url: url, kind: kind, bytes: size)) }
            }
        }
        return out.sorted { $0.bytes > $1.bytes }
    }

    nonisolated private static func remove(_ chosen: [CacheItem]) -> (Int64, Int) {
        let fm = FileManager.default
        var freed: Int64 = 0, failures = 0
        for item in chosen {
            // Re-check right before deleting: still inside its folder, still not a link.
            guard CacheRules.isInside(item.url, root: item.kind.root),
                  (try? item.url.resourceValues(forKeys: [.isSymbolicLinkKey]))?.isSymbolicLink != true else { failures += 1; continue }
            do { try fm.removeItem(at: item.url); freed += item.bytes } catch { failures += 1 }
        }
        return (freed, failures)
    }

    nonisolated private static func allocatedSize(of url: URL) -> Int64 {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: url.path, isDirectory: &isDir) else { return 0 }
        let keys: [URLResourceKey] = [.totalFileAllocatedSizeKey, .isRegularFileKey]
        if !isDir.boolValue { return Int64((try? url.resourceValues(forKeys: Set(keys)))?.totalFileAllocatedSize ?? 0) }
        guard let e = fm.enumerator(at: url, includingPropertiesForKeys: keys, options: [], errorHandler: { _, _ in true }) else { return 0 }
        var total: Int64 = 0
        for case let f as URL in e {
            let v = try? f.resourceValues(forKeys: Set(keys))
            if v?.isRegularFile == true { total += Int64(v?.totalFileAllocatedSize ?? 0) }
        }
        return total
    }
}
