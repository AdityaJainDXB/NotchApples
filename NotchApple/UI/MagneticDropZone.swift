//
//  MagneticDropZone.swift
//  Notch apple
//
//  A drop zone drawn as a card: an icon tile, "Drop a file here", and "or click to browse". While a file is being
//  dragged it reacts to the pointer: within 180 points the card leans up to 10 points towards it, grows a little and
//  glows, and the title changes to "Bring it closer"; with the pointer over it, "Let go to add it". The pointer comes
//  from `DragState`, which the notch updates while a file drag is under way (macOS gives other views no events for it).
//

import AppKit
import SwiftUI

/// Whether a file is being dragged, and where the pointer is (screen coordinates).
@MainActor
final class DragState: ObservableObject {
    static let shared = DragState()
    @Published private(set) var dragging = false
    @Published private(set) var pointer = CGPoint.zero

    func update(dragging: Bool, pointer: CGPoint) {
        if self.dragging != dragging { self.dragging = dragging }
        if dragging, self.pointer != pointer { self.pointer = pointer }
    }
}

/// Reads where a view sits on screen.
private final class ScreenProbe {
    weak var view: NSView?
    var rect: NSRect {
        guard let v = view, let w = v.window else { return .zero }
        return w.convertToScreen(v.convert(v.bounds, to: nil))
    }
}

private struct ScreenProbeView: NSViewRepresentable {
    let probe: ScreenProbe
    func makeNSView(context: Context) -> NSView { let v = NSView(); probe.view = v; return v }
    func updateNSView(_ nsView: NSView, context: Context) { probe.view = nsView }
}

struct MagneticDropZone: View {
    var icon = "arrow.up.doc.fill"
    var idle = "Drop a file here"
    var near = "Bring it closer"
    var over = "Let go to add it"
    var subtitle = "or click to browse"
    /// The drop target's own "a file is over me" (the pointer test below also counts).
    var isOver = false
    /// One line instead of a card, for narrow spots.
    var compact = false
    var onBrowse: (() -> Void)?

    @ObservedObject private var drag = DragState.shared
    @State private var probe = ScreenProbe()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let reach: CGFloat = 180, maxPull: CGFloat = 10

    var body: some View {
        let rect = probe.rect, p = drag.pointer
        let dx = max(abs(p.x - rect.midX) - rect.width / 2, 0), dy = max(abs(p.y - rect.midY) - rect.height / 2, 0)
        let proximity = drag.dragging && rect != .zero ? max(0, 1 - hypot(dx, dy) / reach) : 0
        let pointerOver = drag.dragging && rect.contains(p)
        let isOverNow = isOver || pointerOver
        let isNear = proximity > 0 || isOverNow
        let ddx = p.x - rect.midX, ddy = -(p.y - rect.midY), dist = max(hypot(ddx, ddy), 1)
        let pull = reduceMotion || isOverNow ? 0 : proximity * maxPull
        let title = isOverNow ? over : isNear ? near : idle

        ZStack {
            // Glow that follows the pointer.
            Circle().fill(Theme.accent.opacity(0.3)).frame(width: 150, height: 150).blur(radius: 36)
                .offset(x: reduceMotion ? 0 : min(max(ddx, -rect.width / 2), rect.width / 2) * 0.6,
                        y: reduceMotion ? 0 : min(max(ddy, -rect.height / 2), rect.height / 2) * 0.6)
                .opacity(isNear ? 1 : 0).allowsHitTesting(false)
            Group {
                if compact {
                    HStack(spacing: 10) { tile; titles(title) }
                } else {
                    VStack(spacing: 8) { tile; titles(title) }
                }
            }
            .padding(compact ? 10 : 14)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(isOverNow ? Theme.accent.opacity(0.16) : isNear ? Theme.accent.opacity(0.08) : Theme.surface.opacity(0.6)))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(isOverNow ? Theme.accentBright : isNear ? Theme.accent.opacity(0.7) : Color.white.opacity(0.16), lineWidth: isOverNow ? 1.5 : 1))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .background(ScreenProbeView(probe: probe))
        .offset(x: ddx / dist * pull, y: ddy / dist * pull)
        .scaleEffect(reduceMotion ? 1 : isOverNow ? 1.025 : isNear ? 1.01 : 1)
        .animation(reduceMotion ? nil : .interpolatingSpring(stiffness: 280, damping: 24), value: pull)
        .animation(reduceMotion ? nil : .interpolatingSpring(stiffness: 280, damping: 24), value: isOverNow)
        .animation(reduceMotion ? nil : .interpolatingSpring(stiffness: 280, damping: 24), value: isNear)
        .contentShape(RoundedRectangle(cornerRadius: 16))
        .onTapGesture { onBrowse?() }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(idle). \(subtitle)")
        .accessibilityAddTraits(.isButton)
    }

    private var tile: some View {
        Image(systemName: icon).font(.system(size: compact ? 15 : 20, weight: .semibold))
            .foregroundStyle(drag.dragging ? Theme.accentBright : Theme.textSecondary)
            .frame(width: compact ? 32 : 44, height: compact ? 32 : 44)
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white.opacity(0.07)))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(Color.white.opacity(0.14)))
    }

    private func titles(_ title: String) -> some View {
        VStack(alignment: compact ? .leading : .center, spacing: 2) {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
            Text(subtitle).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(compact ? .leading : .center).lineLimit(compact ? 1 : 3)
        }
    }
}
