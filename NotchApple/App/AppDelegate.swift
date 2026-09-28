//
//  AppDelegate.swift
//  Notch apple
//
//  Boots the two entry points into the UI:
//   1. A transparent, borderless `NotchPanel` pinned over the hardware notch
//      (or the top-center of the menu bar on Macs without one).
//   2. An optional `NSStatusItem` in the menu bar.
//
//  Both open the notch ONLY on an explicit click. There are deliberately no
//  hover/tracking-area triggers anywhere in the app.
//

import AppKit
import SwiftUI
import Combine

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var notchController: NotchWindowController?
    private var statusItem: NSStatusItem?
    private var cancellables = Set<AnyCancellable>()

    func applicationDidFinishLaunching(_ notification: Notification) {
        notchController = NotchWindowController()
        notchController?.show()

        NowPlayingMonitor.shared.start()

        // Show/hide the status item live as the preference changes.
        applyStatusItemPreference()
        applyHotkeyPreference()
        NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.applyStatusItemPreference()
                self?.applyHotkeyPreference()
            }
            .store(in: &cancellables)

        // Re-anchor when displays are connected, removed or rearranged.
        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .sink { [weak self] _ in self?.notchController?.reposition() }
            .store(in: &cancellables)
    }

    /// Registers or removes the global ⌘E shortcut to match the preference.
    private func applyHotkeyPreference() {
        if SettingsManager.shared.globalHotkeyEnabled {
            GlobalHotkeyManager.shared.register { [weak self] in self?.notchController?.toggle() }
        } else {
            GlobalHotkeyManager.shared.unregister()
        }
    }

    private func applyStatusItemPreference() {
        let wanted = SettingsManager.shared.showStatusItem
        if wanted, statusItem == nil {
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
            item.button?.image = NSImage(systemSymbolName: "rectangle.topthird.inset.filled", accessibilityDescription: "Notch apple")
            item.button?.target = self
            item.button?.action = #selector(statusItemClicked(_:))
            item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
            statusItem = item
        } else if !wanted, let item = statusItem {
            NSStatusBar.system.removeStatusItem(item)
            statusItem = nil
        }
    }

    /// Left click toggles the notch; right click shows a small menu.
    @objc private func statusItemClicked(_ sender: NSStatusBarButton) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let menu = NSMenu()
            menu.addItem(withTitle: "Open Notch", action: #selector(toggleNotch), keyEquivalent: "").target = self
            menu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",").target = self
            menu.addItem(.separator())
            menu.addItem(withTitle: "Quit Notch apple", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
            statusItem?.menu = menu
            statusItem?.button?.performClick(nil)
            statusItem?.menu = nil
        } else {
            toggleNotch()
        }
    }

    @objc func toggleNotch() { notchController?.toggle() }

    @objc func openSettings() {
        notchController?.collapse()
        AppDelegate.openSettingsWindow()
    }

    /// Opens the Settings window. Agent apps can't rely on the SwiftUI `Settings`
    /// scene, so this goes through our own `SettingsWindowController`.
    static func openSettingsWindow(tab: SettingsTab? = nil) {
        SettingsWindowController.shared.show(tab: tab)
    }
}
