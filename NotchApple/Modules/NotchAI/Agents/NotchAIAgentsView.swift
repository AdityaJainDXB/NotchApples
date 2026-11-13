//
//  NotchAIAgentsView.swift
//  Notch Apple
//
//  The Agents section (Ultimate): run a request with the agents, see who is working and what they are doing (the
//  agent cards), switch agents on and off, give an agent its own model, add a custom agent, and see usage per agent.
//  The same cards can float under the notch (AgentHUD).
//

import SwiftUI

struct NotchAIAgentsView: View {
    @ObservedObject private var store = AgentStore.shared
    @ObservedObject private var tasks = NotchAITaskStore.shared
    @AppStorage("notchai.hud.on") private var hudOn = false
    @State private var request = ""
    @State private var message: String?
    @State private var adding = false
    private var unlocked: Bool { NotchAITier.allows(.ultimate) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if !unlocked { Label(NotchAITier.lockedMessage(.ultimate), systemImage: "lock.fill").font(.system(size: 11)).foregroundStyle(.orange) }
                HStack(spacing: 6) {
                    TextField("A request for the agents (e.g. compare two topics on Wikipedia and summarise)", text: $request)
                        .textFieldStyle(.roundedBorder).onSubmit(run)
                    Button("Run with agents") { run() }.disabled(!unlocked || request.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                if let m = message { Text(m).font(.system(size: 11)).foregroundStyle(.orange) }
                Text("The planner picks agents and tools, independent steps run at the same time (up to 3), and anything that changes something asks first. Plans can only use tools the agent has.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                Toggle("Show agent cards under the notch", isOn: $hudOn).toggleStyle(.switch).controlSize(.small)
                    .onChange(of: hudOn) { _ in AgentHUD.shared.refresh() }

                AgentCards(compact: false)
                AgentChatPanel()

                Divider().opacity(0.3)
                HStack {
                    Text("Agents").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                    Spacer()
                    Button(adding ? "Close" : "Add a custom agent") { adding.toggle() }.controlSize(.small)
                }
                if adding { CustomAgentForm(done: { adding = false }) }
                ForEach(store.agents) { a in AgentRow(agent: a) }

                Divider().opacity(0.3)
                Text("Usage (estimated from the text each step handled)").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                let usage = AgentUsageLogic.summary(tasks.tasks)
                if usage.isEmpty { Text("Nothing has run yet.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
                ForEach(usage, id: \.agent) { u in
                    HStack {
                        Text(u.agent).font(.system(size: 11, weight: .medium)).foregroundStyle(.white).frame(width: 90, alignment: .leading)
                        Text("\(u.tasks) tasks · \(u.stepsDone) done · \(u.stepsFailed) failed").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                        Spacer()
                        Text("~\(u.estimatedTokens.formatted()) tokens · \(Int(u.seconds))s").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                    }
                }
            }
        }
    }

    private func run() { message = NotchAIOrchestrator.run(request: request); if message == nil { request = "" } }
}

/// One card per agent that is working: its task, current step, progress, and the approve / cancel buttons.
struct AgentCards: View {
    let compact: Bool
    @ObservedObject private var tasks = NotchAITaskStore.shared

    private var active: [NotchAITask] { tasks.tasks.filter { !$0.state.isFinished && $0.state != .paused || $0.state == .waitingApproval } }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !compact && active.isEmpty {
                Text("No agent is working right now.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            ForEach(active) { t in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Circle().fill(t.state == .waitingApproval ? Color.orange : NotchAIView.green).frame(width: 7, height: 7)
                        Text("\(t.agent) · \(t.title)").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                        Spacer()
                        Text(t.state.title).font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
                        Button { NotchAITaskStore.shared.cancel(t.id) } label: { Image(systemName: "stop.circle") }.buttonStyle(.plain).help("Stop this agent")
                    }
                    Text(current(t)).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                    ProgressView(value: TaskLogic.progress(t)).tint(NotchAIView.green)
                    if t.state == .waitingApproval, let step = t.steps.first(where: { $0.state == .pending }) {
                        HStack {
                            Text("Approve: \(step.title)?").font(.system(size: 10)).foregroundStyle(.orange)
                            Spacer()
                            Button("Approve") { NotchAITaskStore.shared.approve(t.id, true) }.tint(NotchAIView.green).controlSize(.small)
                            Button("Deny") { NotchAITaskStore.shared.approve(t.id, false) }.controlSize(.small)
                        }
                    }
                }
                .padding(8).background(Theme.surface, in: RoundedRectangle(cornerRadius: 9))
            }
        }
    }

