//
//  SandboxMigration.swift
//  Notch apple
//
//  Up to 1.11.0 the app was sandboxed, so its settings and files lived in
//  ~/Library/Containers/com.notchapple.app. It isn't sandboxed any more
//  (macOS won't give Accessibility to a sandboxed app outside the App Store,
//  which the Windows module needs), so on first launch copy them across once.
//

import Foundation

enum SandboxMigration {
    static func runIfNeeded() {
        let defaults = UserDefaults.standard
        let doneKey = "migration.sandboxDataCopied"
        guard !defaults.bool(forKey: doneKey) else { return }
        defer { defaults.set(true, forKey: doneKey) }

        let fm = FileManager.default
        let bundleID = Bundle.main.bundleIdentifier ?? "com.notchapple.app"
        let container = fm.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Containers/\(bundleID)/Data/Library", isDirectory: true)
        guard fm.fileExists(atPath: container.path) else { return }

        // Settings: copy every key we don't already have.
        let plist = container.appendingPathComponent("Preferences/\(bundleID).plist")
        if let old = NSDictionary(contentsOf: plist) as? [String: Any] {
            for (key, value) in old where defaults.object(forKey: key) == nil {
                defaults.set(value, forKey: key)
            }
        }

        // Notes, AI history, clipboard, layouts, VPN profiles…
        let oldSupport = container.appendingPathComponent("Application Support", isDirectory: true)
        let newSupport = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        for name in (try? fm.contentsOfDirectory(atPath: oldSupport.path)) ?? [] {
            let from = oldSupport.appendingPathComponent(name)
            let to = newSupport.appendingPathComponent(name)
            if !fm.fileExists(atPath: to.path) {
                try? fm.createDirectory(at: newSupport, withIntermediateDirectories: true)
                try? fm.copyItem(at: from, to: to)
            }
        }
    }
}
