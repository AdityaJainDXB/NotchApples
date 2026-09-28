//
//  NotchWindowController.swift
//  Notch apple
//
//  Owns the notch windows and their geometry.
//
//  Two windows, neither of which is ever resized while visible:
//   • `trigger` — a small AppKit window over the notch. It draws the collapsed
//                 notch, shows hover feedback, opens on click, and opens to
//                 the File Shelf when a file is dragged onto it.
//   • `panel`   — the expanded, fixed-size SwiftUI host, ordered in and out.
//
//  Resizing an NSHostingView's window mid-animation can throw AppKit into an
//  "Update Constraints in Window" loop and crash, so the SwiftUI window keeps
//  a constant frame and the open/close effect is animated inside it.
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
        becomesKeyOnlyIfNeeded = false   // take key status on open so typing works immediately
        ignoresMouseEvents = false       // transparent pixels still receive clicks
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
    let expandedSize = CGSize(width: 740, height: 420)

    var toggle: () -> Void = {}
    var close: () -> Void = {}
}

/// Draws the collapsed notch and handles click, hover and drag-over.
///
/// The view is wider and taller than the notch itself so it's easy to hit:
/// Apple's minimum pointer target on macOS is 28 × 28 pt, and the notch's
/// bottom edge is only a few points from where people actually click.
final class NotchTriggerView: NSView {
    /// Extra hit area around the visible notch shape, in points.
    static let hitPadding = NSSize(width: 24, height: 8)

    var onClick: () -> Void = {}
    var onDragEnter: () -> Void = {}
    var onHoverChange: (Bool) -> Void = { _ in }

    private var isHovered = false { didSet { needsDisplay = true } }
    private var tracking: NSTrackingArea?

    override init(frame: NSRect) {
        super.init(frame: frame)
        registerForDraggedTypes([.fileURL])
    }

    required init?(coder: NSCoder) { fatalError() }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                  owner: self, userInfo: nil)
        addTrackingArea(area)
        tracking = area
    }

    override func draw(_ dirtyRect: NSRect) {
        // The visible notch sits in the middle of the padded hit area.
        let pad = Self.hitPadding
        var notch = bounds.insetBy(dx: pad.width - NotchRootView.collapsedShoulder, dy: 0)
        notch.origin.y += pad.height
        notch.size.height -= pad.height
        if isHovered {
            // Hover feedback only — opening still requires a click.
            notch = notch.insetBy(dx: -6, dy: 0)
            notch.origin.y -= 3
            notch.size.height += 3
        }

        let path = Self.notchPath(in: notch, shoulder: NotchRootView.collapsedShoulder, bottom: min(10, notch.height / 2))
        NSColor.black.setFill()
        path.fill()

        if isHovered {
            NSColor(Theme.accent).withAlphaComponent(0.9).setStroke()
            path.lineWidth = 1.5
            path.stroke()
        }
    }

    /// AppKit twin of `NotchShape` (AppKit's y axis points up, so top = maxY).
    static func notchPath(in r: NSRect, shoulder t: CGFloat, bottom b: CGFloat) -> NSBezierPath {
        let k: CGFloat = 0.55
        let p = NSBezierPath()
        p.move(to: NSPoint(x: r.minX, y: r.maxY))
        p.curve(to: NSPoint(x: r.minX + t, y: r.maxY - t),
                controlPoint1: NSPoint(x: r.minX + t * k, y: r.maxY),
                controlPoint2: NSPoint(x: r.minX + t, y: r.maxY - t * (1 - k)))
        p.line(to: NSPoint(x: r.minX + t, y: r.minY + b))
        p.curve(to: NSPoint(x: r.minX + t + b, y: r.minY),
                controlPoint1: NSPoint(x: r.minX + t, y: r.minY + b * (1 - k)),
                controlPoint2: NSPoint(x: r.minX + t + b * (1 - k), y: r.minY))
        p.line(to: NSPoint(x: r.maxX - t - b, y: r.minY))
        p.curve(to: NSPoint(x: r.maxX - t, y: r.minY + b),
                controlPoint1: NSPoint(x: r.maxX - t - b * (1 - k), y: r.minY),
                controlPoint2: NSPoint(x: r.maxX - t, y: r.minY + b * (1 - k)))
        p.line(to: NSPoint(x: r.maxX - t, y: r.maxY - t))
        p.curve(to: NSPoint(x: r.maxX, y: r.maxY),
                controlPoint1: NSPoint(x: r.maxX - t, y: r.maxY - t * (1 - k)),
                controlPoint2: NSPoint(x: r.maxX - t * k, y: r.maxY))
        p.close()
        return p
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { onClick() }
    override func mouseEntered(with event: NSEvent) { isHovered = true; NSCursor.pointingHand.set(); onHoverChange(true) }
    override func mouseExited(with event: NSEvent) { isHovered = false; NSCursor.arrow.set(); onHoverChange(false) }

    // Spring-loading: dragging a file onto the notch opens it on the File Shelf,
    // and the drop itself lands in the shelf's drop zone.
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        onDragEnter()
        return .copy
    }
}

/// Hosts the SwiftUI notch and reports when the pointer enters or leaves it
/// (used only by the optional "open on hover" setting).
final class HoverTrackingView: NSView {
    var onHoverChange: (Bool) -> Void = { _ in }
    private var tracking: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                  owner: self, userInfo: nil)
        addTrackingArea(area)
        tracking = area
    }

    override func mouseEntered(with event: NSEvent) { onHoverChange(true) }
    override func mouseExited(with event: NSEvent) { onHoverChange(false) }
}