    private func current(_ t: NotchAITask) -> String {
        t.steps.first { $0.state == .running }?.title ?? t.steps.first { $0.state == .pending }?.title ?? t.log.last?.text ?? ""
    }
}

private struct AgentRow: View {
    let agent: AgentSpec
    @ObservedObject private var store = AgentStore.shared
    @State private var model = ""
    @State private var provider: AIProvider = .ollama

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Toggle("", isOn: Binding(get: { agent.enabled }, set: { store.setEnabled(agent.id, $0) })).labelsHidden().toggleStyle(.switch).controlSize(.mini)
                VStack(alignment: .leading, spacing: 1) {
                    Text(agent.name + (agent.builtIn ? "" : "  (custom)")).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                    Text(agent.role).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(2)
                    Text(agent.tools.isEmpty ? "No tools" : "Tools: " + agent.tools.joined(separator: ", "))
                        .font(.system(size: 9, design: .monospaced)).foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                if !agent.builtIn { Button { store.deleteCustom(agent.id) } label: { Image(systemName: "trash") }.buttonStyle(.plain).foregroundStyle(.red.opacity(0.8)) }
            }
            if agent.id != "voice" && agent.id != "computer" {
                HStack(spacing: 6) {
                    let route = store.routes[agent.id]
                    Text("Model").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                    Picker("", selection: $provider) { ForEach(AIProvider.allCases) { Text($0.title).tag($0) } }.labelsHidden().frame(width: 190)
                    TextField(route?.model ?? "model (blank = Settings → AI)", text: $model).textFieldStyle(.roundedBorder).frame(width: 170)
                    Button("Set") { store.setRoute(agent.id, model.isEmpty ? nil : AgentRoute(provider: provider.rawValue, model: model)) }.controlSize(.small)
                    let (p, m) = store.model(for: agent.id)
                    Text("\(p.title) · \(m) (\(ModelLocality.of(provider: p, model: m).label))").font(.system(size: 9)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                }
            }
        }
        .padding(8).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
        .onAppear {
            if let r = store.routes[agent.id], let p = AIProvider(rawValue: r.provider) { provider = p; model = r.model }
        }
    }
}

private struct CustomAgentForm: View {
    let done: () -> Void
    @ObservedObject private var store = AgentStore.shared
    @State private var id = ""
    @State private var name = ""
    @State private var role = ""
    @State private var prompt = ""
    @State private var tools: Set<String> = ["agent_ask"]
    @State private var problems: [String] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack { TextField("id (e.g. summariser)", text: $id).textFieldStyle(.roundedBorder); TextField("Name", text: $name).textFieldStyle(.roundedBorder) }
            TextField("What it is for", text: $role).textFieldStyle(.roundedBorder)
            TextField("Instructions for it (its system prompt)", text: $prompt, axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(3...5)
            Text("Tools it may use").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), alignment: .leading)], alignment: .leading, spacing: 2) {
                ForEach(NotchAIToolCatalog.ids.sorted(), id: \.self) { t in
                    Toggle(t, isOn: Binding(get: { tools.contains(t) }, set: { if $0 { tools.insert(t) } else { tools.remove(t) } }))
                        .toggleStyle(.checkbox).font(.system(size: 10))
                }
            }
            ForEach(problems, id: \.self) { Text($0).font(.system(size: 10)).foregroundStyle(.red) }
            Button("Add agent") {
                problems = store.addCustom(AgentSpec(id: id, name: name, role: role, systemPrompt: prompt, tools: tools.sorted()))
                if problems.isEmpty { done() }
            }
            Text("A custom agent can only use the tools listed here. Anything that changes something still asks first.")
                .font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
        }
        .padding(8).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Floating cards under the notch

