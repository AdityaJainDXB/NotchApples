//
//  TrustSettings.swift
//  Notch apple
//
//  Platform and trust:
//   • Privacy dashboard (free): every permission, every place Notch apple can
//     connect to and when, and what it keeps on this Mac, with Delete buttons.
//   • Help & Feedback (free): send feedback, and a bug report you read in full
//     before anything leaves your Mac (it opens a GitHub issue you submit yourself).
//   • Crash reports (free, off by default): after a crash, offers to send the
//     macOS crash report, with your name and home folder removed, after you review it.
//   • Beta channel and priority support (Ultimate).
//   • iCloud sync of notes and to-dos (Ultimate).
//

import AppKit
import AVFoundation
import EventKit
import SwiftUI

// MARK: - Privacy dashboard

struct PrivacyDashboard: View {
    @StateObject private var permissions = PermissionsModel.shared
    @ObservedObject private var settings = SettingsManager.shared
    @State private var sizes: [String: Int64] = [:]
    @State private var confirm: DataItem?

    struct Destination: Identifiable {
        var id: String { host }
        let host: String
        let what: String
        let when: String
        let active: Bool
    }

    struct DataItem: Identifiable {
        var id: String { path }
        let title: String
        let path: String
        let note: String
    }

    private var support: URL { FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Notch apple") }

    private var destinations: [Destination] {
        let ai = AIConfig.shared.provider
        let onDevice = ai == .ollama || ai == .apple
        return [
            Destination(host: onDevice ? "Nowhere (on this Mac)" : ai.title, what: "Your AI questions, and images you choose to send", when: "Only when you ask", active: settings.claudeEnabled),
            Destination(host: "DuckDuckGo", what: "The question, when web search is on", when: "Only with the globe turned on (Pro)", active: Entitlements.shared.canUse(.webSearch)),
            Destination(host: "api.github.com, github.com", what: "Nothing about you: the release list", when: "Update checks (can be turned off)", active: true),
            Destination(host: "open-meteo.com", what: "Your approximate location", when: "Weather", active: settings.todayEnabled),
            Destination(host: "ESPN, Jolpica, F1 live timing", what: "Nothing about you: public scores", when: "Sports, Live, F1 and Tennis tabs", active: settings.sportsEnabled || settings.f1Enabled || settings.tennisEnabled || settings.liveEnabled),
            Destination(host: "LRCLIB", what: "Song title and artist", when: "Lyrics (Pro)", active: settings.showLyrics && Entitlements.shared.canUse(.lyrics)),
            Destination(host: "CoinGecko, Yahoo Finance", what: "Symbols you add", when: "Markets (Pro)", active: settings.marketsEnabled),
            Destination(host: "ADSB.lol", what: "Flight numbers you pin", when: "Live flight status (Pro)", active: !FlightWatcher.shared.pinned.isEmpty),
            Destination(host: "ADSB.lol", what: "Your approximate location (rounded to about 1 km)", when: "Flight Radar tab, only while it is open", active: settings.radarEnabled),
            Destination(host: "open.er-api.com", what: "Nothing about you: today's rates", when: "Currency conversion (Pro)", active: Entitlements.shared.canUse(.currency)),
            Destination(host: "License server", what: "Your key and a one-way hash of this Mac", when: "Activating or deactivating a key; a daily signed revocation list; renewing the 72-hour tokens that unlock server-held content (premium Klick sounds, Clipboard Link)", active: Entitlements.shared.key != nil),
            Destination(host: "Google / Firebase", what: "Your settings and activation", when: "Only if you sign in (Backup & Sync)", active: AccountSync.shared.isSignedIn),
            Destination(host: "iCloud Drive", what: "Settings, notes and to-dos you choose to sync", when: "Only if sync is on", active: SettingsBackup.shared.iCloudSync || NotesCloudSync.shared.enabled),
            Destination(host: "Your plugins", what: "Whatever your plugin scripts do", when: "Plugins tab", active: settings.pluginsEnabled),
            Destination(host: "apple.com", what: "Nothing about you: a tiny test page, to see if you're online", when: "Every 20 seconds, only if “Tell me when the internet drops” is on", active: SystemWatch.shared.internetAlert),
            Destination(host: "Cloudflare (speed.cloudflare.com)", what: "Nothing about you: about 20 MB to measure your speed", when: "Only when you press Speed test in Stats", active: false),
            Destination(host: "Notch apple room relay (Cloudflare)", what: "Scrambled clipboard text only your devices can read, and Messenger room traffic", when: "Clipboard Link or Messenger rooms, when on", active: ClipboardLink.shared.enabled || WebP2PManager.shared.state == .joined),
            Destination(host: "Your Home Assistant", what: "Your device states and the commands you press", when: "Smart Home, once you connect it (your own server)", active: SmartHomeStore.shared.configured),
        ]
    }

    private var dataItems: [DataItem] {
        [
            DataItem(title: "AI history", path: support.appendingPathComponent("ai-history.json").path, note: "Conversations and captured images"),
            DataItem(title: "AI images", path: support.appendingPathComponent("ai-images").path, note: "Images saved with AI history"),
            DataItem(title: "Clipboard history", path: support.appendingPathComponent("Clipboard").path, note: "Text, links and images you copied"),
            DataItem(title: "Notes", path: support.appendingPathComponent("notes.json").path, note: "Your quick notes"),
            DataItem(title: "To-dos", path: support.appendingPathComponent("todos.json").path, note: "Your to-do list"),
            DataItem(title: "Voice notes", path: support.appendingPathComponent("Voice Notes").path, note: "Recordings and transcripts"),
        ]
    }

    @AppStorage(PanicHide.hotkeyKey) private var panicOn = true
    @AppStorage(PanicHide.wipeKey) private var panicWipe = true

    var body: some View {
        Form {
            Section {
                row("Screen Recording", ScreenPermission.isGranted, "Capturing for AI, Text Grab, recordings")
                row("Accessibility", AXIsProcessTrusted(), "Volume keys, selected text, pasting snippets, text expander, Klick sounds")
                row("Calendar", permissions.calendar == .fullAccess, "Today, meeting alerts, automations")
                row("Reminders", EKEventStore.authorizationStatus(for: .reminder) == .fullAccess, "To-do sync (Pro)")
                row("Camera", permissions.camera == .authorized, "Mirror, face unlock")
                row("Microphone", AVCaptureDevice.authorizationStatus(for: .audio) == .authorized, "Voice notes, dictation")
                row("Notifications", permissions.notifications == .authorized, "Alerts and automation results")
                Button("Change in System Settings…") { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy")!) }
            } header: {
                Text("What Notch apple can access")
            } footer: {
                Text("Nothing is required. Each permission only powers the features listed next to it.")
            }

            Section {
                ForEach(destinations) { d in
                    HStack(alignment: .top) {
                        Circle().fill(d.active ? Color.green : Color.gray.opacity(0.5)).frame(width: 8, height: 8).padding(.top, 5)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(d.host).font(.callout.weight(.semibold))
                            Text("\(d.what) · \(d.when)").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityValue(d.active ? "In use" : "Not in use")
                }
            } header: {
                Text("Where it connects")
            } footer: {
                Text("Green means the feature that uses it is on. No analytics, no tracking and no ads, ever. The app never sends anything in the background except what's listed here.")
            }

            Section {
                Toggle("Panic hide shortcut (⌃⌥⇧P)", isOn: Binding(get: { panicOn }, set: { panicOn = $0; AppDelegate.current?.reapplyHotkeys() }))
                Toggle("Also wipe the clipboard history (pinned items stay)", isOn: $panicWipe)
                Button("Panic hide now") { PanicHide.run() }
            } header: {
                Text("Panic hide")
            } footer: {
                Text("One key for “someone just walked up”: it closes the notch, hides it completely, and empties the clipboard. Bring the notch back with the hide shortcut (\(HotkeyBinding.invisibility.label) by default).")
            }

            Section {
                ForEach(dataItems) { item in
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(item.title)
                            Text(item.note).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(ByteCountFormatter.string(fromByteCount: sizes[item.path] ?? 0, countStyle: .file)).monospacedDigit().foregroundStyle(.secondary)
                        Button("Delete…", role: .destructive) { confirm = item }.disabled((sizes[item.path] ?? 0) == 0)
                    }
                }
                Button("Show in Finder") { NSWorkspace.shared.open(support) }
            } header: {
                Text("What's kept on this Mac")
            } footer: {
                Text("Everything stays in your Application Support folder unless you turn on sync. Keys and secrets are in a private file only your account can read.")
            }
        }
        .formStyle(.grouped)
        .onAppear { permissions.refresh(); measure() }
        .confirmationDialog("Delete \(confirm?.title ?? "")?", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } })) {
            Button("Delete", role: .destructive) {
                if let c = confirm { try? FileManager.default.removeItem(atPath: c.path) }
                confirm = nil
                measure()
            }
        } message: { Text("This can't be undone. Restart Notch apple afterwards so it starts fresh.") }
    }

    private func row(_ name: String, _ granted: Bool, _ use: String) -> some View {
        HStack {
            Image(systemName: granted ? "checkmark.circle.fill" : "circle").foregroundStyle(granted ? .green : .secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                Text(use).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(granted ? "Allowed" : "Off").foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private func measure() {
        var out: [String: Int64] = [:]
        for item in dataItems { out[item.path] = Self.size(of: URL(fileURLWithPath: item.path)) }
        sizes = out
    }

    static func size(of url: URL) -> Int64 {
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) else { return 0 }
        if !isDir.boolValue { return Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
        let files = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.fileSizeKey])?.compactMap { $0 as? URL } ?? []
        return files.reduce(0) { $0 + Int64((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
    }
}

// MARK: - Bug reports and crash reports

enum BugReport {
    /// Everything useful for fixing a bug, and nothing personal: no keys, notes, history or file names.
    @MainActor static func build(description: String = "") -> String {
        let info = ProcessInfo.processInfo
        var model = [CChar](repeating: 0, count: 64); var len = 64
        sysctlbyname("hw.model", &model, &len, nil, 0)
        let modules = SettingsManager.shared.enabledTabs.map(\.rawValue).joined(separator: ", ")
        return """
        **What happened**
        \(description.isEmpty ? "(describe what you did and what went wrong)" : description)

        **Environment**
        - Notch apple \(WhatsNew.currentVersion) (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"))
        - macOS \(info.operatingSystemVersionString)
        - Mac: \(String(cString: model)), \(ProcessInfo.processInfo.processorCount) cores
        - Tier: \(Entitlements.shared.tier.name)
        - Tabs on: \(modules)
        - AI provider: \(AIConfig.shared.provider.title)
        - Displays: \(NSScreen.screens.count) (notch: \(NSScreen.screens.contains { $0.safeAreaInsets.top > 0 } ? "yes" : "no"))
        """
    }

    /// Removes your user name and home folder from text.
    static func redact(_ text: String) -> String {
        text.replacingOccurrences(of: NSHomeDirectory(), with: "~")
            .replacingOccurrences(of: NSUserName(), with: "<user>")
            .replacingOccurrences(of: NSFullUserName(), with: "<name>")
    }

    /// Opens a GitHub issue with `body` filled in; you review and submit it yourself.
    static func openIssue(title: String, body: String, label: String) {
        var c = URLComponents(string: "https://github.com/AdityaJainDXB/NotchApples/issues/new")!
        c.queryItems = [.init(name: "title", value: title), .init(name: "labels", value: label), .init(name: "body", value: String(body.prefix(6000)))]
        if let url = c.url { NSWorkspace.shared.open(url) }
    }
}

@MainActor
final class CrashReports: ObservableObject {
    static let shared = CrashReports()
    /// Off by default: until you turn it on, crash reports are never looked at.
    @AppStorage("crash.optIn") var optIn = false
    @AppStorage("crash.lastChecked") private var lastChecked = Date.now.timeIntervalSince1970
    @Published private(set) var pending: String?

    /// Looks for a new macOS crash report for Notch apple since the last launch.
    func checkAtLaunch() {
        defer { lastChecked = Date.now.timeIntervalSince1970 }
        guard optIn else { return }
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/DiagnosticReports")
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        guard let newest = files
            .filter({ $0.lastPathComponent.hasPrefix("Notch apple") && ["ips", "crash"].contains($0.pathExtension) })
            .compactMap({ url -> (URL, Date)? in (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate).map { (url, $0) } })
            .filter({ $0.1.timeIntervalSince1970 > lastChecked })
            .max(by: { $0.1 < $1.1 }),
              let text = try? String(contentsOf: newest.0, encoding: .utf8) else { return }
        // The first part of the report holds the crash reason and the crashed thread.
        pending = BugReport.redact(String(text.prefix(8000)))
        Notifier.post(title: "Notch apple quit unexpectedly", body: "Open Settings → Help & Feedback to review the crash report and send it if you'd like.")
    }

    func send() {
        guard let report = pending else { return }
        BugReport.openIssue(title: "Crash report (\(WhatsNew.currentVersion))",
                            body: BugReport.build(description: "Notch apple quit unexpectedly.") + "\n\n**Crash report (reviewed by me, name and home folder removed)**\n```\n\(report.prefix(4500))\n```",
                            label: "crash")
        pending = nil
    }

    func discard() { pending = nil }
}

struct HelpSettings: View {
    @ObservedObject private var crashes = CrashReports.shared
    @ObservedObject private var entitlements = Entitlements.shared
    @ObservedObject private var notesSync = NotesCloudSync.shared
    @AppStorage("updates.beta") private var beta = false
    @State private var describe = ""
    @State private var reviewing: String?

    var body: some View {
        Form {
            Section {
                TextField("What happened, or what would you like?", text: $describe, axis: .vertical).lineLimit(2...5)
                HStack {
                    Button("Review the bug report…") { reviewing = BugReport.build(description: describe) }
                    Button("Suggest a feature") {
                        BugReport.openIssue(title: "Idea: \(describe.prefix(60))", body: describe.isEmpty ? "(your idea)" : describe, label: "enhancement")
                    }
                }
            } header: {
                Text("Feedback")
            } footer: {
                Text("A bug report has your app version, macOS, Mac model and which tabs are on: no keys, notes, history or file names. You see all of it first, then submit it on GitHub yourself.")
            }

            Section {
                Toggle(isOn: $crashes.optIn) {
                    Text("Offer to send crash reports")
                    Text("After a crash, you'll be asked to review the macOS crash report (your name and home folder removed) before sending it. Off until you turn it on.")
                }
                if let pending = crashes.pending {
                    Text("A crash report is ready for review.").foregroundStyle(.orange)
                    HStack {
                        Button("Review and send…") { reviewing = pending }
                        Button("Discard", role: .destructive) { crashes.discard() }
                    }
                }
            } header: {
                Text("Crash reports")
            }

            Section {
                Toggle(isOn: $beta) {
                    Text("Get beta versions")
                    Text("Try new versions before everyone else. Betas can have bugs; you can switch back any time.")
                }
                .disabled(!entitlements.canUse(.betaChannel))
                .onChange(of: beta) { _, _ in UpdateChecker.shared.check(userInitiated: false) }
                Button("Priority support…") {
                    BugReport.openIssue(title: "Priority support: \(describe.prefix(60))",
                                        body: BugReport.build(description: describe) + "\n- Ultimate key: \(entitlements.key?.masked ?? "?")",
                                        label: "priority")
                }
                .disabled(!entitlements.canUse(.prioritySupport))
                Toggle(isOn: $notesSync.enabled) {
                    Text("Sync notes and to-dos with iCloud")
                    Text("Keeps them the same on every Mac signed in to your iCloud Drive.")
                }
                .disabled(!entitlements.canUse(.notesSync))
            } header: {
                HStack(spacing: 6) {
                    Text("Ultimate")
                    if entitlements.tier < .ultimate { TierBadge(tier: .ultimate) }
                }
            } footer: {
                Text("Priority support issues are answered first. Your theme already syncs with settings sync (Pro).")
            }

            Section {
                Link("Read the README", destination: URL(string: "https://github.com/AdityaJainDXB/NotchApples#readme")!)
                Link("Help translate Notch apple", destination: URL(string: "https://github.com/AdityaJainDXB/NotchApples/blob/main/CONTRIBUTING.md#translations")!)
                Link("Donate 💜", destination: URL(string: "https://github.com/AdityaJainDXB/NotchApples#donate-")!)
            }
        }
        .formStyle(.grouped)
        .sheet(item: Binding(get: { reviewing.map(Review.init) }, set: { reviewing = $0?.text })) { r in
            VStack(alignment: .leading, spacing: 10) {
                Text("Review before sending").font(.title3.bold())
                Text("This is everything that will be sent. Nothing leaves your Mac until you submit the GitHub issue.").foregroundStyle(.secondary)
                ScrollView { Text(r.text).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                    .frame(height: 280).padding(8).background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                HStack {
                    Button("Copy") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(r.text, forType: .string) }
                    Spacer()
                    Button("Cancel") { reviewing = nil }
                    Button("Open GitHub issue") {
                        if r.text == crashes.pending { crashes.send() }
                        else { BugReport.openIssue(title: "Bug: \(describe.prefix(60))", body: r.text, label: "bug") }
                        reviewing = nil
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
            .padding(20).frame(width: 560)
        }
    }

    private struct Review: Identifiable { let text: String; var id: String { text } }
}

// MARK: - iCloud sync of notes and to-dos (Ultimate)

/// Keeps notes.json and todos.json in iCloud Drive (Notch apple/Notes). Whichever copy
/// was changed last wins, checked at launch and every 30 seconds while the app runs.
@MainActor
final class NotesCloudSync: ObservableObject {
    static let shared = NotesCloudSync()
    @AppStorage("sync.notes") var enabled = false { didSet { syncNow() } }

    private var local: URL { FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Notch apple") }
    private var cloud: URL? { SettingsBackup.iCloudFolder?.appendingPathComponent("Notes", isDirectory: true) }

    func syncNow() {
        guard enabled, Entitlements.shared.canUse(.notesSync), let cloud else { return }
        try? FileManager.default.createDirectory(at: cloud, withIntermediateDirectories: true)
        var pulled = false
        for name in ["notes.json", "todos.json"] {
            let l = local.appendingPathComponent(name), c = cloud.appendingPathComponent(name)
            let lm = (try? l.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let cm = (try? c.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            if cm > lm.addingTimeInterval(2), let data = try? Data(contentsOf: c) {
                try? data.write(to: l, options: .atomic); pulled = true
            } else if lm > cm.addingTimeInterval(2), let data = try? Data(contentsOf: l) {
                try? data.write(to: c, options: .atomic)
            }
        }
        if pulled { NotesStore.shared.reloadFromDisk(); TodoStore.shared.reloadFromDisk() }
    }
}
