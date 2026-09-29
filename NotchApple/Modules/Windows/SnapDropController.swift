//
//  SnapDropController.swift
//  Notch apple
//
//  Drag any window up to the notch and a strip of snap zones drops down
//  beneath it. Keep dragging onto a zone and let go: the window snaps there.
//
//  Only mouse events are observed (a global NSEvent monitor, which never sees
//  keystrokes). The overlay ignores the mouse, so the window drag carries on
//  normally; we hit-test the zones ourselves from the pointer position.
//

import AppKit
import SwiftUI

@MainActor
final class SnapDropModel: ObservableObject {
    @Published var highlighted: SnapLayout?
}

@MainActor
final class SnapDropController {
    static let shared = SnapDropController()

    // Zone geometry, shared with the SwiftUI view so drawing and hit-testing agree.
    static let tile = CGSize(width: 62, height: 40)
    static let spacing: CGFloat = 8
    static let padding: CGFloat = 12
    static let labelHeight: CGFloat = 24
    static var columns: Int { SnapLayout.dropRows[0].count }
    static var size: CGSize {
        CGSize(width: padding * 2 + CGFloat(columns) * tile.width + CGFloat(columns - 1) * spacing,
               height: padding * 2 + labelHeight + 2 * tile.height + spacing)
    }

    /// Top-left-origin rect of a zone inside the overlay.
    static func tileRect(row: Int, column: Int) -> CGRect {
        CGRect(x: padding + CGFloat(column) * (tile.width + spacing),
               y: padding + labelHeight + CGFloat(row) * (tile.height + spacing),
               width: tile.width, height: tile.height)
    }

    private let model = SnapDropModel()
    private var panel: NSPanel?
    private var monitors: [Any] = []

    private var dragged: AXUIElement?
    private var startOrigin: CGRect?
    private var isWindowDrag = false
    private var checkedThisDrag = false

    func setEnabled(_ enabled: Bool) {
        if enabled, monitors.isEmpty {
            if let m = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDragged], handler: { _ in
                MainActor.assumeIsolated { SnapDropController.shared.dragMoved() }
            }) { monitors.append(m) }
            if let m = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseUp], handler: { _ in
                MainActor.assumeIsolated { SnapDropController.shared.dragEnded() }
            }) { monitors.append(m) }
        } else if !enabled {
            monitors.forEach(NSEvent.removeMonitor)
            monitors.removeAll()
            hide()
        }
    }

    // MARK: Drag tracking

    private func dragMoved() {
        let mouse = NSEvent.mouseLocation
        let manager = WindowManager.shared

        if !checkedThisDrag {
            // First drag event: remember the window under the pointer and where it was.
            checkedThisDrag = true
            dragged = manager.window(at: mouse)
            startOrigin = dragged.flatMap(manager.frame(of:))
            return
        }
        guard let dragged, let startOrigin else { return }
        if !isWindowDrag {
            // It's a window drag once the window itself has moved (not a text selection, etc.).
            guard let now = manager.frame(of: dragged), now.origin != startOrigin.origin, now.size == startOrigin.size else { return }
            isWindowDrag = true
        }

        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(mouse) }) else { return }
        if panel?.isVisible == true, let frame = panel?.frame {
            if frame.insetBy(dx: -40, dy: -40).contains(mouse) || nearNotch(mouse, on: screen) {
                model.highlighted = zone(at: mouse, in: frame)
            } else {
                hide()
            }
        } else if nearNotch(mouse, on: screen) {
            show(on: screen)
        }
    }

    private func dragEnded() {
        defer {
            dragged = nil; startOrigin = nil
            isWindowDrag = false; checkedThisDrag = false
        }
        guard panel?.isVisible == true else { return }
        let choice = model.highlighted
        let window = dragged
        hide()
        guard let choice, let window else { return }
        // Let the window server finish the drag before resizing.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
            WindowManager.shared.snap(window, to: choice)
        }
    }

    /// The pointer is at the top of the screen, around the notch.
    private func nearNotch(_ p: NSPoint, on screen: NSScreen) -> Bool {
        let f = screen.frame
        return p.y >= f.maxY - 34 && abs(p.x - f.midX) < 300
    }

    private func zone(at p: NSPoint, in frame: CGRect) -> SnapLayout? {
        let local = CGPoint(x: p.x - frame.minX, y: frame.maxY - p.y)
        for (r, row) in SnapLayout.dropRows.enumerated() {
            for (c, layout) in row.enumerated() where Self.tileRect(row: r, column: c).insetBy(dx: -4, dy: -4).contains(local) {
                return layout
            }
        }
        return nil
    }

    // MARK: Overlay

    /// Screenshots (demo mode): show the drop zones with one highlighted.
    func preview(_ layout: SnapLayout) {
        guard let screen = NSScreen.main else { return }
        show(on: screen)
        model.highlighted = layout
    }
    
    private func show(on screen: NSScreen) {
        let panel = self.panel ?? makePanel()
        self.panel = panel
        let size = Self.size
        let top = screen.frame.maxY - (screen.frame.maxY - screen.visibleFrame.maxY) - 4
        panel.setFrame(CGRect(x: screen.frame.midX - size.width / 2, y: top - size.height,
                              width: size.width, height: size.height), display: false)
        model.highlighted = nil
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.15
            panel.animator().alphaValue = 1
        }
    }

    private func hide() {
        model.highlighted = nil
        panel?.orderOut(nil)
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(contentRect: CGRect(origin: .zero, size: Self.size),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .popUpMenu
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.ignoresMouseEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        let hosting = NSHostingView(rootView: SnapDropView(model: model))
        hosting.sizingOptions = []
        hosting.frame = CGRect(origin: .zero, size: Self.size)
        panel.contentView = hosting
        return panel
    }
}

