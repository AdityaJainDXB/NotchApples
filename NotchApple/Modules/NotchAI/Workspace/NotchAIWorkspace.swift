//
//  NotchAIWorkspace.swift
//  Notch Apple
//
//  A bigger, resizable NotchAI window with a sidebar: your past conversations (from AI History, with search), the
//  agents' tasks and their results, and the live NotchAI tab beside them. Choosing a past conversation shows it and lets
//  you continue it in the live chat. It is an ordinary window, closed with the red button; nothing runs in it that does
//  not run in the notch.
//

import AppKit
import SwiftUI

@MainActor
enum NotchAIWorkspaceWindow {
    private static var window: NSWindow?

    static func open() {
        if let w = window { w.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1000, height: 640),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        w.title = "NotchAI"
        w.minSize = NSSize(width: 760, height: 480)
        w.isReleasedWhenClosed = false
        w.contentView = NSHostingView(rootView: NotchAIWorkspaceView().environment(\.colorScheme, .dark))
        w.center()
        w.setFrameAutosaveName("NotchAIWorkspace")
        window = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}

struct NotchAIWorkspaceView: View {
    enum Pane: Hashable { case live, conversation(UUID), task(UUID) }

    @ObservedObject private var history = ChatHistoryStore.shared
    @ObservedObject private var tasks = NotchAITaskStore.shared
    @State private var pane: Pane = .live
    @State private var search = ""

    var body: some View {
        NavigationSplitView {
            List(selection: $pane) {
                Label("NotchAI", systemImage: "sparkles").tag(Pane.live)
                Section("Conversations") {
                    TextField("Search", text: $search).textFieldStyle(.roundedBorder)
                    ForEach(history.search(search).prefix(60)) { s in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(s.firstQuestion).lineLimit(1).font(.system(size: 12))
                            Text("\(s.providerTitle) · \(s.updated.formatted(date: .abbreviated, time: .shortened))").font(.system(size: 10)).foregroundStyle(.secondary)
                        }.tag(Pane.conversation(s.id))
                    }
                }
                Section("Agents and tasks") {
                    ForEach(tasks.tasks.filter { $0.depth == 0 }.prefix(30)) { t in
                        Label(t.title, systemImage: t.state == .completed ? "checkmark.circle" : t.state == .failed ? "xmark.octagon" : "clock")
                            .lineLimit(1).font(.system(size: 12)).tag(Pane.task(t.id))
                    }
                }
            }
            .frame(minWidth: 230)
        } detail: {
            switch pane {
            case .live: NotchAIView().padding(16)
            case .conversation(let id): ConversationDetail(id: id, open: { pane = .live })
            case .task(let id): TaskDetail(id: id)
            }
        }
    }
}

private struct ConversationDetail: View {
    let id: UUID
    let open: () -> Void
    @ObservedObject private var history = ChatHistoryStore.shared

    var body: some View {
        if let s = history.sessions.first(where: { $0.id == id }) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    VStack(alignment: .leading) {
                        Text(s.firstQuestion).font(.system(size: 14, weight: .semibold)).lineLimit(2)
                        Text("\(s.providerTitle) · \(s.modelsUsed.joined(separator: ", "))").font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Continue in NotchAI") { NotchAIConversation.shared.load(s); NotchAINav.shared.section = .chat; open() }
                }
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(s.messages.enumerated()), id: \.offset) { _, m in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(m.role == "user" ? "You" : "NotchAI").font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
                                if m.role == "user" { Text(m.text).textSelection(.enabled) } else { RichTextView(markdown: m.text, fontSize: 13).textSelection(.enabled) }
                            }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }.padding(16)
        } else { Text("That conversation was deleted.").foregroundStyle(.secondary) }
    }
}

private struct TaskDetail: View {
    let id: UUID
    @ObservedObject private var tasks = NotchAITaskStore.shared

    var body: some View {
        if let t = tasks.tasks.first(where: { $0.id == id }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Text(t.title).font(.system(size: 14, weight: .semibold))
                    Text("\(t.agent) agent · \(t.state.title)").font(.system(size: 11)).foregroundStyle(.secondary)
                    ProgressView(value: TaskLogic.progress(t)).tint(NotchAIView.green)
                    ForEach(t.steps) { s in
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(s.title) · \(s.tool) · \(s.state.rawValue)").font(.system(size: 12, weight: .medium))
                            if let e = s.error { Text(e).font(.system(size: 11)).foregroundStyle(.red) }
                            if let r = s.result { Text(String(r.prefix(600))).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary).textSelection(.enabled) }
                        }
                    }
                    Divider()
                    ForEach(Array(t.log.enumerated()), id: \.offset) { _, e in
                        Text("\(e.date.formatted(date: .omitted, time: .standard))  \(e.text)").font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary)
                    }
                    let kids = tasks.tasks.filter { $0.parentID == t.id }
                    if !kids.isEmpty {
                        Divider()
                        Text("Delegated steps").font(.system(size: 12, weight: .semibold))
                        ForEach(kids) { k in Text("\(k.agent): \(k.title) · \(k.state.title)").font(.system(size: 11)).foregroundStyle(.secondary) }
                    }
                }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
            }
        } else { Text("That task was deleted.").foregroundStyle(.secondary) }
    }
}
