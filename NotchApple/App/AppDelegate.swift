//
//  AppDelegate.swift
//  Notch Apple
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
        HostedAI.auth = LiveAIAuth()
        PremiumRegistry.load()          // the Ultimate modules, present only in official builds
        SandboxMigration.runIfNeeded()
        notchController = NotchWindowController()
        notchController?.show()
        NotificationCenter.default.addObserver(forName: .notchAIOpen, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.notchController?.openModule(.notchAI) }
        }
        HelloAnimation.start()          // the F1 car says hello (asks your name the first time)
        // Optional feature modules: registered always, started only if the user turned them on.
        ModuleRegistry.shared.register(LidFoldModule.shared)
        if LidFoldModule.shared.enabled { LidFoldModule.shared.start() }
        ModuleRegistry.shared.register(CursorCompanion.shared)
        CursorCompanion.shared.start()   // no-op unless the user turned the green dot on
        AgentHUD.shared.refresh()        // no-op unless the user turned on the agent cards
        CaptionOverlay.shared.start()    // shows words only while NotchAI is speaking
        if UserDefaults.standard.object(forKey: "notchai.voice.hotkey") as? Bool ?? true {
            GlobalHotkeyManager.shared.register(.notchAITalk) { NotchAIVoice.shared.talk() }   // ctrl-option-V: press to talk, press again to send
        }
        #if DEBUG
        // Test hook (DEBUG only): `-notchai.selftest.settings claude` opens that Settings tab at launch.
        if let raw = UserDefaults.standard.string(forKey: "notchai.selftest.settings"), let tab = SettingsTab(rawValue: raw) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { SettingsWindowController.shared.show(tab: tab) }
        }
        // Task hooks (DEBUG only): `-notchai.selftest.research "<url> | <question>"` runs a real research task;
        // `-notchai.selftest.resume YES` resumes every paused task after a simulated restart.
        if let spec = UserDefaults.standard.string(forKey: "notchai.selftest.research") {
            let parts = spec.components(separatedBy: " | ")
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { ResearchAgent.shared.research(question: parts.last ?? "", urlText: parts.first ?? "") }
        }
        if UserDefaults.standard.bool(forKey: "notchai.selftest.resume") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                for t in NotchAITaskStore.shared.tasks where t.state == .paused { NotchAITaskStore.shared.resume(t.id) }
            }
        }
        // More test hooks (DEBUG only): `-notchai.selftest.agents "<request>"` runs a multi-agent request;
        // `-notchai.selftest.workspace YES` opens the workspace window; `-notchai.selftest.overlay YES` draws a sample
        // annotation for a few seconds; `-notchai.selftest.speak "<text>"` speaks a short phrase.
        let d = UserDefaults.standard
        if let req = d.string(forKey: "notchai.selftest.agents") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { if let why = NotchAIOrchestrator.run(request: req) { NSLog("NotchAI selftest: agents not started: %@", why) } }
        }
        // `-notchai.selftest.followup "<question>"` fakes one finished task, asks the question, and logs the reply.
        if let q = d.string(forKey: "notchai.selftest.followup") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                var s = TaskStep(tool: "answer_request", title: "Answer", argument: "x", risk: .readOnly, idempotencyKey: "a")
                s.state = .done; s.result = "Mount Everest is 8,849 m tall. K2 is 8,611 m. Everest is therefore 238 m taller."
                var t = NotchAITask(title: "Compare Everest and K2", agent: "research", steps: [s]); t.state = .completed
                NotchAITaskStore.shared.debugInsert(t)
                NSLog("NotchAI followup: %@", NotchAITaskStore.shared.followUp(t.id, q) ?? "sent")
                Task { @MainActor in
                    while NotchAITaskStore.shared.answering.contains(t.id) { try? await Task.sleep(nanoseconds: 1_000_000_000) }
                    for m in NotchAITaskStore.shared.tasks.first(where: { $0.id == t.id })?.chat ?? [] { NSLog("NotchAI followup %@: %@", m.role.rawValue, m.text) }
                    NSLog("NotchAI followup done")
                }
            }
        }
        if d.bool(forKey: "notchai.selftest.workspace") { DispatchQueue.main.asyncAfter(deadline: .now() + 2) { NotchAIWorkspaceWindow.open() } }
        if d.bool(forKey: "notchai.selftest.overlay") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                let step = TeachingStep(instruction: "Click Save to keep your changes", target: "Save", expected: ["Saved"])
                AnnotationOverlay.shared.show(TeachingLogic.annotations(step: step, number: 2, target: CGRect(x: 0.55, y: 0.45, width: 0.1, height: 0.06)))
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 14) { AnnotationOverlay.shared.hide() }
        }
        if let text = d.string(forKey: "notchai.selftest.speak") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { do { try NotchAIVoice.shared.speakText(text) } catch { NSLog("NotchAI selftest speak failed: %@", error.localizedDescription) } }
        }
        // Snapshot hook (DEBUG only): `-notchai.selftest.snapshot overview|companion|chat` renders that NotchAI section
        // off-screen to /tmp/notchai-snap-<section>.png, so the UI can be checked without touching the desktop.
        if let name = UserDefaults.standard.string(forKey: "notchai.selftest.snapshot"),
           let section = NotchAIView.Section(rawValue: name.prefix(1).uppercased() + name.dropFirst()) {
            Task { @MainActor in
                OllamaDiagnosticsView.debugReport = await OllamaDiagnostics.run(selectedModel: "qwen3:8b", allowCloud: false)
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                NotchAINav.shared.section = section
                let view = NotchAIView().frame(width: 700, height: 420).padding(16)
                    .background(LinearGradient(colors: [Color(red: 0.12, green: 0.05, blue: 0.28), Color(red: 0.07, green: 0.03, blue: 0.16)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .environment(\.colorScheme, .dark)
                // A hidden window, so AppKit-backed controls (picker, scroll view, fields) draw too.
                let host = NSHostingView(rootView: view)
                host.frame = CGRect(x: 0, y: 0, width: 732, height: 452)
                let win = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
                win.contentView = host
                win.setFrameOrigin(CGPoint(x: -4000, y: -4000))   // off every screen, never shown
                host.layoutSubtreeIfNeeded()
                try? await Task.sleep(nanoseconds: 800_000_000)
                host.layoutSubtreeIfNeeded()
                if let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
                    host.cacheDisplay(in: host.bounds, to: rep)
                    if let png = rep.representation(using: .png, properties: [:]) { try? png.write(to: URL(fileURLWithPath: "/tmp/notchai-snap-\(name).png")) }
                }
            }
        }
        #endif

        // Now Playing and Messenger are gated: they start now if a code is saved, or the moment one is entered.
        startGatedServices()
        EmailGateWindow.shared.start()       // a key with no email yet is asked to set one up
        StylePrefs.sync()
        // A Focus left "on" from before a restart must never keep the notch hidden; Shortcuts sets it again.
        FocusBridge.isOn = false
        ThemeManager.shared.revalidate()
        TextExpander.shared.apply()
        Profiles.shared.start()
        CrashReports.shared.checkAtLaunch()
        CompanionServer.shared.apply()
        ClipboardLink.shared.apply()
        WellbeingService.shared.start()
        SystemWatch.shared.start()
        StatusPulse.shared.start()
        PremiumRegistry.claudeStart?()
        WallpaperEngine.shared.apply()      // a live wallpaper you left on starts again
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
                    ClipboardLink.shared.apply()
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
        Task { await Entitlements.shared.checkRevocationIfDue(force: true) }
        // A suspended key is noticed within minutes even if the Mac is never restarted.
        Timer.scheduledTimer(withTimeInterval: 600, repeats: true) { _ in Task { @MainActor in await Entitlements.shared.checkRevocationIfDue() } }
        DemoHooks.run()
        applyMediaKeyPreference()
        // Accessibility: watch quietly (and clear a stale entry once per version); the notch is never blocked by it.
        // the volume gauge and other features don't work.
        RequiredSetup.shared.start()
        // After an update: once, offer the new optional things to switch on.
        ModuleLayout.shared.migrateIfNeeded()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { MainActor.assumeIsolated { TourModel.shared.startIfNeeded() } }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { MainActor.assumeIsolated { PatchLog.shared.showAfterUpdateIfNeeded() } }
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
        startOpenOnStart()
        if SettingsManager.shared.windowsEnabled { WindowManager.shared.promptOnceIfNeeded() }

        // Show/hide the status item live as the preference changes.
        applyStatusItemPreference()
        applyHotkeyPreference()
        applyWindowPreferences()
        // Every defaults write posts this, and a slider drag writes many times a second. The first change applies at once,
        // the rest collapse to the latest within 150 ms, so the eight apply calls below run a handful of times a second at most.
        NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)
            .throttle(for: .milliseconds(150), scheduler: RunLoop.main, latest: true)
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

        // The menu-bar icon hides and reappears with the notch (⌃⌥O).
        SettingsManager.shared.$isNotchHidden
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.applyStatusItemPreference() }
            .store(in: &cancellables)

        // Global shortcuts are re-registered after sleep or a fast-user-switch, so they keep working in every app.
        for name in [NSWorkspace.didWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
            NSWorkspace.shared.notificationCenter.publisher(for: name)
                .sink { _ in
                    GlobalHotkeyManager.shared.reregisterAll()
                    Task { @MainActor in HelloAnimation.show() }
                    Task { @MainActor in await Entitlements.shared.checkRevocationIfDue(force: true) }
                }
                .store(in: &cancellables)
        }

        // Swiping to another desktop (Space) closes the notch, which would otherwise stay open on the old one.
        NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.activeSpaceDidChangeNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                guard !SettingsManager.shared.stickyNotch else { return }
                self?.notchController?.collapse()
            }
            .store(in: &cancellables)

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
        FriendsClient.shared.startIfActive()
        LiveActivityCenter.shared.providers.append { RemoteViewHub.shared.liveActivity }
        RemoteViewHub.shared.watchSystem()
        GlobalHotkeyManager.shared.register(.stopRemote) { RemoteViewHub.shared.stopAll("Stopped from the Mac keyboard.") }
        guard SettingsManager.shared.messengerEnabled else { return }
        MessengerNotifier.shared.requestAuthorizationIfNeeded()
        // Nearby Wi-Fi discovery keeps the radio busy, so it starts only while the Messenger tab is open (NotchMessengerView).
        if let room = UserDefaults.standard.string(forKey: "messenger.activeRoom") {
            WebP2PManager.shared.join(room)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        BrightnessBlackout.shared.restore()   // never leave the screen dark behind
        ClosedLidAwake.shared.restoreOnQuit()   // let the Mac sleep again
        NowPlayingMonitor.shared.shutdown()   // do not leave the now-playing helper running
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

    /// Opens the notch once when the app starts (after login) and once each time the Mac wakes from sleep. It waits for the first-run
    /// welcome (which has its own window) and does nothing while the notch is hidden, suppressed for a full-screen app, or turned off.
    private func startOpenOnStart() {
        func openOnce(after delay: TimeInterval) {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                guard SettingsManager.shared.openOnStart, !SettingsManager.shared.isNotchHidden,
                      UserDefaults.standard.bool(forKey: "onboarding.permissionsShown") else { return }
                AppDelegate.current?.notchController?.expand()
            }
        }
        openOnce(after: 1.6)
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in openOnce(after: 2.0) }
    }

    /// Records the clipboard in the background whenever the Clipboard module is on.
    private func applyClipboardPreference() {
        SettingsManager.shared.clipboardEnabled ? ClipboardHistory.shared.start() : ClipboardHistory.shared.stop()
    }

    func reapplyHotkeys() { applyHotkeyPreference() }

    /// Settings → Appearance → Style → Menu bar icon (Pro).
    func refreshStatusIcon() {
        statusItem?.button?.image = NSImage(systemSymbolName: StylePrefs.statusSymbol, accessibilityDescription: "Notch Apple")
    }

    /// Registers or removes the global ⌘E shortcut to match the preference.
    private func applyHotkeyPreference() {
        if SettingsManager.shared.globalHotkeyEnabled {
            GlobalHotkeyManager.shared.register(.toggleNotch) { [weak self] in self?.notchController?.toggle() }
            // ⌃⌥N also opens and closes the notch, unless someone already recorded exactly that as their own notch shortcut.
            let primary = HotkeyBinding.notch
            if primary.keyCode == GlobalHotkeyManager.Key.toggleNotchAlt.keyCode && primary.modifiers == GlobalHotkeyManager.Key.toggleNotchAlt.modifiers {
                GlobalHotkeyManager.shared.unregister(.toggleNotchAlt)
            } else {
                GlobalHotkeyManager.shared.register(.toggleNotchAlt) { [weak self] in self?.notchController?.toggle() }
            }
        } else {
            GlobalHotkeyManager.shared.unregister(.toggleNotch)
            GlobalHotkeyManager.shared.unregister(.toggleNotchAlt)
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
        // Quick capture (⌃⌥J): a new note, ready to type in, from any app.
        if UserDefaults.standard.object(forKey: "ui.quickCaptureHotkey") as? Bool ?? true {
            GlobalHotkeyManager.shared.register(.quickCapture) {
                UserDefaults.standard.set("notes", forKey: "notes.page")
                _ = NotesStore.shared.add()
                AppDelegate.showNotch(tab: .notes)
            }
        } else { GlobalHotkeyManager.shared.unregister(.quickCapture) }
        if PanicHide.hotkeyEnabled { GlobalHotkeyManager.shared.register(.panic) { PanicHide.run() } } else { GlobalHotkeyManager.shared.unregister(.panic) }
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

    /// ⌃⌥O: hide or reveal the notch and its menu-bar icon.
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
            item.button?.image = NSImage(systemSymbolName: StylePrefs.statusSymbol, accessibilityDescription: "Notch Apple")
            item.button?.target = self
            item.button?.action = #selector(statusItemClicked(_:))
            item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
            statusItem = item
        } else if !wanted, let item = statusItem {
            NSStatusBar.system.removeStatusItem(item)
            statusItem = nil
        }
    }

    @objc private func flightQuickDock() {
        if PlaneGameControl.isRunning { PlaneGameControl.togglePause() } else { PlaneGameControl.launch() }
    }

    /// Left click toggles the notch; right click shows a small menu.
    @objc private func statusItemClicked(_ sender: NSStatusBarButton) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let menu = NSMenu()
            menu.addItem(withTitle: "Open Notch", action: #selector(toggleNotch), keyEquivalent: "").target = self
            // Flight Simulator quick-dock: launches the Plane game, or pauses and resumes it while it is open.
            if SettingsManager.shared.gamesEnabled {
                let flying = PlaneGameControl.isRunning
                let dock = NSMenuItem(title: flying ? "Pause or Resume Flight Simulator" : "Launch Flight Simulator",
                                      action: #selector(flightQuickDock), keyEquivalent: "")
                dock.target = self
                dock.image = NSImage(systemSymbolName: flying ? "pause.circle.fill" : "airplane", accessibilityDescription: nil)?
                    .withSymbolConfiguration(.init(paletteColors: [.systemTeal]))
                menu.addItem(dock)
            }
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
            item("Quit Notch Apple", "xmark.circle.fill", .systemRed, #selector(quitApp), "q")
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
        let want = s.showSystemHUD && s.replaceSystemHUD
        mediaKeyRetry?.invalidate(); mediaKeyRetry = nil
        MediaKeyInterceptor.shared.setEnabled(want)
        if wasRunning != MediaKeyInterceptor.shared.isRunning { SystemHUDObserver.shared.retuneBrightnessPolling() }
        // Without Accessibility the keys cannot be caught and macOS shows its own volume and brightness bars. A new version of the app
        // is a new signature to macOS, which can drop the permission until it is switched off and on again, so this keeps checking
        // (every 10 s) and takes the keys back as soon as it is allowed, with no restart.
        if want, !MediaKeyInterceptor.shared.isRunning {
            mediaKeyRetry = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] t in
                let s = SettingsManager.shared
                guard s.showSystemHUD && s.replaceSystemHUD else { t.invalidate(); self?.mediaKeyRetry = nil; return }
                if MediaKeyInterceptor.shared.setEnabled(true) { t.invalidate(); self?.mediaKeyRetry = nil; SystemHUDObserver.shared.retuneBrightnessPolling() }
            }
            mediaKeyRetry?.tolerance = 5
        }
        applyBrightnessBlackoutPreference()
    }
    private var mediaKeyRetry: Timer?

    /// ⌥A toggles the screen to zero brightness and back. On for everyone (switched on once for anyone who had it off);
    /// without Accessibility it can't start yet, so it checks again every few seconds and starts once it is allowed.
    func applyBrightnessBlackoutPreference() {
        let d = UserDefaults.standard
        if !d.bool(forKey: "ui.brightnessBlackout.autoEnabled") {
            d.set(true, forKey: "ui.brightnessBlackout.autoEnabled")
            SettingsManager.shared.brightnessBlackout = true
        }
        blackoutRetry?.invalidate(); blackoutRetry = nil
        let on = SettingsManager.shared.brightnessBlackout
        if BrightnessBlackout.shared.setEnabled(on) || !on { return }
        blackoutRetry = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] t in
            guard SettingsManager.shared.brightnessBlackout else { t.invalidate(); return }
            if BrightnessBlackout.shared.setEnabled(true) { t.invalidate(); self?.blackoutRetry = nil }
        }
    }
    private var blackoutRetry: Timer?

    @objc func relaunchApp() { AppRelauncher.relaunch() }
    @objc func quitApp() { NSApp.terminate(nil) }

    /// Opens the notch (used to show the patch log).
    func openNotch() { notchController?.expand() }

    @objc func toggleNotch() { notchController?.toggle() }

    @objc func openSettings() {
        notchController?.collapse(force: true)
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
        // Clicks in our own Settings window never reach the notch's click-outside monitor, so close it here.
        AppDelegate.current?.notchController?.collapse(force: true)
        SettingsWindowController.shared.show(tab: tab)
    }
}
