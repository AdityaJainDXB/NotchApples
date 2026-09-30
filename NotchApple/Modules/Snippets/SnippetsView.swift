//
//  SnippetsView.swift
//  Notch apple
//
//  Saved text snippets (addresses, sign-offs, code, replies…). Click one to
//  paste it straight into the app you were using; without Accessibility it is
//  copied instead. Shortcuts can paste one with notchapple://snippet?name=…
//

import SwiftUI

struct Snippet: Codable, Identifiable, Equatable {
    var id = UUID()
    var title: String
    var text: String
}

@MainActor
final class SnippetStore: ObservableObject {
    static let shared = SnippetStore()
    private static let key = "snippets.items"

    @Published var items: [Snippet] {
        didSet { if let data = try? JSONEncoder().encode(items) { UserDefaults.standard.set(data, forKey: Self.key) } }
    }

    init() {
        items = UserDefaults.standard.data(forKey: Self.key).flatMap { try? JSONDecoder().decode([Snippet].self, from: $0) }
            ?? [Snippet(title: "Thanks", text: "Thanks so much, speak soon!")]
    }
}

struct SnippetsView: View {
    @StateObject private var store = SnippetStore.shared
    @State private var query = ""
    @State private var editing: Snippet?
    @State private var title = ""
    @State private var text = ""

    private var filtered: [Snippet] {
        query.isEmpty ? store.items : store.items.filter { $0.title.localizedCaseInsensitiveContains(query) || $0.text.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.textSecondary)
                    TextField("Search snippets", text: $query).textFieldStyle(.plain).foregroundStyle(.white)
                }
                .padding(8).background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(filtered) { snippet in
                            HStack(spacing: 8) {
                                Button { PasteHelper.paste(snippet.text) } label: {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(snippet.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                                        Text(snippet.text).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .help(AXIsProcessTrusted() ? "Paste into the app in front" : "Copy (allow Accessibility to paste directly)")
                                IconButton(systemImage: "pencil", help: "Edit") { edit(snippet) }
                                IconButton(systemImage: "trash", help: "Delete") { store.items.removeAll { $0.id == snippet.id } }
                            }
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                        }
                        if filtered.isEmpty {
                            Text(store.items.isEmpty ? "No snippets yet. Add one on the right." : "No matches.")
                                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).padding(.top, 20)
                        }
                    }
                }
            }

            GlassCard {
                VStack(alignment: .leading, spacing: 8) {
                    Text(editing == nil ? "New snippet" : "Edit snippet").sectionTitle()
                    TextField("Name", text: $title).textFieldStyle(.roundedBorder)
                    TextEditor(text: $text)
                        .font(.system(size: 12)).scrollContentBackground(.hidden)
                        .padding(4).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                    HStack {
                        if editing != nil {
                            Button("Cancel") { clear() }.buttonStyle(PurpleButtonStyle(prominent: false))
                        }
                        Spacer()
                        Button(editing == nil ? "Add" : "Save", action: save)
                            .buttonStyle(PurpleButtonStyle())
                            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            .frame(width: 250)
        }
    }

    private func edit(_ s: Snippet) { editing = s; title = s.title; text = s.text }
    private func clear() { editing = nil; title = ""; text = "" }

    private func save() {
        let name = title.isEmpty ? String(text.prefix(24)) : title
        if let editing, let i = store.items.firstIndex(where: { $0.id == editing.id }) {
            store.items[i].title = name
            store.items[i].text = text
        } else {
            store.items.insert(Snippet(title: name, text: text), at: 0)
        }
        clear()
    }
}