final class NotchWindowController {
    private let panel: NotchPanel
    private let trigger: NotchPanel
    private let triggerView = NotchTriggerView()
    let state = NotchState()
    private var outsideClickMonitor: Any?
    private var keyMonitor: Any?
    private var clickInsideMonitor: Any?

    init() {
        panel = NotchPanel(contentRect: .zero)
        let root = NotchRootView()
            .environmentObject(state)
            .environmentObject(SettingsManager.shared)
        let host = NSHostingView(rootView: root)
        host.sizingOptions = []          // the controller owns the frame, not SwiftUI
        host.wantsLayer = true
        host.layer?.backgroundColor = .clear
        let container = HoverTrackingView()
        host.autoresizingMask = [.width, .height]
        container.addSubview(host)
        panel.contentView = container

        trigger = NotchPanel(contentRect: .zero)
        trigger.contentView = triggerView
        // The expanded panel always sits above the trigger (and its hover outline).
        panel.level = .statusBar + 2

        triggerView.onClick = { [weak self] in self?.toggle() }
        triggerView.onDragEnter = { [weak self] in self?.openForDrop() }
        triggerView.onHoverChange = { [weak self] inside in self?.hoverChanged(inside: inside, overPanel: false) }
        container.onHoverChange = { [weak self] inside in self?.hoverChanged(inside: inside, overPanel: true) }
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
        let pad = NotchTriggerView.hitPadding
        let hit = CGSize(width: state.notchSize.width + pad.width * 2, height: state.notchSize.height + pad.height)
        trigger.setFrame(frame(size: hit, on: screen), display: true)
        panel.setFrame(frame(size: state.expandedSize, on: screen), display: false)
    }

    private func frame(size: CGSize, on screen: NSScreen) -> NSRect {
        NSRect(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY - size.height,
               width: size.width, height: size.height)
    }

    func toggle() { state.isExpanded ? collapse() : expand() }

    func expand() {
        guard !state.isExpanded else { return }
        openedByHover = false   // the hover path sets this back to true right after
        pinnedByClick = false
        panel.orderFrontRegardless()
        panel.makeKey()
        // Let the panel present one collapsed frame, then spring open.
        DispatchQueue.main.async { [weak self] in
            withAnimation(Theme.spring) { self?.state.isExpanded = true }
        }
        installMonitors()
    }

    /// Opens straight to the File Shelf while a file is being dragged.
    private func openForDrop() {
        if SettingsManager.shared.shelfEnabled { state.selected = .shelf }
        expand()
    }

    // MARK: Hover to open (optional, off by default)

    /// True when the current open was caused by hovering rather than a click or ⌘E.
    private var openedByHover = false
    /// Set once the user clicks inside a hover-opened notch, so moving out no longer closes it.
    private var pinnedByClick = false
    private var hoverWork: DispatchWorkItem?

    private func hoverChanged(inside: Bool, overPanel: Bool) {
        guard SettingsManager.shared.hoverToOpen else { return }
        hoverWork?.cancel()
        let work: DispatchWorkItem
        if inside {
            // A short delay so just passing the pointer across the menu bar doesn't open it.
            guard !state.isExpanded, !overPanel else { return }
            work = DispatchWorkItem { [weak self] in
                guard let self, !self.state.isExpanded else { return }
                self.expand()
                self.openedByHover = true
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
        } else {
            // Leaving the trigger while the panel is opening lands on the panel, so only the
            // panel's own exit closes it; a small grace period allows brief overshoots.
            guard overPanel, state.isExpanded, openedByHover, !pinnedByClick else { return }
            work = DispatchWorkItem { [weak self] in
                guard let self, self.openedByHover, !self.pinnedByClick else { return }
                self.collapse()
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work)
        }
        hoverWork = work
    }

    func collapse() {
        guard state.isExpanded else { return }
        hoverWork?.cancel()
        openedByHover = false
        pinnedByClick = false
        withAnimation(Theme.spring) { state.isExpanded = false }
        // Re-lock biometric gate every time the notch closes.
        state.isUnlocked = false
        removeMonitors()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self, !self.state.isExpanded else { return }
            self.panel.orderOut(nil)
        }
    }

    /// Click-outside and Escape close the notch. These are click/key handlers
    /// only — never mouse-moved or hover tracking.
    private func installMonitors() {
        outsideClickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            guard let self, !SettingsManager.shared.stickyNotch else { return }
            self.collapse()
        }
        // Esc works even when another app is frontmost (Carbon hot key, active only while open)…
        GlobalHotkeyManager.shared.register(.closeNotch) { [weak self] in self?.collapse() }
        // …and as a local fallback when the panel itself has focus.
        clickInsideMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
            if let self, event.window === self.panel { self.pinnedByClick = true }
            return event
        }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 { self?.collapse(); return nil }
            return event
        }
    }

    private func removeMonitors() {
        if let m = outsideClickMonitor { NSEvent.removeMonitor(m) }
        if let m = keyMonitor { NSEvent.removeMonitor(m) }
        if let m = clickInsideMonitor { NSEvent.removeMonitor(m) }
        clickInsideMonitor = nil
        outsideClickMonitor = nil
        keyMonitor = nil
        GlobalHotkeyManager.shared.unregister(.closeNotch)
    }
}
