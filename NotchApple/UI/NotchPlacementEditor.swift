//
//  NotchPlacementEditor.swift
//  Notch Apple
//
//  Settings → Notch → Adjust placement of notch: a see-through layer over the screen where you
//  drag the notch (same shape, same way up) wherever you like, then Confirm, Reset or Cancel.
//

import AppKit
import SwiftUI

@MainActor
enum NotchPlacementEditor {
    private static var window: NSWindow?

    static func open(on screen: NSScreen, notchSize: CGSize, onDone: @escaping () -> Void) {
        window?.close()
        let w = EditorWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        w.isOpaque = false
        w.backgroundColor = .clear
        w.level = .screenSaver
        w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        w.isReleasedWhenClosed = false
        let close = {
            window?.orderOut(nil)
            window = nil
            onDone()
        }
        let start = CGPoint(x: screen.frame.width * NotchPrefs.placementX,
                            y: min(max(NotchPrefs.placementY, 0), screen.frame.height - 60))
        w.contentView = NSHostingView(rootView: PlacementView(screenSize: screen.frame.size, notchSize: notchSize, start: start) { place in
            if let place {
                NotchPrefs.placementX = Double(place.x / screen.frame.width)
                NotchPrefs.placementY = Double(place.y)
            }
            close()
        })
        w.setFrame(screen.frame, display: true)
        window = w
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
    }

    /// A borderless window that can take the keyboard (for Esc and Return).
    private final class EditorWindow: NSWindow {
        override var canBecomeKey: Bool { true }
        override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
    }
}

/// `place` is the notch's top centre in points from the screen's top-left corner; nil means Cancel.
private struct PlacementView: View {
    let screenSize: CGSize
    let notchSize: CGSize
    let start: CGPoint
    let finish: (CGPoint?) -> Void

    @State private var place: CGPoint = .zero
    @State private var dragStart: CGPoint?
    @State private var shown = false

    /// Within this many points of the top edge the notch snaps back up to it.
    private let snap: CGFloat = 14

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.opacity(shown ? 0.35 : 0).ignoresSafeArea()
                .onTapGesture {}

            notch
                .position(x: place.x, y: place.y + notchSize.height / 2)

            menu
                .position(x: menuX, y: menuY)
        }
        .frame(width: screenSize.width, height: screenSize.height)
        .onAppear {
            place = clamp(start)
            withAnimation(.easeOut(duration: 0.25)) { shown = true }
        }
        .onExitCommand { finish(nil) }
    }

    /// Drawn exactly like the closed notch: flat top, rounded bottom, never turned or flipped.
    private var notch: some View {
        let shoulder = NotchRootView.collapsedShoulder
        return NotchShape(topRadius: shoulder, bottomRadius: min(10, notchSize.height / 2))
            .fill(Color.black)
            .overlay(
                NotchShape(topRadius: shoulder, bottomRadius: min(10, notchSize.height / 2), closed: false)
                    .stroke(Theme.accent, lineWidth: 1.5)
            )
            .overlay(
                Image(systemName: "arrow.up.and.down.and.arrow.left.and.right")
                    .font(.system(size: 11, weight: .bold)).foregroundStyle(.white.opacity(0.8))
            )
            .frame(width: notchSize.width + shoulder * 2, height: notchSize.height)
            .shadow(color: Theme.accent.opacity(dragStart == nil ? 0.25 : 0.55), radius: dragStart == nil ? 8 : 16)
            .scaleEffect(dragStart == nil ? 1 : 1.04, anchor: .top)
            .animation(.spring(response: 0.25, dampingFraction: 0.8), value: dragStart == nil)
            .contentShape(Rectangle())
            .onHover { inside in (inside ? NSCursor.openHand : NSCursor.arrow).set() }
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .global)
                    .onChanged { g in
                        if dragStart == nil { dragStart = place; NSCursor.closedHand.set() }
                        let s = dragStart ?? place
                        // No animation while dragging: the notch follows the pointer exactly.
                        var t = Transaction(); t.disablesAnimations = true
                        withTransaction(t) { place = clamp(CGPoint(x: s.x + g.translation.width, y: s.y + g.translation.height)) }
                    }
                    .onEnded { _ in
                        dragStart = nil
                        NSCursor.openHand.set()
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { place = settled(place) }
                    }
            )
    }

    private var menu: some View {
        VStack(spacing: 8) {
            Text("Drag the notch where you want it").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
            Text(place.y < 1 ? "At the top of the screen" : "\(Int(place.y)) points from the top")
                .font(.system(size: 11)).foregroundStyle(.white.opacity(0.7)).monospacedDigit()
            HStack(spacing: 8) {
                Button("Cancel") { finish(nil) }
                    .keyboardShortcut(.cancelAction)
                Button("Reset to top centre") {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { place = CGPoint(x: screenSize.width / 2, y: 0) }
                }
                Button("Confirm placement") { finish(place) }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent).tint(Theme.accent)
            }
            .controlSize(.large)
        }
        .padding(16)
        .background(.ultraThickMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .environment(\.colorScheme, .dark)
        .opacity(shown ? 1 : 0)
        .animation(.easeOut(duration: 0.2), value: menuY)
    }

    /// The menu sits just under the notch, or above it when the notch is near the bottom.
    private var menuX: CGFloat { min(max(place.x, 220), screenSize.width - 220) }
    private var menuY: CGFloat {
        let below = place.y + notchSize.height + 70
        return below < screenSize.height - 80 ? below : place.y - 70
    }

    private func clamp(_ p: CGPoint) -> CGPoint {
        let half = notchSize.width / 2 + NotchRootView.collapsedShoulder
        return CGPoint(x: min(max(p.x, half), screenSize.width - half),
                       y: min(max(p.y, 0), screenSize.height - 60))
    }

    /// Snaps to the top edge and to the centre line when close to them.
    private func settled(_ p: CGPoint) -> CGPoint {
        var q = p
        if q.y < snap { q.y = 0 }
        if abs(q.x - screenSize.width / 2) < snap { q.x = screenSize.width / 2 }
        return q
    }
}
