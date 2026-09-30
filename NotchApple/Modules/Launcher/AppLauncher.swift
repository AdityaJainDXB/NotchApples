//
//  AppLauncher.swift
//  Notch apple
//
//  The Launcher tab: a shelf of apps you choose. Add as many as you like from
//  the list of installed apps, by dragging an app in, or by picking one in a
//  file dialog; click a tile to open it straight from the notch.
//

import SwiftUI
import UniformTypeIdentifiers

struct LauncherApp: Identifiable, Codable, Equatable {
    var id: String { path }
    var path: String
    var name: String
    var bundleID: String?
}

@MainActor
final class LauncherStore: ObservableObject {
    static let shared = LauncherStore()
    private let key = "launcher.apps"

    @Published private(set) var apps: [LauncherApp] = []

    init() {
        if let data = UserDefaults.standard.data(forKey: key),
           let saved = try? JSONDecoder().decode([LauncherApp].self, from: data) { apps = saved }
    }

    /// Adds the app at `url`. Ignores things that aren't apps and apps already on the launcher.
    @discardableResult
    func add(_ url: URL) -> Bool {
        guard url.pathExtension.lowercased() == "app", let bundle = Bundle(url: url),
              !apps.contains(where: { $0.path == url.path }) else { return false }
        let name = (bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
            ?? (bundle.object(forInfoDictionaryKey: "CFBundleName") as? String)
            ?? url.deletingPathExtension().lastPathComponent
        apps.append(LauncherApp(path: url.path, name: name, bundleID: bundle.bundleIdentifier))
        save()
        return true
    }

    func remove(_ app: LauncherApp) { apps.removeAll { $0.id == app.id }; save() }

    func move(_ app: LauncherApp, before target: LauncherApp) {
        guard app != target, let from = apps.firstIndex(of: app), let to = apps.firstIndex(of: target) else { return }
        apps.move(fromOffsets: [from], toOffset: to > from ? to + 1 : to)
        save()
    }

    /// Where the app is now: its saved path, or wherever macOS finds its bundle identifier if it was moved.
    func resolvedURL(_ app: LauncherApp) -> URL? {
        if FileManager.default.fileExists(atPath: app.path) { return URL(fileURLWithPath: app.path) }
        return app.bundleID.flatMap { NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) }
    }

    func launch(_ app: LauncherApp) {
        guard let url = resolvedURL(app) else { return }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
        AppDelegate.current?.notch?.closeNotch()
    }

    private func save() {
        if let data = try? JSONEncoder().encode(apps) { UserDefaults.standard.set(data, forKey: key) }
    }

    // MARK: Installed apps

    /// Every app in the usual places, sorted by name.
    nonisolated static func installedApps() -> [LauncherApp] {
        let home = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications").path
        let folders = ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities", home]
        var found: [String: LauncherApp] = [:]
        for folder in folders {
            let contents = (try? FileManager.default.contentsOfDirectory(atPath: folder)) ?? []
            for item in contents where item.hasSuffix(".app") {
                let url = URL(fileURLWithPath: folder).appendingPathComponent(item)
                found[url.path] = LauncherApp(path: url.path, name: (item as NSString).deletingPathExtension,
                                              bundleID: Bundle(url: url)?.bundleIdentifier)
            }
        }
        return found.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
}

struct AppLauncherView: View {
    @StateObject private var store = LauncherStore.shared
    @State private var targeted = false
    @State private var picking = false
    @State private var dragging: LauncherApp?

    private let columns = [GridItem(.adaptive(minimum: 84, maximum: 96), spacing: 10)]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("App launcher").sectionTitle()
                Text("Click an app to open it").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                Spacer()
                Button { chooseFile() } label: { Label("Other…", systemImage: "folder") }
                    .buttonStyle(PurpleButtonStyle(prominent: false)).help("Pick an app from anywhere on this Mac")
                Button { picking = true } label: { Label("Add apps", systemImage: "plus") }
                    .buttonStyle(PurpleButtonStyle())
                    .popover(isPresented: $picking, arrowEdge: .bottom) { AppPicker(store: store) }
            }

