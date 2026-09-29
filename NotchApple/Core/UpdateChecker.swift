//
//  UpdateChecker.swift
//  Notch apple
//
//  Native updates from this project's GitHub releases.
//
//  • Checks api.github.com for the latest release (at launch, then every
//    6 hours) when "Check for updates automatically" is on. Nothing else is
//    sent: it's a plain, anonymous request.
//  • A newer version shows a notification, a badge on Settings → Updates and
//    a small pill in the notch. You choose: Update, or Not now (skips that
//    version until an even newer one comes out).
//  • Update downloads the release's DMG, checks the app inside is Notch apple
//    with the expected version, swaps it in place and relaunches.
//

import AppKit
import SwiftUI
import UserNotifications

@MainActor
final class UpdateChecker: ObservableObject {
    static let shared = UpdateChecker()
    static let notificationCategory = "notchapple.update"

    static let repo = "AdityaJainDXB/NotchApples"

    struct Release: Equatable {
        let version: String
        let title: String
        let notes: String
        let published: Date?
        let dmgURL: URL
        let pageURL: URL
    }

    enum Phase: Equatable {
        case idle, checking, upToDate, available, downloading(Double), installing, failed(String)
    }

    @AppStorage("updates.autoCheck") var autoCheck = true
    /// A version the user said "Not now" to; it won't be offered again.
    @AppStorage("updates.skippedVersion") var skippedVersion = ""
    @AppStorage("updates.notifiedVersion") private var notifiedVersion = ""

    @Published private(set) var latest: Release?
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var lastChecked: Date?

    var currentVersion: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0" }

    /// A newer release the user hasn't skipped.
    var pendingUpdate: Release? {
        guard let latest, Self.isNewer(latest.version, than: currentVersion), latest.version != skippedVersion else { return nil }
        return latest
    }

    private var timer: Timer?
    private var downloadObservation: NSKeyValueObservation?

    // MARK: Scheduling

