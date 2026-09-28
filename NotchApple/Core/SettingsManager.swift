//
//  SettingsManager.swift
//  Notch apple
//
//  Central source of truth for which modules are enabled. Every feature in the
//  app is optional: the notch UI reads `enabledModules` and only renders tabs
//  for modules the user switched on. Values persist via `@AppStorage`
//  (UserDefaults), so SwiftUI views update live when a toggle flips.
//

import SwiftUI

/// Every optional feature module in the app.
enum Module: String, CaseIterable, Identifiable {
    case today, claude, messenger, clipboard, focus, shelf, share, audio, vpn, nowPlaying, security

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: "Today"
        case .focus: "Focus"
        case .claude: "AI"
        case .messenger: "Messenger"
        case .clipboard: "Clipboard"
        case .shelf: "Shelf"
        case .share: "Share"
        case .audio: "Audio"
        case .vpn: "VPN"
        case .nowPlaying: "Now Playing"
        case .security: "Biometric Lock"
        }
    }

    var symbol: String {
        switch self {
        case .today: "sun.max.fill"
        case .focus: "timer"
        case .claude: "sparkles"
        case .messenger: "bubble.left.and.bubble.right.fill"
        case .clipboard: "doc.on.clipboard.fill"
        case .shelf: "tray.full.fill"
        case .share: "dot.radiowaves.left.and.right"
        case .audio: "speaker.wave.2.fill"
        case .vpn: "lock.shield.fill"
        case .nowPlaying: "music.note"
        case .security: "touchid"
        }
    }

    var blurb: String {
        switch self {
        case .claude: "Chat with AI: free Gemini, Groq, OpenRouter or local Ollama, or paid Claude / ChatGPT. Optionally share your screen."
        case .today: "Weather, your next calendar events and battery at a glance."
        case .focus: "A Pomodoro focus timer with a countdown beside the notch."
        case .clipboard: "Keeps everything you copy, so you can find and copy it again later."
        case .messenger: "Chat anonymously with people on your Wi-Fi, or in an encrypted room joined by code."
        case .shelf: "Drop files and folders into the notch for quick access later."
        case .share: "AirDrop plus PairDrop — local, serverless sharing with a 6-digit code."
        case .audio: "Output device, master volume, and per-app volume / EQ via BackgroundMusic."
        case .vpn: "Manage free OpenVPN / WireGuard / IKEv2 profiles."
        case .nowPlaying: "Show the track playing in Music or Spotify."
        case .security: "Require Touch ID / Apple Watch / password to open the notch."
        }
    }

    /// Modules that render as a tab in the notch (security is a gate, not a tab).
    var isTab: Bool { self != .security }

    /// The UserDefaults key backing this module's toggle.
    var storageKey: String { "module.\(rawValue).enabled" }
}

/// Observable wrapper around module toggles and app-wide preferences.
final class SettingsManager: ObservableObject {
    static let shared = SettingsManager()

    @AppStorage(Module.claude.storageKey) var claudeEnabled = true
    @AppStorage(Module.messenger.storageKey) var messengerEnabled = true
    @AppStorage(Module.today.storageKey) var todayEnabled = true
    @AppStorage(Module.focus.storageKey) var focusEnabled = true
    /// Briefly show battery level beside the notch when the charger is plugged in or out.
    @AppStorage("ui.chargingActivity") var showChargingActivity = true
    @AppStorage(Module.clipboard.storageKey) var clipboardEnabled = true
    @AppStorage(Module.shelf.storageKey) var shelfEnabled = true
    @AppStorage(Module.share.storageKey) var shareEnabled = true
    @AppStorage(Module.audio.storageKey) var audioEnabled = true
    @AppStorage(Module.vpn.storageKey) var vpnEnabled = false
    @AppStorage(Module.nowPlaying.storageKey) var nowPlayingEnabled = true
    @AppStorage(Module.security.storageKey) var securityEnabled = false

    /// Claude model used for chat. Users pay for their own usage, so let them choose.
    @AppStorage("claude.model") var claudeModel = "claude-sonnet-5"
    /// Show the menu-bar status item in addition to the notch hit area.
    @AppStorage("ui.showStatusItem") var showStatusItem = true
    /// Keep the notch open when it loses focus (useful while dragging files in).
    @AppStorage("ui.stickyNotch") var stickyNotch = false
    /// Open the notch when the pointer hovers over it, and close it when the pointer leaves. Off by default.
    @AppStorage("ui.hoverToOpen") var hoverToOpen = false
    /// Toggle the notch from anywhere with ⌘E (Carbon hot key, no Accessibility permission needed).
    @AppStorage("ui.globalHotkey") var globalHotkeyEnabled = true
    /// Offer webcam face unlock (enrolled in Settings → Authentication) on the lock screen.
    @AppStorage("security.faceUnlock") var faceUnlockEnabled = false
    /// Let Messenger find people on the local network (Nearby Wi-Fi mode).
    @AppStorage("messenger.localDiscovery") var messengerLocalDiscovery = true

    func isEnabled(_ module: Module) -> Bool {
        binding(for: module).wrappedValue
    }

    /// A two-way binding for a module toggle, used by the Settings UI.
    func binding(for module: Module) -> Binding<Bool> {
        switch module {
        case .claude: $claudeEnabled
        case .messenger: $messengerEnabled
        case .today: $todayEnabled
        case .focus: $focusEnabled
        case .clipboard: $clipboardEnabled
        case .shelf: $shelfEnabled
        case .share: $shareEnabled
        case .audio: $audioEnabled
        case .vpn: $vpnEnabled
        case .nowPlaying: $nowPlayingEnabled
        case .security: $securityEnabled
        }
    }

    /// Tabs to show in the notch, in display order.
    var enabledTabs: [Module] {
        Module.allCases.filter { $0.isTab && isEnabled($0) }
    }
}
