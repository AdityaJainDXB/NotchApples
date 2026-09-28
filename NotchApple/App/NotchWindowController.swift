//
//  NotchWindowController.swift
//  Notch apple
//
//  Owns the floating `NotchPanel` and its geometry.
//
//  Geometry strategy: while collapsed, the panel is exactly the size of the
//  notch so it only intercepts clicks on the notch itself and never blocks the
//  menu bar. When clicked, the panel grows to the expanded size first, then the
//  SwiftUI content springs open inside it. On close the content animates shut
//  and the panel shrinks back afterwards.
//

import AppKit
import SwiftUI

/// Borderless, transparent, non-activating panel that can still take keyboard
/// focus (needed for the Claude chat text field).
final class NotchPanel: NSPanel {
    init(contentRect: NSRect) {
        super.init(contentRect: contentRect,
                   styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
                   backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .statusBar + 1           // above the menu bar so it sits "in" the notch
        collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        isMovable = false
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// Shared UI state for the notch.
final class NotchState: ObservableObject {
    @Published var isExpanded = false
    @Published var isUnlocked = false
    @Published var selected: Module = .claude
    /// Size of the physical notch (or a synthetic pill on notch-less Macs).
    @Published var notchSize = CGSize(width: 200, height: 32)
    /// Size of the fully expanded panel.
    let expandedSize = CGSize(width: 720, height: 400)

    var toggle: () -> Void = {}
    var close: () -> Void = {}
}

/// A tiny, fixed-size window sitting exactly over the notch. It draws the
/// collapsed notch and turns a click into `onClick`. Being plain AppKit (no
/// SwiftUI host), it can be repositioned freely without layout side effects.
final class NotchTriggerView: NSView {
    var onClick: () -> Void = {}

    override func draw(_ dirtyRect: NSRect) {
        // Black notch silhouette; invisible on a real notch, a pill elsewhere.
        let r = min(10, bounds.height / 2)
        let path = NSBezierPath()
        path.move(to: NSPoint(x: bounds.minX, y: bounds.maxY))
        path.line(to: NSPoint(x: bounds.maxX, y: bounds.maxY))
        path.line(to: NSPoint(x: bounds.maxX, y: bounds.minY + r))
        path.curve(to: NSPoint(x: bounds.maxX - r, y: bounds.minY),
                   controlPoint1: NSPoint(x: bounds.maxX, y: bounds.minY), controlPoint2: NSPoint(x: bounds.maxX, y: bounds.minY))
        path.line(to: NSPoint(x: bounds.minX + r, y: bounds.minY))
        path.curve(to: NSPoint(x: bounds.minX, y: bounds.minY + r),
                   controlPoint1: NSPoint(x: bounds.minX, y: bounds.minY), controlPoint2: NSPoint(x: bounds.minX, y: bounds.minY))
        path.close()
        NSColor.black.setFill()
        path.fill()
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { onClick() }
}

/// Owns the notch windows.
///
/// Two windows, neither of which is ever resized while visible:
///  • `trigger` — notch-sized, always on screen, catches the click that opens.
///  • `panel`   — expanded-sized SwiftUI host, ordered in/out on toggle.
///
/// Resizing an NSHostingView's window mid-animation can throw AppKit into an
/// "Update Constraints in Window" loop and crash, so the SwiftUI window keeps
/// a constant frame and the open/close effect is animated inside it.
final class NotchWindowController {
    private let panel: NotchPanel
    private let trigger: NotchPanel
    private let triggerView = NotchTriggerView()
    let state = NotchState()
    private var outsideClickMonitor: Any?
    private var keyMonitor: Any?

    init() {
        panel = NotchPanel(contentRect: .zero)
        let root = NotchRootView()
            .environmentObject(state)
            .environmentObject(SettingsManager.shared)
        let host = NSHostingView(rootView: root)
        host.sizingOptions = []          // the controller owns the frame, not SwiftUI
        host.wantsLayer = true
        host.layer?.backgroundColor = .clear
        panel.contentView = host

        trigger = NotchPanel(contentRect: .zero)
        trigger.contentView = triggerView

        triggerView.onClick = { [weak self] in self?.toggle() }
        state.toggle = { [weak self] in self?.toggle() }
        state.close = { [weak self] in self?.collapse() }
    }

    func show() {
        reposition()
        trigger.orderFrontRegardless()
    }

    /// The screen that owns the notch: the built-in display if present, else main.
    private var targetScreen: NSScreen? {
        NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main
    }

    /// Recomputes the notch size and positions both windows.
    func reposition() {
        guard let screen = targetScreen else { return }
        if screen.safeAreaInsets.top > 0,
           let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            // Real notch: the gap between the two auxiliary menu-bar areas.
            state.notchSize = CGSize(width: screen.frame.width - left.width - right.width,
                                     height: screen.safeAreaInsets.top)
        } else {
            // No notch: a slim pill centred in the menu bar.
            let barHeight = screen.frame.maxY - screen.visibleFrame.maxY
            state.notchSize = CGSize(width: 190, height: max(barHeight, 24))
        }
        trigger.setFrame(frame(size: state.notchSize, on: screen), display: true)
        panel.setFrame(frame(size: state.expandedSize, on: screen), display: false)
    }

    private func frame(size: CGSize, on screen: NSScreen) -> NSRect {
        NSRect(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY - size.height,
               width: size.width, height: size.height)
    }

    func toggle() { state.isExpanded ? collapse() : expand() }

    func expand() {
        guard !state.isExpanded else { return }
        panel.orderFrontRegardless()
        panel.makeKey()
        // Let the panel present one collapsed frame, then spring open.
        DispatchQueue.main.async { [weak self] in
            withAnimation(Theme.spring) { self?.state.isExpanded = true }
        }
        installMonitors()
    }

    func collapse() {
        guard state.isExpanded else { return }
        withAnimation(Theme.spring) { state.isExpanded = false }
        // Re-lock biometric gate every time the notch closes.
        state.isUnlocked = false
        removeMonitors()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self, !self.state.isExpanded else { return }
            self.panel.orderOut(nil)
        }
    }

    /// Click-outside and Escape close the notch. These are click/key monitors only —
    /// never mouse-moved or hover tracking.
    private func installMonitors() {
        outsideClickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            guard let self, !SettingsManager.shared.stickyNotch else { return }
            self.collapse()
        }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 { self?.collapse(); return nil } // Esc
            return event
        }
    }

    private func removeMonitors() {
        if let m = outsideClickMonitor { NSEvent.removeMonitor(m) }
        if let m = keyMonitor { NSEvent.removeMonitor(m) }
        outsideClickMonitor = nil
        keyMonitor = nil
    }
}
