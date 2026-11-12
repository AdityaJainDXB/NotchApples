//
//  NotchAIMemory.swift
//  Notch Apple
//
//  NotchAI's memory: a short list the user writes, edits, switches off or deletes, plus a response style. Stored
//  only on this Mac (Application Support/Notch apple/notchai-memory.json), separate from conversations (which AI
//  History keeps under its own rules). Nothing is added unless the user adds it or presses "Remember this";
//  secrets are refused. Memory is added to the model's instructions only while "Use memory" is on.
//

import Foundation
import SwiftUI

@MainActor
final class NotchAIMemory: ObservableObject {
    static let shared = NotchAIMemory()

    @Published private(set) var items: [MemoryItem] = []
    @Published private(set) var problem: String?
    @AppStorage("notchai.memory.use") var useMemory = true { willSet { objectWillChange.send() } }
    @AppStorage("notchai.memory.style") private var styleRaw = ResponseStyle.none.rawValue
    var style: ResponseStyle {
        get { ResponseStyle(rawValue: styleRaw) ?? .none }
        set { objectWillChange.send(); styleRaw = newValue.rawValue }
    }

    private let url: URL

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Notch apple", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        url = dir.appendingPathComponent("notchai-memory.json")
        if let data = try? Data(contentsOf: url), let decoded = try? JSONDecoder().decode([MemoryItem].self, from: data) { items = decoded }
    }

    @discardableResult
    func add(_ text: String, kind: MemoryItem.Kind) -> Bool {
        switch NotchAIMemoryLogic.validate(text, existing: items) {
        case .success(let t):
            items.insert(MemoryItem(kind: kind, text: t), at: 0); problem = nil; save(); return true
        case .failure(let r):
            problem = r.errorDescription; return false
        }
    }

    func update(_ id: UUID, text: String) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        let others = items.filter { $0.id != id }
        switch NotchAIMemoryLogic.validate(text, existing: others) {
        case .success(let t): items[i].text = t; problem = nil; save()
        case .failure(let r): problem = r.errorDescription
        }
    }

    func setEnabled(_ id: UUID, _ on: Bool) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        items[i].enabled = on; save()
    }

    func delete(_ id: UUID) { items.removeAll { $0.id == id }; save() }
    func clearAll() { items = []; problem = nil; save() }

    /// What the model is told: the base prompt plus style and enabled memory (only while "Use memory" is on).
    func systemPrompt(base: String) -> String {
        NotchAIMemoryLogic.systemPrompt(base: base, items: items, style: style, useMemory: useMemory)
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(items) else { return }
        try? data.write(to: url, options: [.atomic])
    }
}
