//
//  NotchAITasksView.swift
//  Notch Apple
//
//  The Tasks section: every task with its state, progress, steps and log; approve or deny a step that needs it;
//  cancel, resume (after a restart), retry, delete; the permission level; and the emergency Stop all.
//

import SwiftUI

struct NotchAITasksView: View {
    @ObservedObject private var store = NotchAITaskStore.shared
    @State private var expanded: Set<UUID> = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Permission").font(.system(size: 11)).foregroundStyle(.white)
                    Picker("", selection: Binding(get: { store.level }, set: { store.level = $0 })) {
                        ForEach(PermissionLevel.allCases) { Text($0.title).tag($0) }
                    }.labelsHidden().frame(width: 210)
                    Spacer()
                    Button("Stop all") { store.stopAll() }.tint(.red).help("Cancels every task, the answer being written, and any speech")
                    Button("Clear finished") { store.clearFinished() }.disabled(!store.tasks.contains { $0.state.isFinished })
                }
                Text("Reading steps run on their own. Anything that changes something asks first; sending, purchasing, deleting and installing always ask, at every level.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                if store.tasks.isEmpty {
                    Text("No tasks yet. Research and File questions run here as tasks you can watch, cancel and retry.")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).padding(.top, 6)
                }
                ForEach(store.tasks) { t in card(t) }
            }
        }
    }

    private func card(_ t: NotchAITask) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: icon(t.state)).foregroundStyle(color(t.state))
                VStack(alignment: .leading, spacing: 1) {
                    Text(t.title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                    Text("\(t.agent) agent · \(t.state.title)\(duration(t))").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                actions(t)
                Button { toggle(t.id) } label: { Image(systemName: expanded.contains(t.id) ? "chevron.up" : "chevron.down") }.buttonStyle(MetalPlainStyle())
            }
            ProgressView(value: TaskLogic.progress(t)).tint(NotchAIView.green)
            if t.state == .waitingApproval, let step = t.steps.first(where: { $0.state == .pending }) {
                HStack {
                    Label("Approve: \(step.title)?", systemImage: "hand.raised.fill").font(.system(size: 11)).foregroundStyle(.orange)
                    Spacer()
                    Button("Approve") { store.approve(t.id, true) }.tint(NotchAIView.green)
                    Button("Deny") { store.approve(t.id, false) }
                }
            }
            if expanded.contains(t.id) {
                ForEach(t.steps) { s in
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: stepIcon(s.state)).font(.system(size: 10)).foregroundStyle(stepColor(s.state))
                        VStack(alignment: .leading, spacing: 1) {
                            Text("\(s.title)  ·  \(s.tool)").font(.system(size: 10, weight: .medium)).foregroundStyle(.white)
                            if let e = s.error { Text(e).font(.system(size: 10)).foregroundStyle(.red) }
                            else if s.state == .done, let r = s.result { Text(String(r.prefix(100))).font(.system(size: 9)).foregroundStyle(Theme.textSecondary).lineLimit(1) }
                        }
                    }
                }
                Divider().opacity(0.3)
                ForEach(Array(t.log.suffix(8).enumerated()), id: \.offset) { _, e in
                    Text("\(e.date.formatted(date: .omitted, time: .standard))  \(e.text)").font(.system(size: 9, design: .monospaced)).foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .padding(8).background(Theme.surface, in: RoundedRectangle(cornerRadius: 9))
    }

    @ViewBuilder private func actions(_ t: NotchAITask) -> some View {
        switch t.state {
        case .running, .waitingApproval, .queued: Button("Cancel") { store.cancel(t.id) }.controlSize(.small)
        case .paused: Button("Resume") { store.resume(t.id) }.controlSize(.small)
        case .failed: Button("Retry") { store.resume(t.id) }.controlSize(.small)
        default: EmptyView()
        }
        if t.state.isFinished || t.state == .paused { Button { store.delete(t.id) } label: { Image(systemName: "trash") }.buttonStyle(MetalPlainStyle()).foregroundStyle(.red.opacity(0.8)) }
    }

    private func toggle(_ id: UUID) { if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) } }

    private func duration(_ t: NotchAITask) -> String {
        guard let s = t.started else { return "" }
        let secs = Int(((t.finished ?? Date()).timeIntervalSince(s)).rounded())
        return " · \(secs)s"
    }

    private func icon(_ s: TaskState) -> String {
        switch s {
        case .queued: "clock"
        case .running: "arrow.triangle.2.circlepath"
        case .waitingApproval: "hand.raised.fill"
        case .paused: "pause.circle.fill"
        case .completed: "checkmark.circle.fill"
        case .failed: "xmark.octagon.fill"
        case .cancelled: "minus.circle.fill"
        }
    }

    private func color(_ s: TaskState) -> Color {
        switch s {
        case .completed, .running: NotchAIView.green
        case .failed: .red
        case .waitingApproval, .paused: .orange
        default: Theme.textSecondary
        }
    }

    private func stepIcon(_ s: StepState) -> String {
        switch s { case .pending: "circle"; case .running: "circle.dotted"; case .done: "checkmark.circle.fill"; case .failed: "xmark.circle.fill"; case .skipped: "minus.circle" }
    }

    private func stepColor(_ s: StepState) -> Color {
        switch s { case .done: NotchAIView.green; case .failed: .red; case .running: .orange; default: Theme.textSecondary }
    }
}
