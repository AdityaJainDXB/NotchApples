//
//  NotesView.swift
//  Notch apple
//
//  Quick notes in the notch: a list of notes on the left, the editor on the
//  right. Saved automatically as you type, stored on this Mac only.
//

import SwiftUI
import AppKit

struct Note: Identifiable, Codable, Equatable {
    var id = UUID()
    var text: String
    var updated = Date()

    /// First non-empty line, used as the title.
    var title: String {
        text.split(whereSeparator: \.isNewline).first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? ""
    }
}

@MainActor
final class NotesStore: ObservableObject {
    static let shared = NotesStore()

    @Published private(set) var notes: [Note] = []
    @Published var selectedID: UUID?

    private let url: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Notch apple", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("notes.json")
    }()
    private var saveWork: DispatchWorkItem?

    init() {
        if let data = try? Data(contentsOf: url), let saved = try? JSONDecoder().decode([Note].self, from: data) {
            notes = saved.sorted { $0.updated > $1.updated }
        }
        selectedID = notes.first?.id
    }

    @discardableResult
    func add(_ text: String = "") -> Note {
        let note = Note(text: text)
        notes.insert(note, at: 0)
        selectedID = note.id
        scheduleSave()
        return note
    }

    func update(_ id: UUID, text: String) {
        guard let i = notes.firstIndex(where: { $0.id == id }), notes[i].text != text else { return }
        notes[i].text = text
        notes[i].updated = .now
        scheduleSave()
    }

    func delete(_ id: UUID) {
        notes.removeAll { $0.id == id }
        if selectedID == id { selectedID = notes.first?.id }
        scheduleSave()
    }

    /// Saves shortly after the last keystroke instead of on every character.
    private func scheduleSave() {
        saveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, let data = try? JSONEncoder().encode(self.notes) else { return }
            try? data.write(to: self.url, options: .atomic)
        }
        saveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
    }
}

struct NotesView: View {
    @StateObject private var store = NotesStore.shared
    @State private var search = ""

    private var filtered: [Note] {
        search.isEmpty ? store.notes : store.notes.filter { $0.text.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        HStack(spacing: 12) {
            GlassCard {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        Image(systemName: "magnifyingglass").foregroundStyle(Theme.textSecondary)
                        TextField("Search notes", text: $search).textFieldStyle(.plain).font(.system(size: 12))
                        IconButton(systemImage: "square.and.pencil", help: "New note") { store.add() }
                        IconButton(systemImage: "doc.on.clipboard", help: "New note from clipboard") {
                            store.add(NSPasteboard.general.string(forType: .string) ?? "")
                        }
                    }
                    ScrollView {
                        VStack(spacing: 2) {
                            ForEach(filtered) { note in
                                NoteRow(note: note, selected: note.id == store.selectedID) { store.selectedID = note.id }
                            }
                        }
                    }
                    if store.notes.isEmpty {
                        Text("No notes yet").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .frame(width: 220)

            GlassCard {
                if let id = store.selectedID, let note = store.notes.first(where: { $0.id == id }) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Edited \(note.updated.formatted(.relative(presentation: .named)))")
                                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                            Spacer()
                            IconButton(systemImage: "doc.on.doc", help: "Copy note") {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(note.text, forType: .string)
                            }
                            IconButton(systemImage: "trash", help: "Delete note") { withAnimation { store.delete(id) } }
                        }
                        TextEditor(text: Binding(get: { note.text }, set: { store.update(id, text: $0) }))
                            .font(.system(size: 13))
                            .scrollContentBackground(.hidden)
                            .foregroundStyle(.white)
                    }
                } else {
                    VStack(spacing: 8) {
                        Image(systemName: "note.text").font(.system(size: 28)).foregroundStyle(Theme.accentGradient)
                        Text("Jot something down").foregroundStyle(Theme.textSecondary)
                        Button("New note") { store.add() }.buttonStyle(PurpleButtonStyle())
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
    }
}

private struct NoteRow: View {
    let note: Note
    let selected: Bool
    let onSelect: () -> Void
    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(note.title.isEmpty ? "New note" : note.title)
                .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
            Text(note.updated.formatted(date: .abbreviated, time: .shortened))
                .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8).padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 8).fill(selected ? Theme.accent.opacity(0.35) : (hovering ? Theme.surface : .clear)))
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
        .onHover { hovering = $0 }
    }
}
