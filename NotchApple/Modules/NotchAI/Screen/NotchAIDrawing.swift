//
//  NotchAIDrawing.swift
//  Notch Apple
//
//  Draw on the screen yourself (Pro, off by default). While it is on, holding Control and Option and moving the
//  pointer leaves a green line on the screen, on top of whatever app you are in. Nothing is clicked: the layer never
//  takes a click or the keyboard, and you do not press the mouse button. Lines fade after a few seconds, or press
//  Clear. "Explain what I drew around" reads just the area around your lines (the same on-demand capture as "Choose
//  an area"), so you can circle something and ask about it.
//
//  Only the pointer's position is read, and only while the switch is on; nothing is stored. The rules are in
//  NotchAIDrawingLogic (unit tested).
//

import AppKit
import SwiftUI

@MainActor
final class NotchAIDrawing: ObservableObject {
    static let shared = NotchAIDrawing()

    @Published var isOn: Bool { didSet { UserDefaults.standard.set(isOn, forKey: "notchai.draw.on"); refresh() } }
    @Published var handDrawn: Bool { didSet { UserDefaults.standard.set(handDrawn, forKey: "notchai.draw.handDrawn") } }
    @Published private(set) var strokes: [DrawnStroke] = []

    private var monitors: [Any] = []
    private var panel: NSPanel?
    private let canvas = DrawingCanvas()
    private var screen: NSScreen?
    private var fade: Timer?

    private init() {
        isOn = UserDefaults.standard.bool(forKey: "notchai.draw.on")
        handDrawn = UserDefaults.standard.bool(forKey: "notchai.draw.handDrawn")
    }

    /// Called at launch and whenever the switch or the tier changes.
    func refresh() {
        let want = isOn && NotchAITier.allows(.pro)
        if want, monitors.isEmpty {
            let mask: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged, .rightMouseDragged]
            if let g = NSEvent.addGlobalMonitorForEvents(matching: mask, handler: { [weak self] _ in Task { @MainActor in self?.moved() } }) { monitors.append(g) }
            if let l = NSEvent.addLocalMonitorForEvents(matching: mask, handler: { [weak self] e in Task { @MainActor in self?.moved() }; return e }) { monitors.append(l) }
        }
        if !want, !monitors.isEmpty {
            monitors.forEach(NSEvent.removeMonitor); monitors = []
            clear()
        }
    }

    private func moved() {
        let flags = NSEvent.modifierFlags
        let drawing = DrawingLogic.shouldDraw(control: flags.contains(.control), option: flags.contains(.option),
                                              command: flags.contains(.command), shift: flags.contains(.shift))
        let open = strokes.last.map { $0.finishedAt == nil } ?? false
        guard drawing || open else { return }                 // the usual case: nothing to do
        let at = NSEvent.mouseLocation
        if drawing, let s = NSScreen.screens.first(where: { $0.frame.contains(at) }), s != screen {
            strokes = []                                      // lines belong to one screen
            screen = s
        }
        let point = screen.flatMap { DrawingLogic.fraction(of: at, in: $0.frame) }
        strokes = DrawingLogic.extend(strokes, with: point, drawing: drawing, now: Date())
        show()
    }

    private func show() {
        guard let screen, !strokes.isEmpty else { hide(); return }
        if panel == nil {
            let p = NSPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false
            p.level = .screenSaver
            p.ignoresMouseEvents = true                       // never takes a click or the keyboard
            p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            p.isReleasedWhenClosed = false
            p.contentView = canvas
            panel = p
        }
        if panel?.frame != screen.frame { panel?.setFrame(screen.frame, display: false) }
        canvas.shapes = DrawingLogic.shapes(strokes)
        canvas.needsDisplay = true
        panel?.orderFrontRegardless()
        if fade == nil {
            fade = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in Task { @MainActor in self?.tick() } }
        }
    }

    private func tick() {
        let kept = DrawingLogic.visible(strokes, now: Date())
        if kept.count != strokes.count { strokes = kept; show() }
    }

    private func hide() {
        fade?.invalidate(); fade = nil
        panel?.orderOut(nil)
        canvas.shapes = []
    }

    func clear() { strokes = []; hide() }

    /// The area around everything drawn, in AppKit screen coordinates, with the screen it is on.
    var drawnArea: (rect: CGRect, screen: NSScreen)? {
        guard let screen, let b = DrawingLogic.bounds(of: strokes) else { return nil }
        return (DrawingLogic.screenRect(b, in: screen.frame), screen)
    }
}

private final class DrawingCanvas: NSView {
    var shapes: [AnnotationShape] = []
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        AnnotationRenderer.draw(shapes, in: ctx, size: bounds.size, flipped: true)
    }
}

struct NotchAIDrawingCard: View {
    @ObservedObject private var draw = NotchAIDrawing.shared
    @ObservedObject private var screen = ScreenIntelligence.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Draw on the screen").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
            Toggle("Hold ⌃⌥ and move the pointer to draw", isOn: $draw.isOn).toggleStyle(.switch).controlSize(.small)
            HStack {
                Button("Explain what I drew around") {
                    guard let area = draw.drawnArea else { return }
                    screen.askAbout(area: area.rect, on: area.screen, question: ScreenContextLogic.explainQuestion, label: "Explain what I drew around")
                }
                .disabled(draw.strokes.isEmpty || !screen.isOn || screen.capturing)
                Button("Clear") { draw.clear() }.disabled(draw.strokes.isEmpty)
            }
            Toggle("Hand-drawn style for NotchAI's own arrows, circles and boxes", isOn: $draw.handDrawn).toggleStyle(.switch).controlSize(.mini).font(.system(size: 10))
            Text("You do not press the mouse button, so nothing is clicked. Lines fade after \(Int(DrawingLogic.lifetime)) seconds. Only the pointer's position is read, only while this is on.")
                .font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
        }
        .padding(8).background(Theme.surface, in: RoundedRectangle(cornerRadius: 9))
    }
}