    /// Starts or stops the automatic checks to match the preference.
    func applyPreference() {
        if autoCheck, timer == nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.check() }
            timer = Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { _ in
                MainActor.assumeIsolated { UpdateChecker.shared.check() }
            }
        } else if !autoCheck {
            timer?.invalidate()
            timer = nil
        }
    }

    // MARK: Checking

    func check(userInitiated: Bool = false) {
        if case .downloading = phase { return }
        guard phase != .checking, phase != .installing else { return }
        phase = .checking
        Task {
            do {
                let release = try await Self.fetchLatest()
                latest = release
                lastChecked = .now
                if userInitiated, release.version == skippedVersion { skippedVersion = "" }
                phase = pendingUpdate == nil ? .upToDate : .available
                if let update = pendingUpdate, update.version != notifiedVersion {
                    notifiedVersion = update.version
                    notify(update)
                }
            } catch {
                lastChecked = .now
                phase = userInitiated ? .failed(error.localizedDescription) : .idle
            }
        }
    }

    private static func fetchLatest() async throws -> Release {
        var request = URLRequest(url: URL(string: "https://api.github.com/repos/\(repo)/releases/latest")!)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("NotchApple", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 20
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tag = json["tag_name"] as? String,
              let page = (json["html_url"] as? String).flatMap(URL.init(string:)),
              let assets = json["assets"] as? [[String: Any]],
              let dmg = assets.first(where: { ($0["name"] as? String)?.hasSuffix(".dmg") == true }),
              let dmgURL = (dmg["browser_download_url"] as? String).flatMap(URL.init(string:)),
              dmgURL.host == "github.com"
        else { throw UpdateError.message("Couldn't read the latest release from GitHub.") }
        let version = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
        let published = (json["published_at"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }
        return Release(version: version, title: json["name"] as? String ?? "Notch apple \(version)",
                       notes: json["body"] as? String ?? "", published: published, dmgURL: dmgURL, pageURL: page)
    }

    /// Compares dotted versions numerically ("1.10.0" > "1.9.2").
    static func isNewer(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }, y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let l = i < x.count ? x[i] : 0, r = i < y.count ? y[i] : 0
            if l != r { return l > r }
        }
        return false
    }

    // MARK: Choices

    func skip() {
        if let latest { skippedVersion = latest.version }
        phase = .upToDate
    }

    private func notify(_ release: Release) {
        let content = UNMutableNotificationContent()
        content.title = "Update available"
        content.body = "Notch apple \(release.version) is ready. Would you like to update?"
        content.categoryIdentifier = Self.notificationCategory
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "update-\(release.version)", content: content, trigger: nil))
    }

    // MARK: Installing

    func install() {
        guard let release = pendingUpdate ?? latest else { return }
        phase = .downloading(0)
        let task = URLSession.shared.downloadTask(with: release.dmgURL) { [weak self] file, response, error in
            // The temporary file is deleted when this handler returns, so move it now.
            var moved: URL?
            if let file, (response as? HTTPURLResponse)?.statusCode == 200 {
                let dest = FileManager.default.temporaryDirectory.appendingPathComponent("NotchApple-\(release.version)-\(UUID().uuidString).dmg")
                if (try? FileManager.default.moveItem(at: file, to: dest)) != nil { moved = dest }
            }
            let failure = error?.localizedDescription
            Task { @MainActor in
                guard let self else { return }
                self.downloadObservation = nil
                guard let dmg = moved else {
                    self.phase = .failed(failure ?? "The download didn't finish. Try again.")
                    return
                }
                self.phase = .installing
                do {
                    try await Self.installApp(from: dmg, expectedVersion: release.version)
                } catch {
                    self.phase = .failed(error.localizedDescription)
                }
            }
        }
        downloadObservation = task.progress.observe(\.fractionCompleted) { progress, _ in
            let value = progress.fractionCompleted
            Task { @MainActor in
                if case .downloading = UpdateChecker.shared.phase { UpdateChecker.shared.phase = .downloading(value) }
            }
        }
        task.resume()
    }

    /// Mounts the DMG, checks the app, stages a copy, then hands off to a tiny
    /// script that swaps it in once this process has quit and relaunches it.
    private static func installApp(from dmg: URL, expectedVersion: String) async throws {
        let fm = FileManager.default
        let mount = fm.temporaryDirectory.appendingPathComponent("notchapple-update-\(UUID().uuidString)")
        try fm.createDirectory(at: mount, withIntermediateDirectories: true)
        try await run("/usr/bin/hdiutil", ["attach", dmg.path, "-nobrowse", "-noautoopen", "-readonly", "-mountpoint", mount.path])
        defer { Task.detached { try? await run("/usr/bin/hdiutil", ["detach", mount.path, "-force"]) } }

        guard let appName = try fm.contentsOfDirectory(atPath: mount.path).first(where: { $0.hasSuffix(".app") }) else {
            throw UpdateError.message("The download doesn't contain the app.")
        }
        let newApp = mount.appendingPathComponent(appName)
        guard let info = Bundle(url: newApp)?.infoDictionary,
              info["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier,
              info["CFBundleShortVersionString"] as? String == expectedVersion else {
            throw UpdateError.message("The downloaded app isn't the expected Notch apple \(expectedVersion).")
        }
        // Make sure the code signature is intact (not tampered with in transit).
        try await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", newApp.path])

        let staged = fm.temporaryDirectory.appendingPathComponent("NotchApple-staged-\(UUID().uuidString).app")
        try await run("/usr/bin/ditto", [newApp.path, staged.path])

        let target = Bundle.main.bundleURL
        guard fm.isWritableFile(atPath: target.deletingLastPathComponent().path) else {
            throw UpdateError.message("Can't write to \(target.deletingLastPathComponent().path). Download the DMG from GitHub instead.")
        }
        // Wait for us to quit, move the old copy to the Trash-like temp spot, put the new one in, relaunch.
        let backup = fm.temporaryDirectory.appendingPathComponent("NotchApple-previous-\(UUID().uuidString).app")
        let script = """
        while kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do sleep 0.2; done
        mv "$1" "$3" && mv "$2" "$1" && xattr -dr com.apple.quarantine "$1" 2>/dev/null
        open "$1"
        """
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", script, "sh", target.path, staged.path, backup.path]
        try process.run()
        NSApp.terminate(nil)
    }

    @discardableResult
    private static func run(_ tool: String, _ args: [String]) async throws -> String {
        try await withCheckedThrowingContinuation { cont in
            let p = Process()
            p.executableURL = URL(fileURLWithPath: tool)
            p.arguments = args
            let pipe = Pipe()
            p.standardOutput = pipe
            p.standardError = pipe
            p.terminationHandler = { proc in
                let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                if proc.terminationStatus == 0 { cont.resume(returning: out) }
                else { cont.resume(throwing: UpdateError.message("\((tool as NSString).lastPathComponent) failed: \(out.trimmingCharacters(in: .whitespacesAndNewlines))")) }
            }
            do { try p.run() } catch { cont.resume(throwing: error) }
        }
    }

    enum UpdateError: LocalizedError {
        case message(String)
        var errorDescription: String? { if case .message(let m) = self { m } else { nil } }
    }
}