            ZStack {
                RoundedRectangle(cornerRadius: Theme.corner, style: .continuous)
                    .strokeBorder(targeted ? Theme.accentBright : Color.white.opacity(0.18),
                                  style: StrokeStyle(lineWidth: targeted ? 2 : 1.2, dash: [6, 5]))
                    .background(RoundedRectangle(cornerRadius: Theme.corner).fill(targeted ? Theme.accent.opacity(0.15) : .clear))

                if store.apps.isEmpty {
                    VStack(spacing: 6) {
                        Image(systemName: "square.grid.3x3.fill").font(.system(size: 30)).foregroundStyle(Theme.accentGradient)
                        Text(targeted ? "Release to add" : "Add the apps you use most, or drop apps here")
                            .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    }
                } else {
                    ScrollView {
                        LazyVGrid(columns: columns, spacing: 10) {
                            ForEach(store.apps) { app in
                                LauncherTile(app: app, store: store)
                                    .onDrag { dragging = app; return NSItemProvider(object: app.path as NSString) }
                                    .onDrop(of: [.plainText], delegate: ReorderDrop(target: app, store: store, dragging: $dragging))
                            }
                        }
                        .padding(12)
                    }
                }
            }
            .animation(Theme.spring, value: targeted)
            .onDrop(of: [.fileURL], isTargeted: $targeted) { providers in
                for provider in providers {
                    _ = provider.loadObject(ofClass: URL.self) { url, _ in
                        if let url { DispatchQueue.main.async { withAnimation(Theme.spring) { _ = store.add(url) } } }
                    }
                }
                return true
            }
        }
    }

    private func chooseFile() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.applicationBundle]
        panel.directoryURL = URL(fileURLWithPath: "/Applications")
        NSApp.activate(ignoringOtherApps: true)
        if panel.runModal() == .OK {
            withAnimation(Theme.spring) { for url in panel.urls { store.add(url) } }
        }
    }
}

private struct ReorderDrop: DropDelegate {
    let target: LauncherApp
    let store: LauncherStore
    @Binding var dragging: LauncherApp?

    func dropEntered(info: DropInfo) {
        if let dragging { withAnimation(Theme.spring) { store.move(dragging, before: target) } }
    }
    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }
    func performDrop(info: DropInfo) -> Bool { dragging = nil; return true }
}

private struct LauncherTile: View {
    let app: LauncherApp
    let store: LauncherStore
    @State private var hovering = false

    var body: some View {
        let url = store.resolvedURL(app)
        Button { store.launch(app) } label: {
            VStack(spacing: 6) {
                Image(nsImage: NSWorkspace.shared.icon(forFile: url?.path ?? app.path))
                    .resizable().interpolation(.high).frame(width: 52, height: 52)
                    .opacity(url == nil ? 0.35 : 1)
                Text(app.name).font(.system(size: 11)).foregroundStyle(.white).lineLimit(1)
                    .frame(maxWidth: .infinity)
            }
            .padding(.vertical, 8).padding(.horizontal, 4)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(hovering ? Theme.surfaceHover : Theme.surface))
            .scaleEffect(hovering ? 1.04 : 1)
            .animation(.easeOut(duration: 0.12), value: hovering)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .contextMenu {
            Button("Open") { store.launch(app) }.disabled(url == nil)
            if let url { Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([url]) } }
            Divider()
            Button("Remove from Launcher", role: .destructive) { withAnimation { store.remove(app) } }
        }
        .help(url == nil ? "\(app.name) can't be found. Right-click to remove it." : "Open \(app.name)")
        .accessibilityLabel("Open \(app.name)")
    }
}

/// Every installed app with a search box and check marks; adds all the ticked ones at once.
private struct AppPicker: View {
    let store: LauncherStore
    @State private var all: [LauncherApp] = []
    @State private var query = ""
    @State private var selected = Set<String>()
    @Environment(\.dismiss) private var dismiss

    private var shown: [LauncherApp] {
        let list = all.filter { app in !store.apps.contains { $0.path == app.path } }
        return query.isEmpty ? list : list.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        VStack(spacing: 10) {
            TextField("Search apps", text: $query).textFieldStyle(.roundedBorder)
            List(shown) { app in
                Button { toggle(app) } label: {
                    HStack(spacing: 10) {
                        Image(nsImage: NSWorkspace.shared.icon(forFile: app.path)).resizable().frame(width: 26, height: 26)
                        Text(app.name)
                        Spacer()
                        if selected.contains(app.path) { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent) }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .frame(height: 300)
            HStack {
                Text(selected.isEmpty ? "Tick the apps to add" : "\(selected.count) selected").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Add") {
                    for app in all where selected.contains(app.path) { store.add(URL(fileURLWithPath: app.path)) }
                    dismiss()
                }
                .buttonStyle(.borderedProminent).disabled(selected.isEmpty)
            }
        }
        .padding(14).frame(width: 340)
        .task { all = await Task.detached { LauncherStore.installedApps() }.value }
    }

    private func toggle(_ app: LauncherApp) {
        if selected.contains(app.path) { selected.remove(app.path) } else { selected.insert(app.path) }
    }
}
