//
//  OllamaDiagnosticsView.swift
//  Notch Apple
//
//  The "Check Ollama" card on the NotchAI Overview: runs OllamaDiagnostics (two local requests to
//  localhost:11434, nothing leaves this Mac) and lists what it found: server, models with Local / Cloud badges,
//  and whether the model NotchAI is set to use will work. Runs only when you press the button.
//

import SwiftUI

struct OllamaDiagnosticsView: View {
    @ObservedObject private var config = AIConfig.shared
    @State private var report: OllamaReport?
    #if DEBUG
    /// Snapshot hook (DEBUG only): a report to show without pressing the button.
    static var debugReport: OllamaReport?
    #endif
    @State private var checking = false

    init() {
        #if DEBUG
        _report = State(initialValue: Self.debugReport)
        #endif
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Ollama").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                Spacer()
                if checking { ProgressView().controlSize(.small) }
                Button(report == nil ? "Check Ollama" : "Check again") { run() }.disabled(checking)
            }
            if let r = report {
                ForEach(Array(r.findings.enumerated()), id: \.offset) { _, f in
                    Label(f.text, systemImage: symbol(f.level))
                        .font(.system(size: 11)).foregroundStyle(color(f.level))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if !r.models.isEmpty {
                    VStack(spacing: 4) {
                        ForEach(r.models, id: \.name) { m in
                            HStack(spacing: 6) {
                                Text(m.name).font(.system(size: 11, weight: .medium)).foregroundStyle(.white)
                                Text(m.badge).font(.system(size: 9, weight: .semibold))
                                    .padding(.horizontal, 5).padding(.vertical, 1)
                                    .background(badgeColor(m.badge).opacity(0.25), in: Capsule())
                                    .foregroundStyle(badgeColor(m.badge))
                                Spacer()
                                Text(m.detail).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                            }
                        }
                    }
                    .padding(8).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                }
            } else {
                Text("Checks that Ollama is running, lists your models and where each one runs. Local requests only.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private func run() {
        checking = true
        let selected = config.provider == .ollama ? config.model : nil
        Task {
            report = await OllamaDiagnostics.run(selectedModel: selected, allowCloud: ModelLocality.allowCloud)
            checking = false
        }
    }

    private func symbol(_ l: OllamaReport.Level) -> String {
        switch l {
        case .ok: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .problem: "xmark.octagon.fill"
        case .info: "info.circle.fill"
        }
    }

    private func color(_ l: OllamaReport.Level) -> Color {
        switch l {
        case .ok: NotchAIView.green
        case .warning: .orange
        case .problem: .red
        case .info: Theme.textSecondary
        }
    }

    private func badgeColor(_ badge: String) -> Color {
        switch badge {
        case "Local": NotchAIView.green
        case "Cloud": .orange
        default: .yellow
        }
    }
}
