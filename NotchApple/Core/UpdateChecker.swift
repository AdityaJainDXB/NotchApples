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
        guard let latest, VersionMath.shouldOffer(version: latest.version, installed: currentVersion, skipped: skippedVersion, prerelease: false, beta: false) else { return nil }
        return latest
    }

    /// The release notes line that makes an update compulsory in the notch.
    static let requiredMarker = "[required-update]"

    /// A newer release flagged as required. It ignores "Not now", and the notch shows only the update screen.
    var requiredUpdate: Release? {
        guard let latest, latest.notes.localizedCaseInsensitiveContains(Self.requiredMarker),
              Self.isNewer(latest.version, than: currentVersion) else { return nil }
        return latest
    }

    private var timer: Timer?
    private var downloadObservation: NSKeyValueObservation?

    // MARK: Scheduling

    /// Starts or stops the automatic checks to match the preference.
    func applyPreference() {
        clearStaleNotifications()
        // The screenshot build (DemoHooks) must never check or notify: it isn't a real install.
        if DemoHooks.isDemo { timer?.invalidate(); timer = nil; return }
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
        if DemoHooks.isDemo { return }
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
                if pendingUpdate == nil { clearStaleNotifications() }
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

    /// The newest release that ships a Mac DMG.
    ///
    /// Deliberately not `/releases/latest`: that returns whatever was published
    /// most recently, which may be a release for another platform (the Windows
    /// build is tagged `win-v…` and carries only .exe/.msi). Scanning the list
    /// and keeping only releases with a .dmg means other platforms can never
    /// stop the Mac app from updating.
    private static func fetchLatest() async throws -> Release {
        var request = URLRequest(url: URL(string: "https://api.github.com/repos/\(repo)/releases?per_page=20")!)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("NotchApple", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 20
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let list = try JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { throw UpdateError.message("Couldn't reach GitHub to check for updates.") }

        let releases = list.compactMap(parse).sorted { isNewer($0.version, than: $1.version) }
        guard let newest = releases.first else {
            throw UpdateError.message("No Mac release with a download was found on GitHub.")
        }
        return newest
    }

    /// One release from the GitHub API, or nil when it isn't a Mac release we can install.
    private static func parse(_ json: [String: Any]) -> Release? {
        // Betas (GitHub pre-releases) only for Ultimate with Get beta versions on.
        if json["prerelease"] as? Bool == true,
           !(UserDefaults.standard.bool(forKey: "updates.beta") && UserDefaults.standard.bool(forKey: "updates.ultimateAllowed")) { return nil }
        guard json["draft"] as? Bool != true,
              let tag = json["tag_name"] as? String,
              let page = (json["html_url"] as? String).flatMap(URL.init(string:)),
              let assets = json["assets"] as? [[String: Any]],
              let dmg = assets.first(where: { ($0["name"] as? String)?.hasSuffix(".dmg") == true }),
              let dmgURL = (dmg["browser_download_url"] as? String).flatMap(URL.init(string:)),
              dmgURL.host == "github.com",
              let version = versionNumber(from: tag)
        else { return nil }
        let published = (json["published_at"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }
        return Release(version: version, title: json["name"] as? String ?? "Notch apple \(version)",
                       notes: json["body"] as? String ?? "", published: published, dmgURL: dmgURL, pageURL: page)
    }

    static func versionNumber(from tag: String) -> String? { VersionMath.number(from: tag) }
    static func isNewer(_ a: String, than b: String) -> Bool { VersionMath.isNewer(a, than: b) }

    // MARK: Choices

    func skip() {
        if let latest { skippedVersion = latest.version }
        phase = .upToDate
    }

    /// Removes "Update available" notifications for versions this Mac already has (or newer),
    /// so an old alert never says you're out of date after you've updated.
    func clearStaleNotifications() {
        let current = currentVersion
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { delivered in
            let stale = delivered.map(\.request.identifier).filter { id in
                guard id.hasPrefix("update-") else { return false }
                return !Self.isNewer(String(id.dropFirst("update-".count)), than: current)
            }
            center.removeDeliveredNotifications(withIdentifiers: stale)
        }
    }

    private func notify(_ release: Release) {
        guard !DemoHooks.isDemo, Self.isNewer(release.version, than: currentVersion) else { return }
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
        let staged = fm.temporaryDirectory.appendingPathComponent("NotchApple-staged-\(UUID().uuidString).app")
        // --norsrc --noextattr: a plain copy off the disk image carries Finder
        // information that makes the signature check reject the app even though
        // the signature is perfectly good.
        try await run("/usr/bin/ditto", ["--norsrc", "--noextattr", newApp.path, staged.path])
        _ = try? await run("/usr/bin/xattr", ["-cr", staged.path])   // best effort: macOS re-adds some itself

        // Check the signature is intact (not tampered with in transit) and that this
        // really is Notch apple. `--deep` is not used: Apple deprecated it for
        // verification and it trips over attributes macOS adds on its own.
        try await run("/usr/bin/codesign", ["--verify", staged.path])
        let requirement = try await run("/usr/bin/codesign", ["-d", "-r-", staged.path])
        guard let id = Bundle.main.bundleIdentifier, requirement.contains("identifier \"\(id)\"") else {
            throw UpdateError.message("The downloaded app isn't signed as Notch apple.")
        }

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

    /// Collects a tool's output from a background thread.
    private final class Output: @unchecked Sendable {
        private let lock = NSLock()
        private var data = Data()
        func append(_ chunk: Data) { lock.lock(); data.append(chunk); lock.unlock() }
        var text: String {
            lock.lock(); defer { lock.unlock() }
            return String(data: data, encoding: .utf8) ?? ""
        }
    }

    @discardableResult
    private static func run(_ tool: String, _ args: [String], timeout: TimeInterval = 300) async throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = args
        process.standardInput = FileHandle.nullDevice   // never block waiting to be typed at
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        // Read the pipe while the tool runs. Reading only once it has exited
        // deadlocks the moment a tool writes more than the pipe buffer holds —
        // it blocks on write, so it never exits, so we wait for ever.
        let output = Output()
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            if chunk.isEmpty { handle.readabilityHandler = nil } else { output.append(chunk) }
        }

        // A tool that somehow never finishes must not leave the update stuck.
        let watchdog = Task {
            try? await Task.sleep(for: .seconds(timeout))
            if process.isRunning { process.terminate() }
        }
        defer { watchdog.cancel() }

        let status: Int32 = try await withCheckedThrowingContinuation { cont in
            process.terminationHandler = { proc in
                pipe.fileHandleForReading.readabilityHandler = nil
                cont.resume(returning: proc.terminationStatus)
            }
            do { try process.run() } catch { cont.resume(throwing: error) }
        }

        let text = output.text
        guard status == 0 else {
            let detail = text.trimmingCharacters(in: .whitespacesAndNewlines)
            throw UpdateError.message("\((tool as NSString).lastPathComponent) failed: "
                + (detail.isEmpty ? "exit code \(status)" : detail))
        }
        return text
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
                    // Shown right here, beside the button: at the foot of the window
                    // it is easy to miss and the update looks like it did nothing.
                    if case .failed(let message) = updater.phase {
                        VStack(alignment: .leading, spacing: 4) {
                            Label(message, systemImage: "exclamationmark.triangle.fill")
                                .foregroundStyle(.orange).font(.callout)
                            Text("You can try again, or download it yourself from the release page.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    HStack {
                        Link("Release notes on GitHub", destination: release.pageURL).font(.callout)
                        Spacer()
                        Button("Not now") { updater.skip() }.disabled(isBusy)
                        Button(isFailed ? "Try again" : "Update") { updater.install() }
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

            // Only when there is no update section to show it beside.
            if case .failed(let message) = updater.phase, updater.pendingUpdate == nil {
                Section { Label(message, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
            }
        }
        .formStyle(.grouped)
    }

    /// GitHub release notes are Markdown; SwiftUI shows inline styles but not
    /// headings, so turn "## Heading" lines into bold text.
    static func readable(_ markdown: String) -> String {
        markdown.split(separator: "\n", omittingEmptySubsequences: false)
            .filter { !$0.localizedCaseInsensitiveContains(UpdateChecker.requiredMarker) }.map { line in
            let t = line.trimmingCharacters(in: .whitespaces)
            guard t.hasPrefix("#") else { return String(line) }
            return "**" + t.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces) + "**"
        }.joined(separator: "\n")
    }

    private var isFailed: Bool {
        if case .failed = updater.phase { return true }
        return false
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
        case .installing: ProgressView("Installing… Notch apple will quit and reopen by itself.").progressViewStyle(.linear)
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
