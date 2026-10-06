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
    /// Pro text expander: typing this anywhere (e.g. ";sig") replaces it with the snippet.
    var abbreviation: String? = nil
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
    @State private var abbreviation = ""
    @ObservedObject private var expander = TextExpander.shared

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
                                Button { PasteHelper.paste(SnippetVariables.render(snippet.text)) } label: {
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
                    HStack {
                        TextField("Abbreviation, e.g. ;sig", text: $abbreviation).textFieldStyle(.roundedBorder)
                            .disabled(!Entitlements.shared.canUse(.textExpander))
                        if !Entitlements.shared.canUse(.textExpander) { TierBadge(tier: .pro).help(Feature.textExpander.benefit) }
                    }
                    TextEditor(text: $text)
                        .font(.system(size: 12)).scrollContentBackground(.hidden)
                        .padding(4).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                    HStack {
                        if editing != nil {
                            Button("Cancel") { clear() }.buttonStyle(PurpleButtonStyle(prominent: false))
                        }
                        if Entitlements.shared.canUse(.textExpander) {
                            Toggle("Expand as I type", isOn: $expander.enabled).toggleStyle(.switch).controlSize(.mini).font(.system(size: 11))
                                .help("Type a snippet's abbreviation in any app to replace it. Needs Accessibility permission.")
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

    private func edit(_ s: Snippet) { editing = s; title = s.title; text = s.text; abbreviation = s.abbreviation ?? "" }
    private func clear() { editing = nil; title = ""; text = ""; abbreviation = "" }

    private func save() {
        let name = title.isEmpty ? String(text.prefix(24)) : title
        let trimmed = abbreviation.trimmingCharacters(in: .whitespaces)
        let abbr: String? = trimmed.count >= 2 ? trimmed : nil
        if let editing, let i = store.items.firstIndex(where: { $0.id == editing.id }) {
            store.items[i].title = name
            store.items[i].text = text
            store.items[i].abbreviation = abbr
        } else {
            store.items.insert(Snippet(title: name, text: text, abbreviation: abbr), at: 0)
        }
        clear()
    }
}

// MARK: - Text expander (Pro)

/// Watches what you type (only to compare it with your abbreviations; nothing is stored
/// or sent) and, when the last characters match one, deletes them and pastes the snippet.
/// Off by default; needs Accessibility, like any text expander.
@MainActor
final class TextExpander: ObservableObject {
    static let shared = TextExpander()
    @AppStorage("snippets.expand") var enabled = false { didSet { apply() } }
    private var monitor: Any?
    private var buffer = ""

    func apply() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        buffer = ""
        guard enabled, Entitlements.shared.canUse(.textExpander) else { return }
        if !AXIsProcessTrusted() {
            AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        }
        monitor = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown, .leftMouseDown]) { event in
            MainActor.assumeIsolated { TextExpander.shared.handle(event) }
        }
    }

    private func handle(_ event: NSEvent) {
        guard event.type == .keyDown else { buffer = ""; return }
        let mods = event.modifierFlags.intersection([.command, .control, .option])
        if !mods.isEmpty { buffer = ""; return }
        if event.keyCode == 51 { buffer = String(buffer.dropLast()); return }   // delete
        guard let chars = event.characters, !chars.isEmpty, chars.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else {
            buffer = ""; return
        }
        buffer = String((buffer + chars).suffix(40))
        guard let match = SnippetStore.shared.items.first(where: { s in
            guard let a = s.abbreviation, !a.isEmpty else { return false }
            return buffer.hasSuffix(a)
        }), let abbr = match.abbreviation else { return }
        buffer = ""
        expand(deleting: abbr.count, with: SnippetVariables.render(match.text))
    }

    private func expand(deleting count: Int, with text: String) {
        let source = CGEventSource(stateID: .combinedSessionState)
        // Let the last typed character land first, then remove the abbreviation.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            for _ in 0..<count {
                for down in [true, false] { CGEvent(keyboardEventSource: source, virtualKey: 51, keyDown: down)?.post(tap: .cghidEventTap) }
            }
            let saved = NSPasteboard.general.string(forType: .string)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            for down in [true, false] {
                let e = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: down)
                e?.flags = .maskCommand
                e?.post(tap: .cghidEventTap)
            }
            // Put back what was on the clipboard.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                if let saved { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(saved, forType: .string) }
            }
        }
    }
}
