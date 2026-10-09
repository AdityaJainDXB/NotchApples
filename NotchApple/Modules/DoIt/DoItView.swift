//
//  DoItView.swift
//  Notch apple
//
//  The Do It tab (Ultimate): chat a task, press Start, and the AI does it on this Mac's screen, one click,
//  keystroke or scroll at a time, until it's done or you press Stop (or Ctrl+Option+Esc). See DoItAgent for
//  how it works and its limits. The chat log lives in DoItAgent.shared, so it survives closing the notch.
//  The Ultimate lock is shown by ModuleContentView; the agent also refuses to run when not entitled.
//

import SwiftUI

struct DoItView: View {
    @ObservedObject private var agent = DoItAgent.shared
    @EnvironmentObject private var notchState: NotchState
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            chat
            if agent.needsAccessibility || agent.needsScreen { permissionNote }
            if let pending = agent.pendingApproval { approvalRow(pending) }
            inputRow
            Text("Uses this Mac's screen and the AI chosen in Settings → AI. Screenshots are sent to that provider. Stops on Stop or Ctrl+Option+Esc.")
                .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: Pieces

    private var header: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 9).fill(Theme.accentGradient)
                Image(systemName: "wand.and.stars").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
            }
            .frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text("Do It").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                    Circle().fill(statusColor).frame(width: 7, height: 7)
                    Text(statusText).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                Text("Tell it a task. It looks at your screen and clicks, types and scrolls until it's done.")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            Spacer(minLength: 4)
            Toggle("Confirm every step", isOn: $agent.confirmEveryStep)
                .toggleStyle(.checkbox).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            if !agent.isRunning && !agent.log.isEmpty {
                Button("Clear") { agent.clearLog() }.buttonStyle(PurpleButtonStyle(prominent: false))
            }
        }
    }

    private var statusColor: Color {
        switch agent.state {
        case .idle: return Color.gray
        case .running: return Color.green
        case .waitingForYou: return Color.orange
        case .finished: return Theme.accentBright
        }
    }

    private var statusText: String {
        switch agent.state {
        case .idle: return "Ready"
        case .running: return "Step \(agent.stepNumber) · \(agent.currentLine)"
        case .waitingForYou: return "Waiting for you"
        case .finished: return "Finished"
        }
    }

    private var chat: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 6) {
                    if agent.log.isEmpty {
                        Text("Try: \"Fill in this worksheet\" or \"Find the cheapest flight to Lisbon on this page\". It asks before anything that sends, buys or deletes.")
                            .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 4)
                    }
                    ForEach(agent.log) { entry in row(entry).id(entry.id) }
                }
            }
            .onChange(of: agent.log.count) { _ in
                if let last = agent.log.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
            }
        }
        .frame(maxHeight: .infinity)
    }

    @ViewBuilder private func row(_ entry: DoItAgent.Entry) -> some View {
        switch entry.kind {
        case .user:
            HStack {
                Spacer(minLength: 60)
                Text(entry.text).font(.system(size: 12)).foregroundStyle(.white)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 11).fill(Theme.accent.opacity(0.55)))
            }
        case .agent:
            HStack {
                Text(entry.text).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                Spacer(minLength: 60)
            }
        case .question:
            HStack {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "questionmark.bubble.fill").foregroundStyle(Color.orange)
                    Text(entry.text).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                }
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 11).fill(Color.orange.opacity(0.18)))
                .overlay(RoundedRectangle(cornerRadius: 11).strokeBorder(Color.orange.opacity(0.6)))
                Spacer(minLength: 60)
            }
        case .error:
            HStack {
                Text(entry.text).font(.system(size: 11)).foregroundStyle(Color.red)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 20)
            }
        case .info:
            HStack {
                Text(entry.text).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).italic()
                Spacer(minLength: 20)
            }
        }
    }

    private var permissionNote: some View {
        HStack(spacing: 8) {
            Image(systemName: "lock.shield").foregroundStyle(Color.orange)
            Text(agent.needsScreen ? "Allow Screen Recording, then relaunch Notch apple." : "Allow Notch apple in Accessibility, then press Start again.")
                .font(.system(size: 11)).foregroundStyle(.white)
            Spacer(minLength: 4)
            Button("Open System Settings") {
                if agent.needsScreen { ScreenPermission.openSettings() } else { agent.openAccessibilitySettings() }
            }
            .buttonStyle(PurpleButtonStyle(prominent: false))
        }
    }

    private func approvalRow(_ cmd: DoItAgent.Command) -> some View {
        HStack(spacing: 8) {
            Text("Next: \(cmd.say.isEmpty ? cmd.action : cmd.say)")
                .font(.system(size: 11, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
            Spacer(minLength: 4)
            Button("Skip") { agent.skip() }.buttonStyle(PurpleButtonStyle(prominent: false))
            Button("Approve") { agent.approve() }.buttonStyle(PurpleButtonStyle())
        }
    }

    private var inputRow: some View {
        HStack(spacing: 8) {
            TextField(inputPlaceholder, text: $draft)
                .textFieldStyle(.plain).font(.system(size: 12)).foregroundStyle(.white)
                .focused($focused)
                .padding(.horizontal, 10).frame(minHeight: Theme.minTarget)
                .background(RoundedRectangle(cornerRadius: 9).fill(Theme.surface))
                .onSubmit(submit)
            if agent.isRunning {
                if !draft.isEmpty {
                    Button { submit() } label: { Image(systemName: "paperplane.fill") }
                        .buttonStyle(PurpleButtonStyle(prominent: false)).help("Tell it something while it works")
                }
                Button {
                    agent.stop()
                } label: {
                    Text("Stop").font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 16).frame(minHeight: Theme.minTarget)
                        .background(Capsule().fill(Color.red))
                }
                .buttonStyle(.plain).help("Stop now (Ctrl+Option+Esc)")
            } else {
                Button("Start") { submit() }
                    .buttonStyle(PurpleButtonStyle())
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private var inputPlaceholder: String {
        if agent.state == .waitingForYou && agent.pendingApproval == nil { return "Answer the question…" }
        return agent.isRunning ? "Add something for it to know…" : "What should I do on your screen?"
    }

    private func submit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if agent.isRunning {
            draft = ""
            agent.send(text)
        } else if agent.start(text, closeNotch: { notchState.close() }) {
            draft = ""
        }
    }
}
