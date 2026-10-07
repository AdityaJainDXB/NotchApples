//
//  LinksShelf.swift
//  Notch apple
//
//  Save a link now, read it later (free). Paste or type an address; it's checked and tidied by
//  LinkShelfLogic and kept in this Mac's Application Support folder. Nothing is fetched or sent anywhere:
//  a saved link shows its address, not a page title.
//

import AppKit
import SwiftUI

struct SavedLink: Codable, Identifiable, Equatable {
    var id = UUID()
    var url: String
    var added = Date()
    var read = false
}

@MainActor
final class LinksShelfStore: ObservableObject {
    static let shared = LinksShelfStore()

    @Published private(set) var links: [SavedLink] = []
    private let fileURL: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Notch apple", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("links.json")
    }()

    private init() { links = (try? JSONDecoder().decode([SavedLink].self, from: Data(contentsOf: fileURL))) ?? [] }

    /// Saves a link. Returns what went wrong, or nil.
    @discardableResult
    func add(_ input: String) -> String? {
        guard let url = LinkShelfLogic.normalize(input) else { return "That doesn't look like a web address." }
        if links.contains(where: { $0.url == url }) { return "Already saved." }
        links.insert(SavedLink(url: url), at: 0)
        save()
        return nil
    }

    func open(_ link: SavedLink) {
        guard let url = URL(string: link.url) else { return }
        NSWorkspace.shared.open(url)
        setRead(link, true)
    }

    func setRead(_ link: SavedLink, _ read: Bool) {
        guard let i = links.firstIndex(of: link) else { return }
        links[i].read = read; save()
    }

    func remove(_ link: SavedLink) { links.removeAll { $0.id == link.id }; save() }
    func clearRead() { links.removeAll(where: \.read); save() }

    private func save() { try? JSONEncoder().encode(links).write(to: fileURL, options: .atomic) }
}

struct LinksShelfView: View {
    @StateObject private var store = LinksShelfStore.shared
    @State private var input = ""
    @State private var problem: String?

    private var ordered: [SavedLink] { store.links.filter { !$0.read } + store.links.filter(\.read) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                TextField("Paste a link to read later", text: $input).textFieldStyle(.roundedBorder).onSubmit(add)
                Button("Save", action: add).buttonStyle(PurpleButtonStyle())
                Button { input = NSPasteboard.general.string(forType: .string) ?? ""; add() } label: { Label("From clipboard", systemImage: "doc.on.clipboard") }
                    .buttonStyle(PurpleButtonStyle(prominent: false))
                if store.links.contains(where: \.read) {
                    Button("Clear read", action: store.clearRead).buttonStyle(PurpleButtonStyle(prominent: false))
                }
            }
            if let problem { Text(problem).font(.system(size: 11)).foregroundStyle(.yellow) }
            ScrollView {
                VStack(spacing: 4) {
                    ForEach(ordered) { link in
                        HStack(spacing: 8) {
                            Image(systemName: link.read ? "checkmark.circle.fill" : "link").foregroundStyle(link.read ? .green : Theme.accentBright)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(LinkShelfLogic.label(link.url)).font(.system(size: 13, weight: .medium)).foregroundStyle(.white.opacity(link.read ? 0.5 : 1)).lineLimit(1)
                                Text("Saved \(link.added.formatted(.relative(presentation: .named)))").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                            }
                            Spacer()
                            Button("Open") { store.open(link) }.buttonStyle(PurpleButtonStyle(prominent: false))
                            IconButton(systemImage: link.read ? "arrow.uturn.backward" : "checkmark", help: link.read ? "Mark unread" : "Mark read") { store.setRead(link, !link.read) }
                            IconButton(systemImage: "trash", help: "Remove") { withAnimation { store.remove(link) } }
                        }
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.surface))
                    }
                    if store.links.isEmpty {
                        Text("Nothing saved. Paste a link above and read it when you have time.").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    private func add() {
        problem = store.add(input)
        if problem == nil { input = "" }
    }
}
