//
//  MenuBarDimmer.swift
//  Notch Apple
//
//  While the notch is open, the menu bar of the app you are in (File, Edit, View, Go, Window, Help…) is dimmed so the open notch
//  is the thing you look at, and the notch no longer sits on top of the last menu names. Only the menu bar strip is dimmed: your
//  windows and the rest of the screen are untouched, and clicks go straight through to the menu bar underneath. It needs no
//  permission (it is just a see-through black strip drawn over the menu bar). Settings → Notch Extras switches it off.
//

import AppKit

@MainActor
final class MenuBarDimmer {
    static let shared = MenuBarDimmer()
    static let key = "notch.dimMenuBar"
    static var isOn: Bool { UserDefaults.standard.object(forKey: key) as? Bool ?? true }

    /// How dark the menu bar gets: faint enough to still read a name if you look for it.
    private let strength: CGFloat = 0.82
    private var panel: NSPanel?

    /// Fades the strip in over the menu bar of `screen`, just under the notch's own window (`level`). Does nothing when the menu bar
    /// is not showing there (a full-screen app, or "automatically hide the menu bar").
    func show(on screen: NSScreen?, below level: NSWindow.Level) {
        guard Self.isOn, let screen else { hide(); return }
        let height = max(screen.safeAreaInsets.top, screen.frame.maxY - screen.visibleFrame.maxY)
        guard height >= 10 else { hide(); return }
        let frame = NSRect(x: screen.frame.minX, y: screen.frame.maxY - height, width: screen.frame.width, height: height)
        let p = panel ?? makePanel()
        panel = p
        p.setFrame(frame, display: false)
        p.level = NSWindow.Level(rawValue: level.rawValue - 1)
        p.contentView?.frame = NSRect(origin: .zero, size: frame.size)
        if !p.isVisible { p.alphaValue = 0 }
        p.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.22
            p.animator().alphaValue = 1
        }
    }

    func hide() {
        guard let p = panel, p.isVisible else { return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.25
            p.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            MainActor.assumeIsolated {
                // Opened again during the fade: leave it showing.
                if let p = self?.panel, p.alphaValue == 0 { p.orderOut(nil) }
            }
        })
    }

    private func makePanel() -> NSPanel {
        let p = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false
        p.ignoresMouseEvents = true                       // the menu bar underneath keeps working
        p.hidesOnDeactivate = false; p.canHide = false
        p.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        let v = NSView(frame: .zero)
        v.wantsLayer = true
        v.layer?.backgroundColor = NSColor.black.withAlphaComponent(strength).cgColor
        p.contentView = v
        return p
    }
}
