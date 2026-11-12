//
//  ScreenRegionPicker.swift
//  Notch Apple
//
//  The free-form area picker: a dim overlay on every display; drag a rectangle, release to choose, Esc to cancel. It only
//  returns the rectangle and which display it is on: nothing is captured here, and the overlay is gone before anything is
//  (and the capture excludes Notch Apple's own windows anyway). Started only by a button press.
//

import AppKit

@MainActor
final class ScreenRegionPicker {
    struct Selection { let rect: CGRect; let screen: NSScreen }

    private var windows: [NSWindow] = []
    private var completion: ((Selection?) -> Void)?
    private static var active: ScreenRegionPicker?

    /// Shows the overlay. `completion` gets the chosen area (AppKit screen coordinates) or nil when cancelled.
    static func pick(_ completion: @escaping (Selection?) -> Void) {
        guard active == nil else { return }
        let p = ScreenRegionPicker()
        p.completion = completion
        active = p
        p.show()
    }

    private func show() {
        for screen in NSScreen.screens {
            let w = PickerWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false, screen: screen)
            w.level = .screenSaver
            w.isOpaque = false; w.backgroundColor = .clear; w.hasShadow = false
            w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
            let v = PickerView(frame: CGRect(origin: .zero, size: screen.frame.size))
            v.onFinish = { [weak self, weak w] rect in
                guard let self, let w, let screen = w.screen else { return }
                self.finish(rect.map { Selection(rect: $0.offsetBy(dx: screen.frame.minX, dy: screen.frame.minY), screen: screen) })
            }
            w.contentView = v
            w.makeKeyAndOrderFront(nil)
            windows.append(w)
        }
        NSApp.activate(ignoringOtherApps: true)
        NSCursor.crosshair.push()
    }

    private func finish(_ s: Selection?) {
        NSCursor.pop()
        windows.forEach { $0.orderOut(nil) }
        windows.removeAll()
        let done = completion
        completion = nil
        Self.active = nil
        // Let the overlay leave the screen before anything is captured.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { done?(s) }
    }

    private final class PickerWindow: NSWindow {
        override var canBecomeKey: Bool { true }
        override var canBecomeMain: Bool { true }
    }

    private final class PickerView: NSView {
        var onFinish: ((CGRect?) -> Void)?
        private var start: CGPoint?
        private var current: CGPoint?

        override var acceptsFirstResponder: Bool { true }
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
        override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }
        override func viewDidMoveToWindow() { window?.makeFirstResponder(self) }

        override func mouseDown(with event: NSEvent) { start = convert(event.locationInWindow, from: nil); current = start; needsDisplay = true }
        override func mouseDragged(with event: NSEvent) { current = convert(event.locationInWindow, from: nil); needsDisplay = true }
        override func mouseUp(with event: NSEvent) {
            guard let s = start else { return }
            let r = ScreenContextLogic.dragRect(from: s, to: convert(event.locationInWindow, from: nil))
            start = nil; current = nil
            // A click or a sliver is not a choice: keep the overlay up so the user can try again.
            if r.width < ScreenContextLogic.minimumRegion || r.height < ScreenContextLogic.minimumRegion { needsDisplay = true; return }
            onFinish?(r)
        }
        override func keyDown(with event: NSEvent) {
            if event.keyCode == 53 { onFinish?(nil) } else { super.keyDown(with: event) }       // Esc
        }

        override func draw(_ dirtyRect: NSRect) {
            let dim = NSColor.black.withAlphaComponent(0.35)
            dim.setFill()
            let path = NSBezierPath(rect: bounds)
            var hole: CGRect?
            if let s = start, let c = current { hole = ScreenContextLogic.dragRect(from: s, to: c); path.appendRect(hole!); path.windingRule = .evenOdd }
            path.fill()
            if let h = hole {
                NSColor.white.setStroke()
                let b = NSBezierPath(rect: h); b.lineWidth = 1.5; b.stroke()
                let label = "\(Int(h.width)) × \(Int(h.height))" as NSString
                label.draw(at: CGPoint(x: h.minX + 4, y: max(2, h.minY - 18)), withAttributes: [.font: NSFont.systemFont(ofSize: 11, weight: .medium), .foregroundColor: NSColor.white])
            } else {
                let hint = "Drag to choose an area. Esc cancels." as NSString
                let a: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 14, weight: .semibold), .foregroundColor: NSColor.white]
                let size = hint.size(withAttributes: a)
                hint.draw(at: CGPoint(x: bounds.midX - size.width / 2, y: bounds.midY), withAttributes: a)
            }
        }
    }
}

// MARK: - Selected text (Accessibility)

/// The text selected in another app, through Accessibility. Nothing is copied or pasted and no keys are sent: if the app does
/// not expose its selection, there is no selection to read (no clipboard fallback).
enum SelectedTextReader {
    static var trusted: Bool { AXIsProcessTrusted() }

    static func requestTrust() {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    }

    static func read(pid: pid_t) -> String? {
        let app = AXUIElementCreateApplication(pid)
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focused) == .success, let el = focused else { return nil }
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el as! AXUIElement, kAXSelectedTextAttribute as CFString, &value) == .success else { return nil }
        return value as? String
    }
}
