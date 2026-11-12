//
//  NotchAIMemoryView.swift
//  Notch Apple
//
//  The Memory section: see, add, edit, switch off and delete what NotchAI remembers, choose a response style, and
//  turn the whole thing off. Nothing is remembered unless it is added here (or by "Remember this" on an answer).
//

import SwiftUI

struct NotchAIMemoryView: View {
    @ObservedObject private var memory = NotchAIMemory.shared
    @State private var draft = ""
    @State private var kind: MemoryItem.Kind = .preference
    @State private var confirmClear = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Toggle("Use memory in answers", isOn: $memory.useMemory).toggleStyle(.switch).controlSize(.small)
                HStack {
                    Text("Answer style").font(.system(size: 11)).foregroundStyle(.white).frame(width: 90, alignment: .leading)
                    Picker("", selection: Binding(get: { memory.style }, set: { memory.style = $0 })) {
                        ForEach(ResponseStyle.allCases) { Text($0.title).tag($0) }
                    }.labelsHidden().frame(width: 220)
                }
                HStack(spacing: 6) {
                    Picker("", selection: $kind) { ForEach(MemoryItem.Kind.allCases) { Text($0.title).tag($0) } }.labelsHidden().frame(width: 110)
                    TextField("Something to remember (e.g. “I use Swift and prefer short answers”)", text: $draft).textFieldStyle(.roundedBorder).onSubmit(add)
                    Button("Remember") { add() }.disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                if let p = memory.problem { Label(p, systemImage: "exclamationmark.triangle.fill").font(.system(size: 11)).foregroundStyle(.orange) }
                if memory.items.isEmpty {
                    Text("Nothing is remembered yet. Memory stays on this Mac, and you can edit or delete any item.")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
                ForEach(memory.items) { item in
                    HStack(spacing: 6) {
                        Toggle("", isOn: Binding(get: { item.enabled }, set: { memory.setEnabled(item.id, $0) })).labelsHidden().toggleStyle(.switch).controlSize(.mini)
                        Text(item.kind.title).font(.system(size: 9, weight: .semibold)).padding(.horizontal, 5).padding(.vertical, 1)
                            .background(NotchAIView.green.opacity(0.25), in: Capsule()).foregroundStyle(.white)
                        TextField("", text: Binding(get: { item.text }, set: { memory.update(item.id, text: $0) })).textFieldStyle(.plain)
                            .font(.system(size: 11)).foregroundStyle(item.enabled ? .white : Theme.textSecondary)
                        Button { memory.delete(item.id) } label: { Image(systemName: "trash") }.buttonStyle(.plain).foregroundStyle(.red.opacity(0.8))
                    }
                    .padding(6).background(Theme.surface, in: RoundedRectangle(cornerRadius: 7))
                }
                if !memory.items.isEmpty {
                    Button("Clear all memory", role: .destructive) { confirmClear = true }
                        .confirmationDialog("Delete everything NotchAI remembers?", isPresented: $confirmClear) {
                            Button("Delete all", role: .destructive) { memory.clearAll() }
                        }
                }
                Text("Memory is only what you add. Passwords, keys and card numbers are refused. It is stored on this Mac and added to the model's instructions only while “Use memory” is on; with a cloud model that means it is sent too, and Local first still applies.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private func add() { if memory.add(draft, kind: kind) { draft = "" } }
}
