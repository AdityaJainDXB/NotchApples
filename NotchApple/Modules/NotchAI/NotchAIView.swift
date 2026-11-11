//
//  NotchAIView.swift
//  Notch Apple
//
//  The NotchAI tab (free). Overview of what is on, the cursor companion's settings, and a basic chat box that
//  uses the provider chosen in Settings → AI. Screen understanding (Pro) and agents / computer control
//  (Ultimate) arrive in later milestones and are listed here as "coming" so the tiers are visible.
//

import SwiftUI

struct NotchAIView: View {
    enum Section: String, CaseIterable, Identifiable {
        case overview = "Overview", companion = "Companion", chat = "Chat"
        var id: String { rawValue }
    }

    @State private var section: Section = .overview
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
                Picker("", selection: $section) { ForEach(Section.allCases) { Text($0.rawValue).tag($0) } }
                    .pickerStyle(.segmented).labelsHidden().frame(width: 200)
            }
            switch section {
            case .overview: overview
            case .companion: companion
            case .chat: NotchAIChat()
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
                statusRow("Screen awareness", "Coming in a later update (Pro)", on: false, dim: true)
                statusRow("Voice", "Coming in a later update (Pro)", on: false, dim: true)
                statusRow("Agents and computer control", "Coming in a later update (Ultimate)", on: false, dim: true)
                HStack {
                    Button(dot.isOn ? "Turn the dot off" : "Turn the dot on") { dot.isOn.toggle() }
                    Text("Nothing is captured or sent unless you ask.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                .padding(.top, 4)
            }
        }
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

/// Basic chat: text in, streamed answer out, through the provider in Settings → AI. Not saved to history.
private struct NotchAIChat: View {
    @ObservedObject private var config = AIConfig.shared
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var busy = false
    @State private var failure: String?
    @State private var task: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 8) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        if messages.isEmpty {
                            Text(config.provider.isConfigured ? "Ask anything. Uses \(config.provider.title) · \(config.model) (\(ModelLocality.of(provider: config.provider, model: config.model).label.lowercased())). Text only."
                                 : "Choose a provider in Settings → AI to start.")
                                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                        }
                        ForEach(messages) { m in
                            Text(m.text.isEmpty ? "…" : m.text)
                                .font(.system(size: 12)).foregroundStyle(.white).textSelection(.enabled)
                                .padding(8)
                                .frame(maxWidth: .infinity, alignment: m.role == .user ? .trailing : .leading)
                                .background(m.role == .user ? NotchAIView.green.opacity(0.25) : Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                                .id(m.id)
                        }
                        if let failure { Text(failure).font(.system(size: 11)).foregroundStyle(.red) }
                    }
                }
                .onChange(of: messages.last?.text) { _ in if let id = messages.last?.id { proxy.scrollTo(id, anchor: .bottom) } }
            }
            HStack(spacing: 6) {
                TextField("Ask NotchAI…", text: $input).textFieldStyle(.roundedBorder).onSubmit(send)
                    .disabled(!config.provider.isConfigured)
                Button(busy ? "Stop" : "Send") { busy ? stop() : send() }
                    .disabled(!busy && input.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Clear") { stop(); messages = []; failure = nil }.disabled(messages.isEmpty)
            }
        }
    }

    private func send() {
        let q = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy else { return }
        input = ""; failure = nil; busy = true
        messages.append(ChatMessage(role: .user, text: q))
        let history = messages
        messages.append(ChatMessage(role: .assistant, text: ""))
        let provider = config.provider, model = config.model
        CursorCompanion.shared.setState(.thinking)
        task = Task {
            do {
                try await NotchAIGuard.check(provider: provider, model: model)
                for try await piece in AIClient.stream(history, provider: provider, model: model, system: AIClient.systemPrompt) {
                    if let i = messages.indices.last { messages[i].text += piece }
                }
                if messages.last?.text.isEmpty == true { failure = AIError.empty.localizedDescription }
            } catch is CancellationError {
            } catch {
                failure = error.localizedDescription
            }
            busy = false
            CursorCompanion.shared.setState(.idle)
        }
    }

    private func stop() { task?.cancel(); busy = false; CursorCompanion.shared.setState(.idle) }
}
