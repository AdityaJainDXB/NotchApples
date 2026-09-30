//
//  FileShelf.swift
//  Notch apple
//
//  A drop zone that remembers files and folders across launches. Each item is
//  persisted as a security-scoped bookmark so the sandboxed app keeps access
//  to it without asking again.
//

import SwiftUI
import UniformTypeIdentifiers
import QuickLookThumbnailing

struct ShelfItem: Identifiable, Codable, Equatable {
    var id = UUID()
    var bookmark: Data
    var name: String

    /// Resolves the bookmark and refreshes it if macOS reports it as stale.
    func resolve() -> URL? {
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: bookmark, options: [.withSecurityScope],
                                 relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }
        if stale { FileShelfStore.shared.refresh(self, url: url) }
        return url
    }
}

final class FileShelfStore: ObservableObject {
    static let shared = FileShelfStore()
    private let key = "shelf.items"

    @Published private(set) var items: [ShelfItem] = []

    var isShelfAvailable: Bool { SettingsManager.shared.shelfEnabled }

    init() {
        if let data = UserDefaults.standard.data(forKey: key),
           let saved = try? JSONDecoder().decode([ShelfItem].self, from: data) {
            items = saved
        }
    }

    func add(_ url: URL) {
        // Dropped URLs are already accessible; create a bookmark that survives relaunch.
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? url.bookmarkData(options: [.withSecurityScope],
                                               includingResourceValuesForKeys: nil, relativeTo: nil),
              !items.contains(where: { $0.name == url.lastPathComponent && $0.resolve() == url })
        else { return }
        items.append(ShelfItem(bookmark: data, name: url.lastPathComponent))
        save()
    }

    func remove(_ item: ShelfItem) {
        items.removeAll { $0.id == item.id }
        save()
    }

    func removeAll() { items.removeAll(); save() }

    fileprivate func refresh(_ item: ShelfItem, url: URL) {
        guard let idx = items.firstIndex(of: item),
              let data = try? url.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
        else { return }
        items[idx].bookmark = data
        save()
    }

    /// Runs `body` with security-scoped access to the item's URL.
    func withAccess(_ item: ShelfItem, _ body: (URL) -> Void) {
        guard let url = item.resolve() else { return }
        let ok = url.startAccessingSecurityScopedResource()
        body(url)
        // Keep access briefly so the receiving app (Finder, Quick Look) can open it.
        if ok { DispatchQueue.main.asyncAfter(deadline: .now() + 30) { url.stopAccessingSecurityScopedResource() } }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(items) { UserDefaults.standard.set(data, forKey: key) }
    }
}

struct FileShelfView: View {
    @StateObject private var store = FileShelfStore.shared
    @State private var targeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("File shelf").sectionTitle()
                Text("Drag files onto the notch to keep them here").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                Spacer()
                if !store.items.isEmpty {
                    Button { airDropAll() } label: { Label("AirDrop", systemImage: "airplayaudio") }
                        .buttonStyle(PurpleButtonStyle(prominent: false))
                        .help("Send everything on the shelf with AirDrop")
                    Button("Clear all") { withAnimation { store.removeAll() } }
                        .buttonStyle(PurpleButtonStyle(prominent: false))
                }
                // Keyboard/pointer alternative to drag and drop (HIG › Drag and drop).
                Button { addViaPanel() } label: { Label("Add files…", systemImage: "plus") }
                    .buttonStyle(PurpleButtonStyle())
            }

            ZStack {
                RoundedRectangle(cornerRadius: Theme.corner, style: .continuous)
                    .strokeBorder(targeted ? Theme.accentBright : Color.white.opacity(0.18),
                                  style: StrokeStyle(lineWidth: targeted ? 2 : 1.2, dash: [6, 5]))
                    .background(RoundedRectangle(cornerRadius: Theme.corner).fill(targeted ? Theme.accent.opacity(0.15) : .clear))

                if store.items.isEmpty {
                    VStack(spacing: 6) {
                        Image(systemName: "tray.and.arrow.down.fill").font(.system(size: 30)).foregroundStyle(Theme.accentGradient)
                        Text(targeted ? "Release to add" : "Drop files or folders here")
                            .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    }
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(store.items) { ShelfTile(item: $0) }
                        }
                        .padding(12)
                    }
                }
            }
            .animation(Theme.spring, value: targeted)
            .onDrop(of: [.fileURL], isTargeted: $targeted) { providers in
                for provider in providers {
                    _ = provider.loadObject(ofClass: URL.self) { url, _ in
                        if let url { DispatchQueue.main.async { withAnimation(Theme.spring) { store.add(url) } } }
                    }
                }
                return true
            }
        }
    }

    private func airDropAll() {
        let urls = store.items.compactMap { $0.resolve() }
        guard !urls.isEmpty, let service = NSSharingService(named: .sendViaAirDrop), service.canPerform(withItems: urls) else { return }
        service.perform(withItems: urls)
    }

    private func addViaPanel() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = true
        NSApp.activate(ignoringOtherApps: true)
        if panel.runModal() == .OK { withAnimation(Theme.spring) { panel.urls.forEach(store.add) } }
    }
}

private struct ShelfTile: View {
    let item: ShelfItem
    @State private var thumbnail: NSImage?

    var body: some View {
        VStack(spacing: 6) {
            Group {
                if let thumbnail { Image(nsImage: thumbnail).resizable().scaledToFit() }
                else { Image(systemName: "doc.fill").font(.system(size: 30)).foregroundStyle(Theme.accent) }
            }
            .frame(width: 64, height: 64)
            Text(item.name).font(.system(size: 11)).foregroundStyle(.white).lineLimit(1).frame(width: 84)
        }
        .padding(6)
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
        .onTapGesture(count: 2) { FileShelfStore.shared.withAccess(item) { NSWorkspace.shared.open($0) } }
        // Drag back out of the shelf into Finder / Mail / etc.
        .onDrag { NSItemProvider(contentsOf: item.resolve()) ?? NSItemProvider() }
        .contextMenu {
            Button("Open") { FileShelfStore.shared.withAccess(item) { NSWorkspace.shared.open($0) } }
            Button("Reveal in Finder") { FileShelfStore.shared.withAccess(item) { NSWorkspace.shared.activateFileViewerSelecting([$0]) } }
            Divider()
            Button("Remove from Shelf", role: .destructive) { withAnimation { FileShelfStore.shared.remove(item) } }
        }
        .help("Double-click to open · drag out to use · right-click for more")
        .task { await loadThumbnail() }
    }

    private func loadThumbnail() async {
        guard let url = item.resolve() else { return }
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        let req = QLThumbnailGenerator.Request(fileAt: url, size: CGSize(width: 64, height: 64),
                                               scale: 2, representationTypes: .thumbnail)
        if let rep = try? await QLThumbnailGenerator.shared.generateBestRepresentation(for: req) {
            thumbnail = rep.nsImage
        } else {
            thumbnail = NSWorkspace.shared.icon(forFile: url.path)
        }
    }
}
