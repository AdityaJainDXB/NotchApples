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

        // Now Playing and Messenger are gated: they start now if a code is saved, or the moment one is entered.
        startGatedServices()
        StylePrefs.sync()
        // A Focus left "on" from before a restart must never keep the notch hidden; Shortcuts sets it again.
        FocusBridge.isOn = false
        ThemeManager.shared.revalidate()
        TextExpander.shared.apply()
        Profiles.shared.start()
        CrashReports.shared.checkAtLaunch()
        CompanionServer.shared.apply()
        NotesCloudSync.shared.syncNow()
        // Ultimate: plugins keep running in the background for Home widgets and activities.
        if PluginHost.shared.keepRunning { PluginHost.shared.start() }
        Entitlements.shared.$tier
            .dropFirst().removeDuplicates()
            .sink { [weak self] _ in
                self?.startGatedServices()
                // Pro themes, sizes, edge zones and per-display tabs follow the tier.
                DispatchQueue.main.async {
                    StylePrefs.sync()
                    ThemeManager.shared.revalidate()
                    Profiles.shared.evaluate()
                    CompanionServer.shared.apply()
                    self?.refreshStatusIcon()
                    TextExpander.shared.apply()
                    self?.applyHotkeyPreference()
                    self?.notchController?.applyEdgeTrigger()
                    self?.notchController?.reposition()
                }
            }
            .store(in: &cancellables)
        SystemHUDObserver.shared.start()
        HotCornerManager.shared.apply()
        WhatsNew.noteLaunch()
        Task { await Entitlements.shared.checkRevocationIfDue() }
        DemoHooks.run()
        applyMediaKeyPreference()
        // Accessibility may be granted later; keep trying quietly until the tap is running.
        Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { timer in
            MainActor.assumeIsolated {
                AppDelegate.current?.applyMediaKeyPreference()
                if MediaKeyInterceptor.shared.isRunning { timer.invalidate() }
            }
        }.tolerance = 5
        ScreenRecordingDetector.shared.start()
        applyClipboardPreference()
        LiveActivityCenter.shared.start()
        FeatureHub.start()
        SettingsBackup.shared.startSync()
        AccountSync.shared.start()
        // Now Playing is free: it runs whether or not an access code is entered.
        NowPlayingMonitor.shared.start()
        notchController?.applyDisplayMode()
        UpdateChecker.shared.applyPreference()
        showWelcomeOnFirstLaunch()
        if SettingsManager.shared.windowsEnabled { WindowManager.shared.promptOnceIfNeeded() }

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
                self?.applyMediaKeyPreference()
                self?.applyWindowPreferences()
                self?.applyDisplayModeIfChanged()
                self?.applyProPreferences()
            }
            .store(in: &cancellables)

        // The menu-bar icon hides and reappears with the notch (⌘O).
        SettingsManager.shared.$isNotchHidden
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.applyStatusItemPreference() }
            .store(in: &cancellables)

        // Global shortcuts are re-registered after sleep or a fast-user-switch, so they keep working in every app.
        for name in [NSWorkspace.didWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
            NSWorkspace.shared.notificationCenter.publisher(for: name)
                .sink { _ in GlobalHotkeyManager.shared.reregisterAll() }
                .store(in: &cancellables)
        }

        // Re-anchor when displays are connected, removed or rearranged.
        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .sink { [weak self] _ in self?.notchController?.reposition() }
            .store(in: &cancellables)
    }

    private func startGatedServices() {
        guard Entitlements.shared.tier >= .pro else { return }
        startMessengerInBackground()
        applyProPreferences()
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

    /// First launch: the four-step welcome (permissions, tabs, theme, tour).
    private func showWelcomeOnFirstLaunch() {
        let key = "onboarding.permissionsShown"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(true, forKey: key)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            Onboarding.show()
        }
    }

    /// Records the clipboard in the background whenever the Clipboard module is on.
    private func applyClipboardPreference() {
        SettingsManager.shared.clipboardEnabled ? ClipboardHistory.shared.start() : ClipboardHistory.shared.stop()
    }

    func reapplyHotkeys() { applyHotkeyPreference() }

    /// Settings → Appearance → Style → Menu bar icon (Pro).
    func refreshStatusIcon() {
        statusItem?.button?.image = NSImage(systemSymbolName: StylePrefs.statusSymbol, accessibilityDescription: "Notch apple")
    }

    /// Registers or removes the global ⌘E shortcut to match the preference.
    private func applyHotkeyPreference() {
        if SettingsManager.shared.globalHotkeyEnabled {
            GlobalHotkeyManager.shared.register(.toggleNotch) { [weak self] in self?.notchController?.toggle() }
        } else {
            GlobalHotkeyManager.shared.unregister(.toggleNotch)
        }
        if SettingsManager.shared.captureHotkeyEnabled {
            GlobalHotkeyManager.shared.register(.capture) { CaptureManager.shared.captureToAI() }
        } else {
            GlobalHotkeyManager.shared.unregister(.capture)
        }
        // Command palette (Pro), ⌃⌥P by default.
        if UserDefaults.standard.object(forKey: "ui.paletteHotkey") as? Bool ?? true, Entitlements.shared.canUse(.commandPalette) {
            GlobalHotkeyManager.shared.register(.palette) { CommandPalette.toggle() }
        } else {
            GlobalHotkeyManager.shared.unregister(.palette)
        }
        if SettingsManager.shared.invisibilityHotkeyEnabled {
            GlobalHotkeyManager.shared.register(.toggleInvisible) { [weak self] in self?.toggleInvisible() }
        } else {
            GlobalHotkeyManager.shared.unregister(.toggleInvisible)
            // Turning the shortcut off must not strand the notch hidden.
            notchController?.setInvisible(false)
        }
    }

    var notch: NotchWindowController? { notchController }

    /// Screen Time counts in the background only with an access code and the module on.
    private func applyProPreferences() {
        if Entitlements.shared.canUse(Feature.screenTime) && SettingsManager.shared.screenTimeEnabled { ScreenTimeModel.shared.start() }
        else { ScreenTimeModel.shared.stop() }
    }

    private var lastDisplayMode = SettingsManager.shared.notchDisplayMode

    private func applyDisplayModeIfChanged() {
        let mode = SettingsManager.shared.notchDisplayMode
        guard mode != lastDisplayMode else { return }
        lastDisplayMode = mode
        notchController?.applyDisplayMode()
    }

    /// ⌘O: hide or reveal the notch and its menu-bar icon.
    @objc func toggleInvisible() {
        notchController?.toggleInvisible()
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
        let wanted = SettingsManager.shared.showStatusItem && !SettingsManager.shared.isNotchHidden
        if wanted, statusItem == nil {
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
            item.button?.image = NSImage(systemSymbolName: StylePrefs.statusSymbol, accessibilityDescription: "Notch apple")
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
            // Colour-coded like the notch's power menu: purple settings, orange relaunch, red quit.
            func item(_ title: String, _ symbol: String, _ color: NSColor, _ action: Selector, _ key: String) {
                let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
                i.target = self
                i.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?
                    .withSymbolConfiguration(.init(paletteColors: [color]))
                menu.addItem(i)
            }
            item("Settings…", "gearshape.fill", .systemPurple, #selector(openSettings), ",")
            item("Relaunch", "arrow.clockwise", .systemOrange, #selector(relaunchApp), "")
            menu.addItem(.separator())
            item("Quit Notch apple", "xmark.circle.fill", .systemRed, #selector(quitApp), "q")
            statusItem?.menu = menu
            statusItem?.button?.performClick(nil)
            statusItem?.menu = nil
        } else {
            toggleNotch()
        }
    }

    /// Swallow the volume/brightness keys so only the notch gauge shows.
    func applyMediaKeyPreference() {
        let s = SettingsManager.shared
        let wasRunning = MediaKeyInterceptor.shared.isRunning
        MediaKeyInterceptor.shared.setEnabled(s.showSystemHUD && s.replaceSystemHUD)
        if wasRunning != MediaKeyInterceptor.shared.isRunning { SystemHUDObserver.shared.retuneBrightnessPolling() }
    }

    @objc func relaunchApp() { AppRelauncher.relaunch() }
    @objc func quitApp() { NSApp.terminate(nil) }

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

    /// Starts a fresh copy of the app and quits this one.
    static func relaunch() {
        let config = NSWorkspace.OpenConfiguration()
        config.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: config) { _, _ in
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }

    /// Opens the Settings window. Agent apps can't rely on the SwiftUI `Settings`
    /// scene, so this goes through our own `SettingsWindowController`.
    static func openSettingsWindow(tab: SettingsTab? = nil) {
        SettingsWindowController.shared.show(tab: tab)
    }
}
