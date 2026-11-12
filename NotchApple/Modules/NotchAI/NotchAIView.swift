//
//  NotchAIView.swift
//  Notch Apple
//
//  The NotchAI tab (free). Overview of what is on, the cursor companion's settings, and a chat (shared with Quick Ask)
//  that uses the provider chosen in Settings → AI. Screen understanding (Pro) and agents / computer control
//  (Ultimate) arrive in later milestones and are listed here as "coming" so the tiers are visible.
//

import ServiceManagement
import SwiftUI

struct NotchAIView: View {
    enum Section: String, CaseIterable, Identifiable {
        case overview = "Overview", companion = "Companion", chat = "Chat", voice = "Voice", screen = "Screen", research = "Research", agents = "Agents", integrations = "Integrations", tasks = "Tasks", memory = "Memory", skills = "Skills"
        var id: String { rawValue }
    }

    @ObservedObject private var nav = NotchAINav.shared
    private var section: Section { get { nav.section } nonmutating set { nav.section = newValue } }
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @StateObject private var dot = CursorCompanion.shared
    @ObservedObject private var config = AIConfig.shared

    static let green = Color(red: 0x22 / 255, green: 0xC5 / 255, blue: 0x5E / 255)

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 9).fill(Theme.surface)
                    Circle().fill(Self.green).frame(width: 12, height: 12).shadow(color: Self.green, radius: 5)
                }
                .frame(width: 36, height: 36)
                VStack(alignment: .leading, spacing: 1) {
                    Text("NotchAI").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                    Text("Your assistant, with a green dot that follows your cursor")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                }
                Spacer()
                Picker("", selection: Binding(get: { nav.section }, set: { nav.section = $0 })) { ForEach(Section.allCases) { Text($0.rawValue).tag($0) } }
                    .pickerStyle(.menu).labelsHidden().frame(width: 130)
            }
            switch section {
            case .overview: overview
            case .companion: companion
            case .chat: NotchAIConversationView()
            case .voice: NotchAIVoiceView()
            case .screen: NotchAIScreenView()
            case .research: NotchAIResearchView()
            case .agents: NotchAIAgentsView()
            case .integrations: NotchAIIntegrationsView()
            case .tasks: NotchAITasksView()
            case .memory: NotchAIMemoryView()
            case .skills: NotchAISkillsView()
            }
        }
    }

    // MARK: Overview

    private var overview: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                statusRow("Cursor companion", dot.isOn ? (dot.paused ? "On · paused" : "On") : "Off", on: dot.isOn)
                statusRow("AI provider", config.provider.isConfigured ? "\(config.provider.title) · \(config.model)" : "Not set up (Settings → AI)",
                          on: config.provider.isConfigured)
                if config.provider.isConfigured {
                    let loc = ModelLocality.of(provider: config.provider, model: config.model)
                    statusRow("Where it runs", loc == .local ? "Local: stays on this Mac or your network" : "Cloud: prompts go to \(config.provider.title)",
                              on: loc == .local)
                }
                statusRow("Screen awareness", NotchAITier.allows(.pro) ? (ScreenIntelligence.shared.isOn ? "On: only when you ask" : "Off") : "Pro", on: ScreenIntelligence.shared.isOn && NotchAITier.allows(.pro), dim: !NotchAITier.allows(.pro))
                statusRow("Voice", NotchAIVoice.shared.provider.runsLocally ? "Talk and spoken answers, on this Mac" : "Talk and spoken answers (cloud voice)", on: true)
                statusRow("Agents", NotchAITier.allows(.ultimate) ? "\(AgentStore.shared.agents.filter(\.enabled).count) agents ready" : "Ultimate", on: NotchAITier.allows(.ultimate), dim: !NotchAITier.allows(.ultimate))
                HStack {
                    Button(dot.isOn ? "Turn the dot off" : "Turn the dot on") { dot.isOn.toggle() }
                    Text("Nothing is captured or sent unless you ask.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                .padding(.top, 4)
                quickActions.padding(.top, 4)
                OllamaDiagnosticsView().padding(.top, 6)
            }
        }
    }

    private var quickActions: some View {
        HStack(spacing: 8) {
            Button("Ask NotchAI") { nav.section = .chat }
            Button("Explain my screen") { nav.section = .screen; ScreenIntelligence.shared.ask(ScreenContextLogic.explainQuestion, label: "Explain my screen", scope: .window) }
                .disabled(!NotchAITier.allows(.pro) || !ScreenIntelligence.shared.isOn)
            Button("Start voice mode") { nav.section = .voice; NotchAIVoice.shared.talk() }
            Button("Stop all tasks") { NotchAITaskStore.shared.stopAll() }.tint(.red)
        }
        .controlSize(.small)
    }

    private func statusRow(_ title: String, _ value: String, on: Bool, dim: Bool = false) -> some View {
        HStack(spacing: 8) {
            Circle().fill(on ? Self.green : Color.gray.opacity(0.5)).frame(width: 7, height: 7)
            Text(title).font(.system(size: 12, weight: .medium)).foregroundStyle(.white.opacity(dim ? 0.5 : 1))
            Spacer()
            Text(value).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Companion

    private var companion: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Toggle("Show the green dot", isOn: $dot.isOn).toggleStyle(.switch).controlSize(.small)
                    Spacer()
                    Toggle("Pause following", isOn: $dot.paused).toggleStyle(.switch).controlSize(.small).disabled(!dot.isOn)
                }
                Toggle(isOn: $launchAtLogin) {
                    Text("Start at login")
                    Text(dot.reduceMotion ? "The dot comes back when Notch Apple opens. Reduce Motion is on, so it stays still apart from following you."
                                          : "Notch Apple opens when you log in, and the dot with it (if it is on).")
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                .toggleStyle(.switch).controlSize(.small)
                .onChange(of: launchAtLogin) { on in on ? PermissionsModel.shared.enableLoginItem() : PermissionsModel.shared.disableLoginItem() }
                slider("Size", $dot.size, 8...40, "\(Int(dot.size)) pt")
                slider("Glow", $dot.glow, 0...1, "\(Int(dot.glow * 100))%")
                slider("Follow speed", $dot.speed, 0.1...1, "\(Int(dot.speed * 100))%")
                slider("Follow distance", $dot.followDistance, 6...80, "\(Int(dot.followDistance)) pt")
                HStack(spacing: 14) {
                    Toggle("Motion trail", isOn: $dot.trailOn).toggleStyle(.switch).controlSize(.mini)
                    Toggle("Breathing", isOn: $dot.breathing).toggleStyle(.switch).controlSize(.mini)
                    Spacer()
                    Button("Reset appearance") { dot.resetAppearance() }
                }
                .font(.system(size: 11))
                Text("Click the dot to ask a quick question; right-click (or ⌘-click) it to open this tab. It only follows when your pointer is farther than the follow distance, so it never blocks a click. It works with every AI provider off, and no screen or audio is read.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private func slider(_ title: String, _ value: Binding<Double>, _ range: ClosedRange<Double>, _ label: String) -> some View {
        HStack {
            Text(title).font(.system(size: 11)).foregroundStyle(.white).frame(width: 100, alignment: .leading)
            Slider(value: value, in: range)
            Text(label).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).frame(width: 46, alignment: .trailing)
        }
        .disabled(false)
    }
}

/// Which section of the NotchAI tab is showing. Shared so "Continue in NotchAI" from Quick Ask can open on Chat.
@MainActor
final class NotchAINav: ObservableObject {
    static let shared = NotchAINav()
    @Published var section: NotchAIView.Section = .overview
}