// MARK: - Settings → Updates

struct UpdatesSettings: View {
    @StateObject private var updater = UpdateChecker.shared

    var body: some View {
        Form {
            Section {
                Toggle("Check for updates automatically", isOn: $updater.autoCheck)
                    .onChange(of: updater.autoCheck) { _, _ in updater.applyPreference() }
                LabeledContent("Current version", value: updater.currentVersion)
                LabeledContent("Last checked") {
                    Text(updater.lastChecked.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "Not yet")
                }
                HStack {
                    Spacer()
                    Button(updater.phase == .checking ? "Checking…" : "Check now") { updater.check(userInitiated: true) }
                        .disabled(updater.phase == .checking)
                }
            } footer: {
                Text("Notch apple asks GitHub for the latest release. Nothing about you is sent. With automatic checks off, it only checks when you press Check now.")
            }

            if let release = updater.pendingUpdate {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Update available", systemImage: "arrow.down.circle.fill")
                            .font(.headline).foregroundStyle(Theme.accent)
                        Text("Notch apple \(release.version) is ready. Would you like to update?")
                        if let date = release.published {
                            Text("Released \(date.formatted(date: .abbreviated, time: .omitted))").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    progressRow
                    HStack {
                        Link("Release notes on GitHub", destination: release.pageURL).font(.callout)
                        Spacer()
                        Button("Not now") { updater.skip() }.disabled(isBusy)
                        Button("Update") { updater.install() }
                            .buttonStyle(.borderedProminent)
                            .disabled(isBusy)
                    }
                    if !release.notes.isEmpty {
                        ScrollView {
                            Text(LocalizedStringKey(Self.readable(release.notes)))
                                .font(.callout)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                        }
                        .frame(maxHeight: 220)
                    }
                } header: {
                    Text(release.title)
                } footer: {
                    Text("Update downloads the new version from GitHub, replaces this copy and reopens Notch apple. Your settings and data are kept. Not now hides this version until a newer one comes out.")
                }
            } else if updater.phase == .upToDate {
                Section { Label("You're up to date.", systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
            }

            if case .failed(let message) = updater.phase {
                Section { Label(message, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
            }
        }
        .formStyle(.grouped)
    }

    /// GitHub release notes are Markdown; SwiftUI shows inline styles but not
    /// headings, so turn "## Heading" lines into bold text.
    static func readable(_ markdown: String) -> String {
        markdown.split(separator: "\n", omittingEmptySubsequences: false).map { line in
            let t = line.trimmingCharacters(in: .whitespaces)
            guard t.hasPrefix("#") else { return String(line) }
            return "**" + t.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces) + "**"
        }.joined(separator: "\n")
    }

    private var isBusy: Bool {
        switch updater.phase {
        case .downloading, .installing: true
        default: false
        }
    }

    @ViewBuilder private var progressRow: some View {
        switch updater.phase {
        case .downloading(let value): ProgressView("Downloading…", value: value)
        case .installing: ProgressView("Installing… Notch apple will reopen by itself.").progressViewStyle(.linear)
        default: EmptyView()
        }
    }
}

/// A small pill in the notch header when an update is waiting.
struct UpdatePill: View {
    @ObservedObject private var updater = UpdateChecker.shared
    let open: () -> Void

    var body: some View {
        if let release = updater.pendingUpdate {
            Button(action: open) {
                Label("Update", systemImage: "arrow.down.circle.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .frame(height: 26)
                    .background(Capsule().fill(Theme.accentGradient))
            }
            .buttonStyle(.plain)
            .help("Notch apple \(release.version) is available")
        }
    }
}
