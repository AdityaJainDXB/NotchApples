//
//  AppRelauncher.swift
//  Notch apple
//
//  Quits and reopens Notch apple. Needed after granting Screen Recording,
//  which macOS only applies to an app once it has been relaunched.
//

import AppKit

enum AppRelauncher {
    static func relaunch() {
        let path = Bundle.main.bundleURL.path
        let pid = ProcessInfo.processInfo.processIdentifier
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        // Wait until this process has exited, then open the app again.
        task.arguments = ["-c", "while kill -0 \(pid) 2>/dev/null; do sleep 0.1; done; /usr/bin/open \"$1\"", "sh", path]
        try? task.run()
        NSApp.terminate(nil)
    }
}

/// Screen Recording permission, as used by the AI's screen awareness.
enum ScreenPermission {
    static var isGranted: Bool { CGPreflightScreenCaptureAccess() }

    /// Shows the system prompt the first time (which also adds Notch apple to
    /// the list in System Settings); later calls do nothing visible.
    @discardableResult
    static func request() -> Bool {
        NSApp.activate(ignoringOtherApps: true)
        return CGRequestScreenCaptureAccess()
    }

    static func openSettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
    }
}
