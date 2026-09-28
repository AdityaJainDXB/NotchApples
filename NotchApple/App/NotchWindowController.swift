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
    let expandedSize = CGSize(width: 620, height: 400)

    var toggle: () -> Void = {}
    var close: () -> Void = {}
}

final class NotchWindowController {
    private let panel: NotchPanel
    let state = NotchState()
    private var outsideClickMonitor: Any?
    private var keyMonitor: Any?

    init() {
        panel = NotchPanel(contentRect: .zero)
        let root = NotchRootView()
            .environmentObject(state)
            .environmentObject(SettingsManager.shared)
        let host = NSHostingView(rootView: root)
        host.wantsLayer = true
        host.layer?.backgroundColor = .clear
        panel.contentView = host

        state.toggle = { [weak self] in self?.toggle() }
        state.close = { [weak self] in self?.collapse() }
    }

    func show() {
        reposition()
        panel.orderFrontRegardless()
    }

    /// The screen that owns the notch: the built-in display if present, else main.
    private var targetScreen: NSScreen? {
        NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main
    }

    /// Recomputes the notch size and snaps the panel to it.
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
        panel.setFrame(frame(expanded: state.isExpanded, on: screen), display: true)
    }

    private func frame(expanded: Bool, on screen: NSScreen) -> NSRect {
        let size = expanded ? state.expandedSize : state.notchSize
        return NSRect(x: screen.frame.midX - size.width / 2,
                      y: screen.frame.maxY - size.height,
                      width: size.width, height: size.height)
    }

    func toggle() { state.isExpanded ? collapse() : expand() }

    func expand() {
        guard let screen = targetScreen, !state.isExpanded else { return }
        panel.setFrame(frame(expanded: true, on: screen), display: true)
        panel.makeKey()
        withAnimation(Theme.spring) { state.isExpanded = true }
        installMonitors()
    }

    func collapse() {
        guard state.isExpanded else { return }
        withAnimation(Theme.spring) { state.isExpanded = false }
        // Re-lock biometric gate every time the notch closes.
        state.isUnlocked = false
        removeMonitors()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self, !self.state.isExpanded, let screen = self.targetScreen else { return }
            self.panel.setFrame(self.frame(expanded: false, on: screen), display: true)
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
