//
//  RequiredSetup.swift
//  Notch apple
//
//  The one permission Notch apple needs to do its job: Accessibility. It is what lets the notch show the volume and
//  brightness gauge when you press the keys (and keep macOS's own pop-up from stacking on top), snap windows,
//  paste snippets and read selected text. It never blocks the notch.
//  The moment macOS reports it as granted, the volume and brightness gauge starts, with no relaunch.
//

import AppKit
import ApplicationServices

@MainActor
final class RequiredSetup: ObservableObject {
    static let shared = RequiredSetup()

    @Published private(set) var accessibilityGranted = AXIsProcessTrusted()
    private var timer: Timer?
    private var activeObserver: NSObjectProtocol?

    var isComplete: Bool { accessibilityGranted }

    /// Called at launch: quietly watches until Accessibility is granted (turn it on in Settings → Permissions).
    func start() {
        refresh()
        guard !isComplete else { return }
        clearStaleEntryOncePerBuild()
        if timer == nil {
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.refresh() }
            }
        }
        // Coming back from System Settings is exactly when it changes.
        if activeObserver == nil {
            activeObserver = NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.refresh() }
            }
        }
    }

    func refresh() {
        let now = AXIsProcessTrusted()
        guard now != accessibilityGranted else { return }
        accessibilityGranted = now
        if now {
            timer?.invalidate(); timer = nil
            if let o = activeObserver { NotificationCenter.default.removeObserver(o); activeObserver = nil }
            // Start everything that was waiting for it, right now.
            AppDelegate.current?.applyMediaKeyPreference()
            WindowManager.shared.refreshTrust()
            NewFeaturesWindow.showIfNeeded()
        } else {
            start()    // switched off again: ask and watch again
        }
    }

    /// macOS ties the permission to the exact signature of the build, so after an update the old "on" entry in the list
    /// no longer matches this app. Clearing it (no admin rights needed) lets macOS add a fresh one that does.
    private func clearStaleEntryOncePerBuild() {
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
        let key = "accessibilityResetForBuild"
        guard UserDefaults.standard.string(forKey: key) != build else { return }
        UserDefaults.standard.set(build, forKey: key)
        resetEntry()
    }

    @discardableResult
    private func resetEntry() -> Bool {
        guard let id = Bundle.main.bundleIdentifier else { return false }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/tccutil")
        p.arguments = ["reset", "Accessibility", id]
        p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        do { try p.run(); p.waitUntilExit(); return p.terminationStatus == 0 } catch { return false }
    }

    /// For the "already on but still asking" case: removes the stale entry, then asks again.
    func repair() {
        resetEntry()
        openSettings()
    }

    func openSettings() {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") { NSWorkspace.shared.open(url) }
    }
}
