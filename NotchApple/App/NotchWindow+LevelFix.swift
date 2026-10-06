//
//  NotchWindow+LevelFix.swift
//  Notch apple
//
//  Keeps the notch windows above everything, on every Space and over
//  full-screen apps. The panels are created with the right level and
//  collection behaviour, but macOS can quietly drop a window's ordering when
//  the Space changes, the Mac wakes from sleep, or displays are rearranged.
//  `keepAboveEverything` re-applies the settings and brings the window back to
//  the front, and `NotchWindowController` calls it after each of those events.
//

import AppKit

extension NSPanel {
    /// Level just above the menu bar, so the notch sits "in" the hardware notch.
    static let notchLevel = NSWindow.Level.statusBar + 1

    /// Re-applies level, Space behaviour and ordering. Safe to call at any time.
    func keepAboveEverything(extraLevels: Int = 0, orderFront: Bool = true) {
        // The vetted pattern for a menu-bar-style overlay: on every Space (including full-screen ones), as an
        // auxiliary window beside full-screen apps, never part of Exposé or ⌘-Tab, and never hidden when the app is.
        collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        hidesOnDeactivate = false
        canHide = false
        // NOTE: do not set `isFloatingPanel` here. It looks harmless, but it resets `level` to the ordinary
        // floating level, which is BELOW the menu bar, and macOS then pushes the notch down under the bar
        // (this was the bug in 1.30.0 and 1.30.1). The level is set last so nothing can undo it.
        //
        // "Keep the notch visible in full-screen apps" raises the window to screen-saver level, which
        // sits above full-screen Spaces and their menu bar, so it isn't hidden by the Space change.
        level = NotchPrefs.keepInFullscreen
            ? NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue + extraLevels)
            : NSWindow.Level(rawValue: Self.notchLevel.rawValue + extraLevels)
        if orderFront { orderFrontRegardless() }
    }
}

@MainActor
extension NotchWindowController {
    /// Watches for the events that can lose window ordering and re-asserts the level after each.
    func observeWindowLevelEvents() -> [NSObjectProtocol] {
        let workspace = NSWorkspace.shared.notificationCenter
        let names: [(NotificationCenter, Notification.Name)] = [
            (workspace, NSWorkspace.activeSpaceDidChangeNotification),
            // Switching to or from a full-screen app (it becomes the active app as its Space slides in).
            (workspace, NSWorkspace.didActivateApplicationNotification),
            (workspace, NSWorkspace.didWakeNotification),
            (workspace, NSWorkspace.screensDidWakeNotification),
            (.default, NSApplication.didChangeScreenParametersNotification),
        ]
        return names.map { center, name in
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.reassertWindowLevels() }
                // A full-screen transition takes about a second, and macOS can reorder windows at its end,
                // so put the notch back on top again once it has settled (notch-less Macs showed the gap most).
                for delay in [0.35, 0.9, 1.6] {
                    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { MainActor.assumeIsolated { self?.reassertWindowLevels() } }
                }
            }
        }
    }
}