@MainActor
final class AgentHUD {
    static let shared = AgentHUD()
    private var panel: NSPanel?
    private var timer: Timer?

    /// Shows the cards while the switch is on and something is working; hides them otherwise. Checked once a second
    /// only while the switch is on, so it costs nothing when off.
    func refresh() {
        timer?.invalidate(); timer = nil
        guard UserDefaults.standard.bool(forKey: "notchai.hud.on") else { hide(); return }
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.update() } }
        update()
    }

    private func update() {
        let busy = NotchAITaskStore.shared.tasks.contains { !$0.state.isFinished && $0.state != .paused }
        busy ? show() : hide()
    }

    private func show() {
        guard panel == nil, let screen = NSScreen.main else { return }
        let size = CGSize(width: 340, height: 220)
        let p = NSPanel(contentRect: CGRect(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY - 40 - size.height, width: size.width, height: size.height),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = true
        p.level = .statusBar
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.hidesOnDeactivate = false
        p.isReleasedWhenClosed = false
        p.contentView = NSHostingView(rootView: AgentCards(compact: true).padding(8).frame(width: 340, alignment: .top).environment(\.colorScheme, .dark))
        p.orderFrontRegardless()
        panel = p
    }

    private func hide() { panel?.orderOut(nil); panel = nil }
}

/// Talk to the agent that did a finished task: pick the task, ask a follow-up, see its answers. Each task keeps its own conversation.
private struct AgentChatPanel: View {
    @ObservedObject private var tasks = NotchAITaskStore.shared
    @State private var selected: UUID?
    @State private var draft = ""
    @State private var problem: String?

    private var candidates: [NotchAITask] { tasks.tasks.filter { $0.depth == 0 && AgentChatLogic.canFollowUp($0) } }
    private var current: NotchAITask? { AgentChatLogic.target(explicit: selected, tasks: tasks.tasks).flatMap { id in tasks.tasks.first { $0.id == id } } }

    var body: some View {
        if let t = current {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Ask about a finished task").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                    Spacer()
                    Picker("", selection: Binding(get: { t.id }, set: { selected = $0 })) {
                        ForEach(candidates) { c in Text("\(c.agent) · \(c.title)").lineLimit(1).tag(c.id) }
                    }.labelsHidden().frame(maxWidth: 240)
                }
                ForEach(t.chat ?? []) { m in
                    HStack(alignment: .top) {
                        if m.role == .user { Spacer(minLength: 30) }
                        Text(m.text).font(.system(size: 11)).foregroundStyle(.white).textSelection(.enabled)
                            .padding(7).background(m.role == .user ? NotchAIView.green.opacity(0.25) : Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                        if m.role == .agent { Spacer(minLength: 30) }
                    }
                }
                if tasks.answering.contains(t.id) {
                    HStack { ProgressView().controlSize(.small); Text("\(t.agent) is answering…").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                        Button("Stop") { tasks.stopAnswer(t.id) }.controlSize(.small) }
                }
                if let p = problem { Text(p).font(.system(size: 10)).foregroundStyle(.orange) }
                HStack(spacing: 6) {
                    TextField("Ask \(t.agent) a follow-up", text: $draft).textFieldStyle(.roundedBorder).onSubmit(send)
                    Button("Ask") { send() }.disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || tasks.answering.contains(t.id))
                }
            }
            .padding(8).background(Theme.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: 9))
        }
    }

    private func send() { problem = tasks.followUp(current?.id, draft); if problem == nil { draft = "" } }
}
