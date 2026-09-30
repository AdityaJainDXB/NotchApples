//
//  SettingsBackup.swift
//  Notch apple
//
//  Save your whole notch setup (modules, tab order, theme, shortcuts, Notch
//  Extras, snippets, launcher apps, world clock cities, focus lengths…) and
//  bring it back on this or another Mac.
//
//   • Export / import a ".notchsettings" file.
//   • iCloud sync: keeps a copy in iCloud Drive, so any Mac signed in to the
//     same Apple ID can restore it with one click. No account or server of
//     our own: your Apple ID is the account.
//
//  Left out on purpose: AI API keys and the access code (they stay in this
//  Mac's private store), Messenger's device identity, file-shelf bookmarks
//  (they only work on the Mac that made them) and first-run flags.
//

import AppKit
import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class SettingsBackup: ObservableObject {
    static let shared = SettingsBackup()

    @AppStorage("backup.iCloudSync") var iCloudSync = false { didSet { if iCloudSync { saveToICloudSoon() } } }
    @Published private(set) var lastICloudSave: Date?
    @Published private(set) var iCloudCopyDate: Date?
    @Published var message: String?

    static let fileExtension = "notchsettings"
    private static let excludedPrefixes = ["NS", "Apple", "com.apple", "onboarding.", "migration.", "backup.", "messenger.senderID",
                                           "messenger.activeRoom", "shelf.items", "ui.lastTab", "settings.lastPane", "update.",
                                           "focus.completed", "focus.history", "hotkey.migrated"]
    private var saveWork: DispatchWorkItem?
    private var observer: NSObjectProtocol?

    // MARK: Snapshot

    private static func snapshot() -> [String: Any] {
        let bundle = Bundle.main.bundleIdentifier ?? "com.notchapple.app"
        let all = UserDefaults.standard.persistentDomain(forName: bundle) ?? [:]
        var prefs = all.filter { key, _ in !excludedPrefixes.contains { key.hasPrefix($0) } }
        // The weather city lives in the shared App Group (the widget reads it too).
        if let weather = SharedStore.defaults.data(forKey: "shared.weatherLocation") { prefs["__shared.weatherLocation"] = weather }
        return prefs
    }

    static func encode() throws -> Data {
        let prefs = try PropertyListSerialization.data(fromPropertyList: snapshot(), format: .binary, options: 0)
        let wrapper: [String: Any] = [
            "app": "Notch apple",
            "format": 1,
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            "created": ISO8601DateFormatter().string(from: .now),
            "mac": Host.current().localizedName ?? "Mac",
            "settings": prefs.base64EncodedString(),
        ]
        return try JSONSerialization.data(withJSONObject: wrapper, options: [.prettyPrinted, .sortedKeys])
    }

    struct Summary { let created: Date?; let mac: String; let version: String; let count: Int }

    static func decode(_ data: Data) throws -> (prefs: [String: Any], summary: Summary) {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any], json["app"] as? String == "Notch apple",
              let b64 = json["settings"] as? String, let plist = Data(base64Encoded: b64),
              let prefs = try PropertyListSerialization.propertyList(from: plist, format: nil) as? [String: Any]
        else { throw BackupError.notABackup }
        let created = (json["created"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }
        return (prefs, Summary(created: created, mac: json["mac"] as? String ?? "Mac", version: json["version"] as? String ?? "", count: prefs.count))
    }

    enum BackupError: LocalizedError {
        case notABackup, noICloud
        var errorDescription: String? {
            switch self {
            case .notABackup: "That file isn't a Notch apple settings backup."
            case .noICloud: "iCloud Drive isn't turned on. Turn it on in System Settings → Apple Account → iCloud → iCloud Drive."
            }
        }
    }

    /// Replaces the current settings with the backup's, then restarts the app so every part picks them up.
    static func apply(_ prefs: [String: Any]) {
        let d = UserDefaults.standard
        let bundle = Bundle.main.bundleIdentifier ?? "com.notchapple.app"
        // Clear current (non-excluded) settings first, so things you'd turned on since go back to how the backup had them.
        for key in (d.persistentDomain(forName: bundle) ?? [:]).keys where !excludedPrefixes.contains(where: { key.hasPrefix($0) }) {
            d.removeObject(forKey: key)
        }
        for (key, value) in prefs {
            if key == "__shared.weatherLocation" { SharedStore.defaults.set(value, forKey: "shared.weatherLocation") }
            else { d.set(value, forKey: key) }
        }
        d.synchronize()
        AppRelauncher.relaunch()
    }

    // MARK: File export / import

    func exportFile() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "Notch apple settings \(Date.now.formatted(.iso8601.year().month().day())).\(Self.fileExtension)"
        panel.allowedContentTypes = [UTType(filenameExtension: Self.fileExtension) ?? .json]
        panel.canCreateDirectories = true
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try Self.encode().write(to: url, options: .atomic)
            message = "Saved \(url.lastPathComponent)"
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } catch {
            message = "Couldn't save: \(error.localizedDescription)"
        }
    }

    func importFile() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [UTType(filenameExtension: Self.fileExtension) ?? .json, .json]
        panel.allowsMultipleSelection = false
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        restore(from: url)
    }

    private func restore(from url: URL) {
        do {
            let (prefs, s) = try Self.decode(Data(contentsOf: url))
            let alert = NSAlert()
            alert.messageText = "Restore these settings?"
            alert.informativeText = "From \(s.mac)\(s.created.map { ", saved " + $0.formatted(date: .abbreviated, time: .shortened) } ?? "") (Notch apple \(s.version)). Your current modules, layout and preferences will be replaced, and Notch apple will restart. AI keys and your access code are kept."
            alert.addButton(withTitle: "Restore and Restart")
            alert.addButton(withTitle: "Cancel")
            NSApp.activate(ignoringOtherApps: true)
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            Self.apply(prefs)
        } catch {
            message = error.localizedDescription
        }
    }

    // MARK: iCloud Drive

    /// ~/Library/Mobile Documents/com~apple~CloudDocs/Notch apple, when iCloud Drive is on.
    static var iCloudFolder: URL? {
        let drive = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs")
        guard FileManager.default.fileExists(atPath: drive.path) else { return nil }
        return drive.appendingPathComponent("Notch apple", isDirectory: true)
    }

    static var iCloudFile: URL? { iCloudFolder?.appendingPathComponent("Settings.\(fileExtension)") }

    func startSync() {
        refreshICloudInfo()
        guard observer == nil else { return }
        observer = NotificationCenter.default.addObserver(forName: UserDefaults.didChangeNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { SettingsBackup.shared.saveToICloudSoon() }
        }
    }

    /// Settings change in bursts (dragging a slider), so wait until they settle before writing.
    func saveToICloudSoon() {
        guard iCloudSync else { return }
        saveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.saveToICloudNow() }
        saveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: work)
    }

    func saveToICloudNow() {
        guard let folder = Self.iCloudFolder, let file = Self.iCloudFile else { message = BackupError.noICloud.localizedDescription; return }
        do {
            let data = try Self.encode()
            // Skip identical writes so iCloud isn't uploading the same file over and over.
            if let old = try? Data(contentsOf: file), (try? Self.decode(old).prefs as NSDictionary) == (try? Self.decode(data).prefs as NSDictionary) {
                return
            }
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try data.write(to: file, options: .atomic)
            lastICloudSave = .now
            iCloudCopyDate = .now
        } catch {
            message = "Couldn't save to iCloud Drive: \(error.localizedDescription)"
        }
    }

    func refreshICloudInfo() {
        guard let file = Self.iCloudFile else { iCloudCopyDate = nil; return }
        if let data = try? Data(contentsOf: file), let s = try? Self.decode(data).summary { iCloudCopyDate = s.created }
        else { iCloudCopyDate = nil }
    }

    func restoreFromICloud() {
        guard let file = Self.iCloudFile else { message = BackupError.noICloud.localizedDescription; return }
        // Make sure iCloud has downloaded the latest copy.
        try? FileManager.default.startDownloadingUbiquitousItem(at: file)
        guard FileManager.default.fileExists(atPath: file.path) else { message = "No backup in iCloud Drive yet. Turn on iCloud sync on the Mac you set up first."; return }
        restore(from: file)
    }
}

