//
//  QuickAskPanel.swift
//  Notch Apple
//
//  The small panel that opens when you click the green dot: one question, one streamed answer, through the
//  provider and model already chosen in Settings → AI (AIConfig). Free tier: text only, no screen capture.
//  The dot shows "thinking" while an answer is coming. Esc or clicking elsewhere closes it.
//

import AppKit
import SwiftUI

@MainActor
enum QuickAskPanel {
    private static var panel: NSPanel?

    static func toggle(near point: CGPoint) {
        if panel != nil { close() } else { show(near: point) }
    }

    static func show(near point: CGPoint) {
        close()
        let size = CGSize(width: 340, height: 240)
        let screen = NSScreen.screens.first { $0.frame.contains(point) } ?? NSScreen.main
        let vis = screen?.visibleFrame ?? CGRect(origin: .zero, size: size)
        var o = CGPoint(x: point.x + 18, y: point.y - size.height - 12)
        o.x = min(max(o.x, vis.minX + 8), vis.maxX - size.width - 8)
        if o.y < vis.minY + 8 { o.y = min(point.y + 30, vis.maxY - size.height - 8) }
        let p = AskPanel(contentRect: CGRect(origin: o, size: size), styleMask: [.borderless, .nonactivatingPanel],
                         backing: .buffered, defer: false)
        p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = true
        p.level = .screenSaver + 1
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.isReleasedWhenClosed = false
        p.hidesOnDeactivate = false
        p.contentView = NSHostingView(rootView: QuickAskView(close: { close() }, openFull: {
            close(); CursorCompanion.shared.openNotchAI()
        }))
        panel = p
        p.makeKeyAndOrderFront(nil)
    }

    static func close() {
        CursorCompanion.shared.setState(.idle)
        panel?.orderOut(nil)
        panel = nil
    }
}

private final class AskPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { QuickAskPanel.close() }
    override func resignKey() { super.resignKey(); QuickAskPanel.close() }
}

private struct QuickAskView: View {
    let close: () -> Void
    let openFull: () -> Void
    @ObservedObject private var config = AIConfig.shared
    @State private var question = ""
    @State private var answer = ""
    @State private var busy = false
    @State private var failure: String?
    @State private var task: Task<Void, Never>?
    @FocusState private var focused: Bool

    private let green = Color(red: 0x22 / 255, green: 0xC5 / 255, blue: 0x5E / 255)

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle().fill(green).frame(width: 8, height: 8).shadow(color: green, radius: 4)
                Text("NotchAI").font(.system(size: 12, weight: .semibold))
                Spacer()
                Label("\(config.provider.title) · \(config.model)", systemImage: ModelLocality.of(provider: config.provider, model: config.model).symbol)
                    .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                Button(action: openFull) { Image(systemName: "arrow.up.forward.square") }.buttonStyle(.plain).help("Open NotchAI")
            }
            ScrollView {
                if let failure {
                    Text(failure).font(.system(size: 12)).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading)
                } else if answer.isEmpty {
                    Text(config.provider.isConfigured ? "Ask anything. Text only: nothing on your screen is sent."
                         : "Pick a provider in Settings → AI first.")
                        .font(.system(size: 12)).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text(answer).font(.system(size: 12)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxHeight: .infinity)
            HStack(spacing: 6) {
                TextField("Ask NotchAI…", text: $question)
                    .textFieldStyle(.roundedBorder).focused($focused).onSubmit(send)
                    .disabled(!config.provider.isConfigured)
                Button(busy ? "Stop" : "Ask") { busy ? stop() : send() }
                    .disabled(!busy && question.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(green.opacity(0.35), lineWidth: 1))
        .padding(4)
        .onAppear {
            focused = true
            #if DEBUG
            // Test hook: launch with `-notchai.selftest "question"` to ask it automatically (no keystrokes needed).
            if let q = UserDefaults.standard.string(forKey: "notchai.selftest"), !q.isEmpty, question.isEmpty {
                question = q; send()
            }
            #endif
        }
        .onDisappear { task?.cancel() }
    }

    private func send() {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy else { return }
        let provider = config.provider, model = config.model
        answer = ""; failure = nil; busy = true
        CursorCompanion.shared.setState(.thinking)
        task = Task {
            do {
                try await NotchAIGuard.check(provider: provider, model: model)
                for try await piece in AIClient.stream([ChatMessage(role: .user, text: q)], provider: provider, model: model,
                                                       system: AIClient.systemPrompt) {
                    answer += piece
                }
                if answer.isEmpty { failure = AIError.empty.localizedDescription }
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
