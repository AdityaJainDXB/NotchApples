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
        // Resizable so it always fits smaller or scaled laptop screens.
        window.styleMask = [.titled, .closable, .resizable, .fullSizeContentView]
        window.contentMinSize = NSSize(width: 680, height: 440)
        window.toolbarStyle = .unified
        window.isReleasedWhenClosed = false
        super.init(window: window)
        fitToScreen()
        Self.currentWindow = window
        window.delegate = self
        Self.applyAppearance()
    }

    /// Settings → Appearance → Settings window: follow macOS, or always light or dark.
    static func applyAppearance() {
        let mode = UserDefaults.standard.string(forKey: "appearance.settingsWindow") ?? "system"
        currentWindow?.appearance = mode == "light" ? NSAppearance(named: .aqua) : mode == "dark" ? NSAppearance(named: .darkAqua) : nil
    }

    /// Preferred 860 × 560, but never larger than the screen's usable area.
    private func fitToScreen() {
        guard let window else { return }
        let visible = (window.screen ?? NSScreen.main)?.visibleFrame.size ?? NSSize(width: 1440, height: 900)
        let size = NSSize(width: min(860, visible.width - 40), height: min(560, visible.height - 60))
        window.setContentSize(size)
        window.center()
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
        if window?.isVisible == false { fitToScreen() }
        window?.level = .floating          // keep above the notch panel's owner app
        window?.makeKeyAndOrderFront(nil)
        window?.orderFrontRegardless()
        DispatchQueue.main.async { self.window?.level = .normal }
    }
}