struct BackupSettings: View {
    @StateObject private var backup = SettingsBackup.shared

    var body: some View {
        Form {
            Section {
                Toggle(isOn: $backup.iCloudSync) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Keep my notch setup in iCloud")
                        Text("Saves automatically whenever you change something.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.switch)
                LabeledContent("Copy in iCloud Drive") {
                    Text(backup.iCloudCopyDate.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? (SettingsBackup.iCloudFolder == nil ? "iCloud Drive is off" : "None yet"))
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Button("Save now") { backup.saveToICloudNow(); backup.refreshICloudInfo() }
                        .disabled(SettingsBackup.iCloudFolder == nil)
                    Button("Restore from iCloud…") { backup.restoreFromICloud() }
                        .disabled(SettingsBackup.iCloudFolder == nil)
                }
            } header: {
                Text("Sync with your Apple ID")
            } footer: {
                Text("Your setup is stored in iCloud Drive → Notch apple, under your own Apple ID. On a new Mac, install Notch apple, open this page and click Restore from iCloud. No separate account is needed.")
            }
            Section {
                HStack {
                    Button { backup.exportFile() } label: { Label("Export settings…", systemImage: "square.and.arrow.up") }
                    Button { backup.importFile() } label: { Label("Import settings…", systemImage: "square.and.arrow.down") }
                }
            } header: {
                Text("Backup file")
            } footer: {
                Text("A .notchsettings file with your modules, tab order, theme, shortcuts, Notch Extras, snippets, launcher apps, cities and more. Keep it, or share a setup with a friend. AI keys, your access code and Messenger identity are never included.")
            }
            if let m = backup.message {
                Section { Text(m).foregroundStyle(.secondary) }
            }
        }
        .formStyle(.grouped)
        .onAppear { backup.refreshICloudInfo() }
    }
}
