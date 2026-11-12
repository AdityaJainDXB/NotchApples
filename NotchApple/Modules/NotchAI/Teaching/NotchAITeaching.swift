//
//  NotchAITeaching.swift
//  Notch Apple
//
//  Teaching mode (Pro): say what you want to do; NotchAI reads your screen, asks the model for a short walkthrough,
//  then draws each step over the app (a ring, an arrow, a numbered badge and the instruction), reads it aloud, and moves
//  on when the next thing it expects appears on screen (or when you press Next). The screen is re-read before each step.
//
//  While a walkthrough is running the screen is read every few seconds to see your progress: a visible "Capturing"
//  badge shows in the NotchAI tab and Stop ends it. Nothing is stored. The overlay never takes a click or the keyboard.
//  A label NotchAI cannot find on screen is not guessed at: the step shows its instruction without a target.
//

import AppKit
import SwiftUI

enum TeachingError: LocalizedError {
    case refused(String)
    case noPlan
    var errorDescription: String? {
        switch self { case .refused(let m): m; case .noPlan: "The model did not return a usable walkthrough." }
    }
}

@MainActor
final class NotchAITeaching: ObservableObject {
    static let shared = NotchAITeaching()

    @Published private(set) var plan: TeachingPlan?
    @Published private(set) var index = 0
    @Published private(set) var running = false
    @Published private(set) var status: String?
    @AppStorage("notchai.teach.narrate") var narrate = true { willSet { objectWillChange.send() } }

    private var watcher: Task<Void, Never>?

    func start(goal: String) {
        let g = goal.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !g.isEmpty, !running else { return }
        status = "Reading the screen…"
        running = true
        watcher = Task {
            do {
                let seen = try await ScreenIntelligence.shared.captureBoxes()
                let reply = try await AgentModelClient.complete(agent: "screen", system: "You write short, accurate software walkthroughs.",
                                                                user: TeachingLogic.planPrompt(goal: g, appName: seen.app, screenText: seen.text))
                guard let p = TeachingLogic.parse(reply, goal: g) else { throw TeachingError.noPlan }
                plan = p; index = 0
                await show(step: 0)
                await watch()
            } catch is CancellationError {
            } catch {
                status = error.localizedDescription
                finish()
            }
        }
    }

    func next() { guard let p = plan, let n = TeachingLogic.next(after: index, in: p) else { finish(message: "All done."); return }; Task { index = n; await show(step: n) } }
    func back() { guard index > 0 else { return }; Task { index -= 1; await show(step: index) } }
    func stop() { watcher?.cancel(); finish(message: "Stopped.") }

    private func finish(message: String? = nil) {
        watcher?.cancel(); watcher = nil
        running = false; plan = nil; index = 0
        if let message { status = message }
        AnnotationOverlay.shared.hide()
        NotchAIVoice.shared.stopSpeaking()
    }

    /// Re-reads the screen, finds this step's target, draws it, and reads the instruction.
    private func show(step i: Int) async {
        guard let p = plan, i < p.steps.count else { return }
        let step = p.steps[i]
        var target: CGRect?
        if let t = step.target, let seen = try? await ScreenIntelligence.shared.captureBoxes() {
            target = TeachingLogic.locate(t, in: seen.boxes)
            status = target == nil ? "Step \(i + 1) of \(p.steps.count): couldn't find “\(t)” on screen." : "Step \(i + 1) of \(p.steps.count)"
        } else { status = "Step \(i + 1) of \(p.steps.count)" }
        AnnotationOverlay.shared.show(TeachingLogic.annotations(step: step, number: i + 1, target: target))
        if narrate { try? NotchAIVoice.shared.speakText(step.instruction) }
    }

    /// Every few seconds, see whether the step is done.
    private func watch() async {
        while !Task.isCancelled, running {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            guard let p = plan, index < p.steps.count, !Task.isCancelled else { return }
            if let seen = try? await ScreenIntelligence.shared.captureBoxes(), TeachingLogic.isDone(p.steps[index], screenText: seen.text) {
                if let n = TeachingLogic.next(after: index, in: p) { index = n; await show(step: n) } else { finish(message: "Finished: you did it."); return }
            }
        }
    }
}

/// A transparent, click-through layer over the main screen that draws the annotations.
@MainActor
final class AnnotationOverlay {
    static let shared = AnnotationOverlay()
    private var panel: NSPanel?
    private let canvas = AnnotationCanvas()

    func show(_ shapes: [AnnotationShape]) {
        guard let screen = NSScreen.main else { return }
        if panel == nil {
            let p = NSPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false
            p.level = .screenSaver
            p.ignoresMouseEvents = true                     // never takes a click or the keyboard
            p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            p.isReleasedWhenClosed = false
            p.contentView = canvas
            panel = p
        }
        panel?.setFrame(screen.frame, display: false)
        canvas.shapes = shapes
        canvas.needsDisplay = true
        panel?.orderFrontRegardless()
    }

    func hide() { panel?.orderOut(nil); panel = nil; canvas.shapes = [] }
}

private final class AnnotationCanvas: NSView {
    var shapes: [AnnotationShape] = []
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        AnnotationRenderer.draw(shapes, in: ctx, size: bounds.size, flipped: true)
    }
}

struct NotchAITeachingCard: View {
    @ObservedObject private var teach = NotchAITeaching.shared
    @State private var goal = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Teach me").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
            HStack {
                TextField("What do you want to do? (e.g. export this as a PDF)", text: $goal).textFieldStyle(.roundedBorder).onSubmit { teach.start(goal: goal) }
                Button("Start") { teach.start(goal: goal) }.disabled(teach.running || goal.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if teach.running, let p = teach.plan {
                Text(p.steps[teach.index].instruction).font(.system(size: 12)).foregroundStyle(.white)
                HStack {
                    Button("Back") { teach.back() }.disabled(teach.index == 0)
                    Button("Next") { teach.next() }
                    Button("Stop") { teach.stop() }.tint(.red)
                    Label("Reading the screen every few seconds", systemImage: "record.circle").font(.system(size: 10)).foregroundStyle(.red)
                }
            } else if teach.running { ProgressView().controlSize(.small) }
            if let s = teach.status { Text(s).font(.system(size: 10)).foregroundStyle(.orange) }
            Toggle("Read each step aloud", isOn: $teach.narrate).toggleStyle(.switch).controlSize(.mini).font(.system(size: 10))
            Text("Draws on your screen to point at each step and moves on when the next thing appears. It re-reads the screen only while a walkthrough runs; Stop ends it. Local first applies to the model.")
                .font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
        }
        .padding(8).background(Theme.surface, in: RoundedRectangle(cornerRadius: 9))
    }
}
