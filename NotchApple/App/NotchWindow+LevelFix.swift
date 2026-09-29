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
        level = NSWindow.Level(rawValue: Self.notchLevel.rawValue + extraLevels)
        collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        hidesOnDeactivate = false
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
            (workspace, NSWorkspace.didWakeNotification),
            (workspace, NSWorkspace.screensDidWakeNotification),
            (.default, NSApplication.didChangeScreenParametersNotification),
        ]
        return names.map { center, name in
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.reassertWindowLevels() }
            }
        }
    }
}
