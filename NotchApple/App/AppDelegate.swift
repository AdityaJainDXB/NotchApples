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

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var notchController: NotchWindowController?
    private var statusItem: NSStatusItem?
    private var cancellables = Set<AnyCancellable>()

    /// The running delegate (NSApp.delegate is SwiftUI's proxy, not this object).
    private(set) static weak var current: AppDelegate?

    func applicationDidFinishLaunching(_ notification: Notification) {
        AppDelegate.current = self
        SandboxMigration.runIfNeeded()
        notchController = NotchWindowController()
        notchController?.show()

        NowPlayingMonitor.shared.start()
        startMessengerInBackground()
        applyClipboardPreference()
        LiveActivityCenter.shared.start()
        showWelcomeOnFirstLaunch()
        if SettingsManager.shared.windowsEnabled { WindowManager.shared.promptOnceIfNeeded() }
        #if DEBUG
        if ProcessInfo.processInfo.environment["NOTCH_PREVIEW_DROP"] != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { SnapDropController.shared.preview(.topLeft) }
        }
        if ProcessInfo.processInfo.environment["NOTCH_PREVIEW_SETTINGS"] != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { AppDelegate.openSettingsWindow(tab: .windows) }
        }
        #endif

        // Show/hide the status item live as the preference changes.
        applyStatusItemPreference()
        applyHotkeyPreference()
        applyWindowPreferences()
        NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.applyStatusItemPreference()
                self?.applyHotkeyPreference()
                self?.applyClipboardPreference()
                self?.applyWindowPreferences()
            }
            .store(in: &cancellables)

        // Re-anchor when displays are connected, removed or rearranged.
        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .sink { [weak self] _ in self?.notchController?.reposition() }
            .store(in: &cancellables)
    }

    /// Keeps Messenger listening while the notch is closed, so new messages can notify you:
    /// nearby Wi-Fi discovery (if allowed) and the last room you were in.
    private func startMessengerInBackground() {
        MessengerNotifier.shared.start()
        guard SettingsManager.shared.messengerEnabled else { return }
        MessengerNotifier.shared.requestAuthorizationIfNeeded()
        LocalP2PManager.shared.start()
        if let room = UserDefaults.standard.string(forKey: "messenger.activeRoom") {
            WebP2PManager.shared.join(room)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Say goodbye to the room but remember it for next launch.
        WebP2PManager.shared.leave(remember: true)
        LocalP2PManager.shared.stop()
    }

    /// First launch: open Settings on the Permissions pane with a short welcome.
    private func showWelcomeOnFirstLaunch() {
        let key = "onboarding.permissionsShown"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(true, forKey: key)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            AppDelegate.openSettingsWindow(tab: .permissions)
        }
    }

    /// Records the clipboard in the background whenever the Clipboard module is on.
    private func applyClipboardPreference() {
        SettingsManager.shared.clipboardEnabled ? ClipboardHistory.shared.start() : ClipboardHistory.shared.stop()
    }

    /// Registers or removes the global ⌘E shortcut to match the preference.
    private func applyHotkeyPreference() {
        if SettingsManager.shared.globalHotkeyEnabled {
            GlobalHotkeyManager.shared.register(.toggleNotch) { [weak self] in self?.notchController?.toggle() }
        } else {
            GlobalHotkeyManager.shared.unregister(.toggleNotch)
        }
    }

    /// Drag-to-notch snap zones and the ⌃⌥ window shortcuts, when the Windows module is on.
    private func applyWindowPreferences() {
        let settings = SettingsManager.shared
        SnapDropController.shared.setEnabled(settings.windowsEnabled && settings.windowDragToNotch)
        let shortcuts: [GlobalHotkeyManager.Key: SnapLayout?] = [
            .snapLeft: .leftHalf, .snapRight: .rightHalf, .snapTop: .topHalf, .snapBottom: .bottomHalf,
            .snapMaximize: .maximize, .snapCenter: .center, .snapRestore: nil,
        ]
        for (key, layout) in shortcuts {
            if settings.windowsEnabled && settings.windowShortcuts {
                GlobalHotkeyManager.shared.register(key) {
                    if let layout { WindowManager.shared.snapFrontWindow(layout) } else { WindowManager.shared.restoreLast() }
                }
            } else {
                GlobalHotkeyManager.shared.unregister(key)
            }
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

    /// Opens the notch on a given tab (e.g. to continue an AI chat from Settings).
    static func showNotch(tab: Module) {
        // NSApp.delegate is SwiftUI's adaptor proxy, so use our own reference.
        guard let delegate = AppDelegate.current else { return }
        delegate.notchController?.state.selected = tab
        delegate.notchController?.expand()
    }

    /// Opens the Settings window. Agent apps can't rely on the SwiftUI `Settings`
    /// scene, so this goes through our own `SettingsWindowController`.
    static func openSettingsWindow(tab: SettingsTab? = nil) {
        SettingsWindowController.shared.show(tab: tab)
    }
}
