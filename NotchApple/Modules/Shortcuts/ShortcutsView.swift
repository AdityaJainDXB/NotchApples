//
//  ShortcutsView.swift
//  Notch apple
//
//  Runs Apple Shortcuts from the notch (via the built-in `shortcuts` command),
//  with a Focus row for shortcuts that switch Focus modes. macOS has no public
//  API to change Focus, so a one-action shortcut ("Set Focus") does it.
//  The other direction, Shortcuts → notch, is the notchapple:// URL scheme.
//

import AppKit
import SwiftUI

@MainActor
final class ShortcutsModel: ObservableObject {
    static let shared = ShortcutsModel()

    @Published private(set) var names: [String] = []
    @Published private(set) var running: String?
    @Published var message: String?
    @Published private(set) var loaded = false

    /// Shortcuts that look like Focus switches ("Focus: Work", "Do Not Disturb On"…).
    var focusShortcuts: [String] {
        names.filter { n in ["focus", "do not disturb", "dnd"].contains { n.localizedCaseInsensitiveContains($0) } }
    }

    func load() {
        Task.detached {
            let output = Self.shell(["list"]).output
            let list = output.split(separator: "\n").map(String.init).filter { !$0.isEmpty }
            await MainActor.run {
                self.names = list
                self.loaded = true
            }
        }
    }

    func run(_ name: String) {
        running = name
        Task.detached {
            let result = Self.shell(["run", name])
            await MainActor.run {
                self.running = nil
                self.message = result.status == 0 ? "Ran “\(name)”" : "“\(name)” failed: \(result.output.prefix(120))"
                DispatchQueue.main.asyncAfter(deadline: .now() + 4) { self.message = nil }
            }
        }
    }

    /// Runs a shortcut by name without UI feedback (used by the Focus timer's Do Not Disturb hooks).
    nonisolated static func runQuietly(_ name: String) {
        guard !name.isEmpty else { return }
        DispatchQueue.global().async { _ = shell(["run", name]) }
    }

    nonisolated static func shell(_ args: [String]) -> (status: Int32, output: String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/shortcuts")
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        do { try p.run() } catch { return (-1, error.localizedDescription) }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (p.terminationStatus, String(decoding: data, as: UTF8.self))
    }
}

struct ShortcutsView: View {
    @StateObject private var model = ShortcutsModel.shared
    @State private var query = ""

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.textSecondary)
                    TextField("Search your shortcuts", text: $query).textFieldStyle(.plain).foregroundStyle(.white)
                    IconButton(systemImage: "arrow.clockwise", help: "Reload") { model.load() }
                    IconButton(systemImage: "plus", help: "Open the Shortcuts app") {
                        NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Shortcuts.app"))
                    }
                }
                .padding(.horizontal, 8).padding(.vertical, 2).background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 6)], spacing: 6) {
                        ForEach(model.names.filter { query.isEmpty || $0.localizedCaseInsensitiveContains(query) }, id: \.self) { name in
                            Button { model.run(name) } label: {
                                HStack(spacing: 6) {
                                    if model.running == name { ProgressView().controlSize(.small) }
                                    else { Image(systemName: "play.fill").font(.system(size: 10)) }
                                    Text(name).lineLimit(1)
                                    Spacer(minLength: 0)
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(PurpleButtonStyle(prominent: false))
                        }
                    }
                    if model.loaded && model.names.isEmpty {
                        Text("No shortcuts yet. Make some in the Shortcuts app.").font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary).padding(.top, 20)
                    }
                }
                if let m = model.message { Text(m).font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
            }

            GlassCard {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Focus modes", systemImage: "moon.fill").sectionTitle()
                    if model.focusShortcuts.isEmpty {
                        Text("Make a shortcut with the “Set Focus” action and put “Focus” or “Do Not Disturb” in its name (e.g. “Focus: Work”). It appears here as a one-click switch.")
                            .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                    } else {
                        ForEach(model.focusShortcuts, id: \.self) { name in
                            Button { model.run(name) } label: { Label(name, systemImage: "moon.circle.fill").lineLimit(1).frame(maxWidth: .infinity, alignment: .leading) }
                                .buttonStyle(PurpleButtonStyle(prominent: false))
                        }
                    }
                    Spacer(minLength: 0)
                    Text("From Shortcuts: use “Open URL” with notchapple://open/timer, notchapple://timer?minutes=10, notchapple://focus/start, notchapple://keepawake?minutes=30…")
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(width: 250)
        }
        .onAppear { if !model.loaded { model.load() } }
    }
}
