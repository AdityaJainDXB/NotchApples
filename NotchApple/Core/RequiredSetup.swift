//
//  RequiredSetup.swift
//  Notch apple
//
//  The one permission Notch apple needs to do its job: Accessibility. It is what lets the notch show the volume and
//  brightness gauge when you press the keys (and keep macOS's own pop-up from stacking on top), snap windows,
//  paste snippets and read selected text. Until it's on, the open notch shows a setup screen instead of its tabs.
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

    /// Called at launch: asks macOS to show its own prompt (which also lists Notch apple), then watches until it's granted.
    func start() {
        refresh()
        guard !isComplete else { return }
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
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
        } else {
            start()    // switched off again: ask and watch again
        }
    }

    func openSettings() {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") { NSWorkspace.shared.open(url) }
    }
}
