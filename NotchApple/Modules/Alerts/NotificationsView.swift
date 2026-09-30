//
//  NotificationsView.swift
//  Notch apple
//
//  Mirrors notifications from other apps into the notch. macOS has no public
//  API to read other apps' notifications, so this reads Notification Center's
//  own database (read-only), which needs Full Disk Access. New notifications
//  flash a bell beside the closed notch; the tab lists recent ones, opens the
//  app, and can reply to iMessages through the Messages app.
//

import AppKit
import SQLite3
import SwiftUI

@MainActor
final class NotificationMirror: ObservableObject {
    static let shared = NotificationMirror()

    struct Item: Identifiable, Equatable {
        let id: Int64
        let bundleID: String
        let title: String
        let subtitle: String
        let body: String
        let date: Date
        var appName: String {
            NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID)
                .map { FileManager.default.displayName(atPath: $0.path).replacingOccurrences(of: ".app", with: "") } ?? bundleID
        }
    }

    @Published private(set) var items: [Item] = []
    @Published private(set) var hasAccess = true
    @Published private(set) var unseen = 0
    private var lastID: Int64 = -1
    private var timer: Timer?

    func setRunning(_ on: Bool) {
        if on, timer == nil {
            let t = Timer(timeInterval: 3, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.poll() } }
            RunLoop.main.add(t, forMode: .common)
            timer = t
            poll()
        } else if !on, timer != nil {
            timer?.invalidate()
            timer = nil
        }
    }

    func markSeen() { unseen = 0 }

    func poll() {
        let since = lastID
        Task.detached {
            let result = Self.read(after: since)
            await MainActor.run { self.apply(result) }
        }
    }

    private func apply(_ result: (access: Bool, items: [Item])) {
        hasAccess = result.access
        guard result.access else { return }
        let fresh = result.items.filter { $0.bundleID != Bundle.main.bundleIdentifier }
        let firstLoad = lastID < 0
        if let maxID = result.items.map(\.id).max() { lastID = max(lastID, maxID) } else if firstLoad { lastID = 0 }
        guard !fresh.isEmpty else { return }
        items = Array((fresh.sorted { $0.date > $1.date } + items).prefix(60))
        if !firstLoad {
            unseen += fresh.count
            if SettingsManager.shared.flashNotifications {
                LiveActivityCenter.shared.flash(LiveActivity(symbol: "bell.badge.fill", label: unseen > 9 ? "9+" : "\(unseen)",
                                                             tint: NSColor(Theme.accentBright)), seconds: 5)
            }
        }
    }

    // MARK: Database

    nonisolated private static var databaseURL: URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let candidates = [home.appendingPathComponent("Library/Group Containers/group.com.apple.usernoted/db2/db")]
            + (darwinUserDir().map { [URL(fileURLWithPath: $0).appendingPathComponent("com.apple.notificationcenter/db2/db")] } ?? [])
        return candidates.first { FileManager.default.fileExists(atPath: $0.path) } ?? candidates.first
    }

    nonisolated private static func darwinUserDir() -> String? {
        var buf = [CChar](repeating: 0, count: Int(PATH_MAX))
        let n = confstr(_CS_DARWIN_USER_DIR, &buf, buf.count)
        return n > 0 ? String(cString: buf) : nil
    }

    nonisolated private static func read(after lastID: Int64) -> (access: Bool, items: [Item]) {
        guard let url = databaseURL else { return (false, []) }
        var db: OpaquePointer?
        guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { sqlite3_close(db); return (false, []) }
        defer { sqlite3_close(db) }
        // First load: just the latest 30. After that, everything newer than what we've seen.
        let sql = lastID < 0
            ? "SELECT r.rec_id, a.identifier, r.data FROM record r JOIN app a ON r.app_id = a.app_id ORDER BY r.rec_id DESC LIMIT 30"
            : "SELECT r.rec_id, a.identifier, r.data FROM record r JOIN app a ON r.app_id = a.app_id WHERE r.rec_id > \(lastID) ORDER BY r.rec_id"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return (false, []) }
        defer { sqlite3_finalize(stmt) }
        var items: [Item] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            let id = sqlite3_column_int64(stmt, 0)
            let bundle = sqlite3_column_text(stmt, 1).map { String(cString: $0) } ?? ""
            guard let blob = sqlite3_column_blob(stmt, 2) else { continue }
            let data = Data(bytes: blob, count: Int(sqlite3_column_bytes(stmt, 2)))
            guard let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else { continue }
            let req = plist["req"] as? [String: Any] ?? [:]
            let date = (plist["date"] as? Double).map { Date(timeIntervalSinceReferenceDate: $0) } ?? .now
            items.append(Item(id: id, bundleID: (plist["app"] as? String) ?? bundle,
                              title: (req["titl"] as? String) ?? "", subtitle: (req["subt"] as? String) ?? "",
                              body: (req["body"] as? String) ?? "", date: date))
        }
        return (true, items)
    }

    // MARK: Actions

    func open(_ item: Item) {
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: item.bundleID) {
            NSWorkspace.shared.openApplication(at: url, configuration: .init())
        }
        AppDelegate.current?.notch?.closeNotch()
    }

    /// Replies through Messages. The notification's title is the sender's name or number.
    func reply(to item: Item, text: String) -> String? {
        func esc(_ s: String) -> String { s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") }
        let script = """
        tell application "Messages"
            set theChats to (every chat whose name is "\(esc(item.title))")
            if (count of theChats) > 0 then
                send "\(esc(text))" to item 1 of theChats
            else
                send "\(esc(text))" to participant "\(esc(item.title))" of (1st account whose service type = iMessage)
            end if
        end tell
        """
        var error: NSDictionary?
        NSAppleScript(source: script)?.executeAndReturnError(&error)
        return error.map { ($0[NSAppleScript.errorMessage] as? String) ?? "Couldn't send." }
    }
}

