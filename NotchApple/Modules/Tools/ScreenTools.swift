//
//  ScreenTools.swift
//  Notch apple
//
//  Pro screen tools:
//   • Ruler: drag anywhere on screen to measure width, height and distance in
//     points (and pixels on Retina). Esc or a click closes it. Nothing is captured.
//   • Markup: select part of the screen, then draw arrows, boxes, highlights,
//     pen strokes and text on it; copy or save the result.
//

import AppKit
import SwiftUI

// MARK: - Ruler

@MainActor
enum ScreenRuler {
    private static var windows: [NSWindow] = []

    static func show() {
        guard Entitlements.shared.canUse(.ruler) else { return }
        close()
        for screen in NSScreen.screens {
            let w = KeyableWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
            w.level = .screenSaver
            w.isOpaque = false
            w.backgroundColor = .clear
            w.ignoresMouseEvents = false
            w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            w.contentView = NSHostingView(rootView: RulerView(scale: screen.backingScaleFactor) { close() })
            w.makeKeyAndOrderFront(nil)
            windows.append(w)
        }
        NSApp.activate(ignoringOtherApps: true)
        NSCursor.crosshair.push()
    }

    static func close() {
        if !windows.isEmpty { NSCursor.pop() }
        windows.forEach { $0.orderOut(nil) }
        windows = []
    }
}

final class KeyableWindow: NSWindow {
    override var canBecomeKey: Bool { true }
}

private struct RulerView: View {
    let scale: CGFloat
    let close: () -> Void
    @State private var start: CGPoint?
    @State private var end: CGPoint?

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.opacity(0.08)
            if let s = start, let e = end {
                let r = CGRect(x: min(s.x, e.x), y: min(s.y, e.y), width: abs(e.x - s.x), height: abs(e.y - s.y))
                Rectangle().stroke(Color.cyan.opacity(0.8), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .frame(width: r.width, height: r.height).offset(x: r.minX, y: r.minY)
                Path { p in p.move(to: s); p.addLine(to: e) }.stroke(Color.yellow, lineWidth: 1.5)
                let w = Int(r.width.rounded()), h = Int(r.height.rounded()), d = Int(hypot(r.width, r.height).rounded())
                Text("\(w) × \(h) pt · \(d) pt" + (scale > 1 ? "\n\(Int(CGFloat(w) * scale)) × \(Int(CGFloat(h) * scale)) px" : ""))
                    .font(.system(size: 12, weight: .semibold, design: .monospaced)).foregroundStyle(.white)
                    .padding(6).background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 6))
                    .offset(x: e.x + 12, y: e.y + 12)
            } else {
                Text("Drag to measure · Esc to close")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    .padding(10).background(.black.opacity(0.7), in: Capsule())
                    .frame(maxWidth: .infinity).padding(.top, 60)
            }
        }
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0)
            .onChanged { v in if start == nil || v.translation == .zero { start = v.startLocation }; end = v.location }
            .onEnded { v in if hypot(v.translation.width, v.translation.height) < 3 { close() } })
        .onExitCommand(perform: close)
        .accessibilityLabel("Screen ruler. Drag to measure, Escape to close.")
    }
}

// MARK: - Markup

@MainActor
enum ScreenMarkup {
    private static var window: NSWindow?

    /// Select part of the screen, then mark it up.
    static func captureAndMarkUp() {
        guard Entitlements.shared.canUse(.annotate) else { return }
        Task {
            do {
                guard let input = try await CaptureManager.shared.capture(.region) else { return }
                let scale = NSScreen.main?.backingScaleFactor ?? 2
                open(NSImage(cgImage: input.image, size: NSSize(width: CGFloat(input.image.width) / scale, height: CGFloat(input.image.height) / scale)))
            } catch {
                Notifier.post(title: "Couldn't capture the screen", body: error.localizedDescription)
            }
        }
    }

    static func open(_ image: NSImage) {
        let size = NSSize(width: min(max(image.size.width, 420), 1200), height: min(max(image.size.height, 300), 800) + 52)
        let hosting = NSHostingController(rootView: MarkupView(image: image) { window?.close(); window = nil })
        let w = NSWindow(contentViewController: hosting)
        w.title = "Mark up"
        w.styleMask = [.titled, .closable, .resizable]
        w.setContentSize(size)
        w.center()
        w.isReleasedWhenClosed = false
        window = w
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
    }
}

