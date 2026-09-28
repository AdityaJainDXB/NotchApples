//
//  SettingsWindowController.swift
//  Notch apple
//
//  Agent apps (LSUIElement = YES) can't reliably open the SwiftUI `Settings`
//  scene: `showSettingsWindow:` is silently dropped because the app never
//  becomes active. Instead we own a plain NSWindow hosting `SettingsView`,
//  activate the app explicitly, and bring the window to the front ourselves.
//

import AppKit
import SwiftUI

final class SettingsWindowController: NSWindowController, NSWindowDelegate {
    static let shared = SettingsWindowController()
    /// The settings window, for views that need it. Deliberately not `shared`:
    /// SwiftUI can run `onAppear` while `shared` is still being initialised,
    /// and touching `shared` then would re-enter its initialiser and crash.
    static weak var currentWindow: NSWindow?

    private init() {
        let hosting = NSHostingController(rootView: SettingsView().environmentObject(SettingsManager.shared))
        let window = NSWindow(contentViewController: hosting)
        window.title = "Notch apple Settings"
        // HIG › Settings: no minimize/zoom for a settings window.
        window.styleMask = [.titled, .closable, .fullSizeContentView]
        window.toolbarStyle = .unified
        window.isReleasedWhenClosed = false
        window.setContentSize(NSSize(width: 720, height: 520))
        window.center()
        super.init(window: window)
        Self.currentWindow = window
        window.delegate = self
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    /// Opens (or re-focuses) the Settings window, optionally on a specific tab.
    func show(tab: SettingsTab? = nil) {
        if let tab {
            // Also persist it, so the pane is right even if the window is being created now.
            UserDefaults.standard.set(tab.rawValue, forKey: "settings.lastPane")
            SettingsTab.selection.send(tab)
        }
        NSApp.activate(ignoringOtherApps: true)
        if window?.isVisible == false { window?.center() }
        window?.level = .floating          // keep above the notch panel's owner app
        window?.makeKeyAndOrderFront(nil)
        window?.orderFrontRegardless()
        DispatchQueue.main.async { self.window?.level = .normal }
    }
}