struct NotificationsView: View {
    @StateObject private var mirror = NotificationMirror.shared
    @State private var replyingTo: Int64?
    @State private var replyText = ""
    @State private var status: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !mirror.hasAccess {
                VStack(spacing: 10) {
                    Image(systemName: "lock.shield").font(.system(size: 30)).foregroundStyle(Theme.accentGradient)
                    Text("Allow Full Disk Access").font(.headline).foregroundStyle(.white)
                    Text("Notification Center keeps notifications in a protected file. Give Notch apple Full Disk Access to show them here; it only reads them, on this Mac.")
                        .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center).frame(maxWidth: 440)
                    HStack {
                        Button("Open Privacy Settings") { PermissionsModel.openPrivacy("Privacy_AllFiles") }.buttonStyle(PurpleButtonStyle())
                        Button("Check again") { mirror.poll() }.buttonStyle(PurpleButtonStyle(prominent: false))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if mirror.items.isEmpty {
                Text("No notifications yet.").foregroundStyle(Theme.textSecondary).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                if let status { Text(status).font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(mirror.items) { item in row(item) }
                    }
                }
            }
        }
        .onAppear { mirror.setRunning(true); mirror.markSeen() }
    }

    private func row(_ item: NotificationMirror.Item) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 10) {
                if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: item.bundleID) {
                    Image(nsImage: NSWorkspace.shared.icon(forFile: url.path)).resizable().frame(width: 28, height: 28)
                } else {
                    Image(systemName: "app.badge").frame(width: 28, height: 28)
                }
                VStack(alignment: .leading, spacing: 1) {
                    HStack {
                        Text(item.appName).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                        Spacer()
                        Text(item.date, style: .relative).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                    }
                    if !item.title.isEmpty { Text(item.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).lineLimit(1) }
                    if !item.subtitle.isEmpty { Text(item.subtitle).font(.system(size: 12)).foregroundStyle(.white).lineLimit(1) }
                    if !item.body.isEmpty { Text(item.body).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).lineLimit(2) }
                }
                VStack(spacing: 2) {
                    IconButton(systemImage: "arrow.up.forward.app", help: "Open \(item.appName)") { mirror.open(item) }
                    if item.bundleID == "com.apple.MobileSMS" {
                        IconButton(systemImage: "arrowshape.turn.up.left.fill", help: "Reply") {
                            replyingTo = replyingTo == item.id ? nil : item.id
                        }
                    }
                }
            }
            if replyingTo == item.id {
                HStack {
                    TextField("Reply to \(item.title)", text: $replyText).textFieldStyle(.roundedBorder).onSubmit { send(item) }
                    Button("Send") { send(item) }.buttonStyle(PurpleButtonStyle()).disabled(replyText.isEmpty)
                }
            }
        }
        .padding(8)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private func send(_ item: NotificationMirror.Item) {
        guard !replyText.isEmpty else { return }
        if let error = mirror.reply(to: item, text: replyText) { status = "Reply failed: \(error)" }
        else { status = "Sent to \(item.title)"; replyText = ""; replyingTo = nil }
    }
}