private struct Mark: Identifiable {
    enum Kind { case arrow, box, highlight, pen, text }
    let id = UUID()
    var kind: Kind
    var points: [CGPoint]
    var color: Color
    var text = ""
}

private struct MarkupView: View {
    let image: NSImage
    let done: () -> Void
    @State private var marks: [Mark] = []
    @State private var current: Mark?
    @State private var tool: Mark.Kind = .arrow
    @State private var color: Color = .red
    @State private var pendingText = ""
    @State private var message: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Picker("", selection: $tool) {
                    Image(systemName: "arrow.up.right").tag(Mark.Kind.arrow).help("Arrow")
                    Image(systemName: "rectangle").tag(Mark.Kind.box).help("Box")
                    Image(systemName: "highlighter").tag(Mark.Kind.highlight).help("Highlight")
                    Image(systemName: "scribble").tag(Mark.Kind.pen).help("Pen")
                    Image(systemName: "textformat").tag(Mark.Kind.text).help("Text")
                }
                .pickerStyle(.segmented).labelsHidden().frame(width: 240)
                ColorPicker("", selection: $color).labelsHidden()
                if tool == .text { TextField("Text, then click the image", text: $pendingText).frame(width: 180) }
                Spacer()
                Button("Undo") { _ = marks.popLast() }.disabled(marks.isEmpty).keyboardShortcut("z")
                Button("Copy") { copy() }.keyboardShortcut("c")
                Button("Save…") { save() }.keyboardShortcut("s")
                if let message { Text(message).font(.caption).foregroundStyle(.secondary) }
            }
            .padding(10)
            canvas
        }
    }

    private var canvas: some View {
        ZStack {
            Image(nsImage: image).resizable().interpolation(.high)
            Canvas { ctx, _ in
                for m in marks + [current].compactMap({ $0 }) { draw(m, in: &ctx) }
            }
        }
        .frame(width: image.size.width, height: image.size.height)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0)
            .onChanged { v in
                if tool == .text { return }
                if current == nil { current = Mark(kind: tool, points: [v.startLocation], color: color) }
                if tool == .pen { current?.points.append(v.location) } else { current?.points = [v.startLocation, v.location] }
            }
            .onEnded { v in
                if tool == .text {
                    guard !pendingText.isEmpty else { return }
                    marks.append(Mark(kind: .text, points: [v.location], color: color, text: pendingText))
                    pendingText = ""
                } else if let c = current { marks.append(c) }
                current = nil
            })
    }

    private func draw(_ m: Mark, in ctx: inout GraphicsContext) {
        guard let a = m.points.first, let b = m.points.last else { return }
        switch m.kind {
        case .box:
            ctx.stroke(Path(CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(b.x - a.x), height: abs(b.y - a.y))), with: .color(m.color), lineWidth: 3)
        case .highlight:
            ctx.fill(Path(CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(b.x - a.x), height: abs(b.y - a.y))), with: .color(m.color.opacity(0.3)))
        case .pen:
            var p = Path(); p.addLines(m.points)
            ctx.stroke(p, with: .color(m.color), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
        case .arrow:
            var p = Path(); p.move(to: a); p.addLine(to: b)
            let angle = atan2(b.y - a.y, b.x - a.x), len: CGFloat = 14
            for side in [-0.5, 0.5] {
                p.move(to: b)
                p.addLine(to: CGPoint(x: b.x - len * cos(angle + side), y: b.y - len * sin(angle + side)))
            }
            ctx.stroke(p, with: .color(m.color), style: StrokeStyle(lineWidth: 3, lineCap: .round))
        case .text:
            ctx.draw(Text(m.text).font(.system(size: 18, weight: .bold)).foregroundStyle(m.color), at: a, anchor: .topLeading)
        }
    }

    private func rendered() -> NSImage? {
        let renderer = ImageRenderer(content: ZStack {
            Image(nsImage: image).resizable()
            Canvas { ctx, _ in for m in marks { draw(m, in: &ctx) } }
        }.frame(width: image.size.width, height: image.size.height))
        renderer.scale = 2
        return renderer.nsImage
    }

    private func copy() {
        guard let img = rendered() else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.writeObjects([img])
        message = "Copied"
    }

    private func save() {
        guard let img = rendered(), let tiff = img.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "Markup \(Date.now.formatted(date: .numeric, time: .shortened)).png".replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: ".")
        panel.allowedContentTypes = [.png]
        if panel.runModal() == .OK, let url = panel.url {
            do { try png.write(to: url); message = "Saved" } catch { message = error.localizedDescription }
        }
    }
}