/// The strip of snap zones shown under the notch.
private struct SnapDropView: View {
    @ObservedObject var model: SnapDropModel

    var body: some View {
        let size = SnapDropController.size
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(.black.opacity(0.96))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.accent.opacity(0.5)))

            Text(model.highlighted?.title ?? "Drop on a zone to snap the window")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(model.highlighted == nil ? Theme.textSecondary : .white)
                .frame(width: size.width, height: SnapDropController.labelHeight)
                .offset(y: SnapDropController.padding - 2)

            ForEach(Array(SnapLayout.dropRows.enumerated()), id: \.offset) { r, row in
                ForEach(Array(row.enumerated()), id: \.offset) { c, layout in
                    let rect = SnapDropController.tileRect(row: r, column: c)
                    LayoutGlyph(layout: layout, active: model.highlighted == layout)
                        .frame(width: rect.width, height: rect.height)
                        .offset(x: rect.minX, y: rect.minY)
                }
            }
        }
        .frame(width: size.width, height: size.height)
        .animation(.easeOut(duration: 0.12), value: model.highlighted)
    }
}

/// A tiny screen with the snap area filled in.
struct LayoutGlyph: View {
    let layout: SnapLayout
    var active = false

    var body: some View {
        GeometryReader { geo in
            let u = layout.unit
            let inner = CGRect(origin: .zero, size: geo.size).insetBy(dx: 4, dy: 4)
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(active ? Theme.accent.opacity(0.35) : Color.white.opacity(0.08))
                    .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .strokeBorder(active ? Theme.accent : Color.white.opacity(0.18), lineWidth: active ? 2 : 1))
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(active ? AnyShapeStyle(Color.white) : AnyShapeStyle(Theme.accentGradient))
                    .frame(width: max(4, inner.width * u.width - 2), height: max(4, inner.height * u.height - 2))
                    .offset(x: inner.minX + inner.width * u.minX + 1, y: inner.minY + inner.height * u.minY + 1)
            }
        }
        .scaleEffect(active ? 1.08 : 1)
    }
}
