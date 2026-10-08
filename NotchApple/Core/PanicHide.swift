//
//  PanicHide.swift
//  Notch apple
//
//  One key (⌃⌥⇧P) for "someone just walked up": close the notch, hide it completely, empty the clipboard and, if
//  you like, wipe the clipboard history (pinned items stay). Bring the notch back with the hide shortcut (⌃⌥O).
//  Nothing is sent anywhere.
//

import AppKit

@MainActor
enum PanicHide {
    static let hotkeyKey = "ui.panicHotkey"
    static let wipeKey = "panic.wipeHistory"
    static var hotkeyEnabled: Bool { UserDefaults.standard.object(forKey: hotkeyKey) as? Bool ?? true }
    static var wipesHistory: Bool { UserDefaults.standard.object(forKey: wipeKey) as? Bool ?? true }

    static func run() {
        AppDelegate.current?.notch?.closeNotch()
        AppDelegate.current?.notch?.setInvisible(true)
        ClipboardHistory.shared.panicWipe(history: wipesHistory)
    }
}
