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
    case today, claude, browser, launcher, translator, stats, windows, tools, mirror, worldClock, messenger, clipboard, notes, focus, shelf, share, audio, vpn, nowPlaying, search, timer, snippets, shortcuts, devices, live, f1, alerts, plugins, voiceNotes, screenTime, quickAdd, security

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: "Today"
        case .focus: "Focus"
        case .notes: "Notes"
        case .windows: "Windows"
        case .tools: "Tools"
        case .mirror: "Mirror"
        case .worldClock: "World Clock"
        case .claude: "AI"
        case .messenger: "Messenger"
        case .clipboard: "Clipboard"
        case .shelf: "Shelf"
        case .share: "Share"
        case .audio: "Audio"
        case .vpn: "VPN"
        case .nowPlaying: "Now Playing"
        case .search: "Search"
        case .browser: "Browser"
        case .launcher: "Launcher"
        case .translator: "Translator"
        case .stats: "Mac Stats"
        case .timer: "Timer"
        case .snippets: "Snippets"
        case .shortcuts: "Shortcuts"
        case .devices: "Devices"
        case .live: "Live"
        case .f1: "F1"
        case .alerts: "Notifications"
        case .plugins: "Plugins"
        case .voiceNotes: "Voice Notes"
        case .screenTime: "Screen Time"
        case .quickAdd: "Quick Add"
        case .security: "Biometric Lock"
        }
    }

    var symbol: String {
        switch self {
        case .today: "sun.max.fill"
        case .focus: "timer"
        case .notes: "note.text"
        case .windows: "rectangle.split.2x2.fill"
        case .tools: "wrench.and.screwdriver.fill"
        case .mirror: "person.crop.square"
        case .worldClock: "globe"
        case .claude: "sparkles"
        case .messenger: "bubble.left.and.bubble.right.fill"
        case .clipboard: "doc.on.clipboard.fill"
        case .shelf: "tray.full.fill"
        case .share: "dot.radiowaves.left.and.right"
        case .audio: "speaker.wave.2.fill"
        case .vpn: "lock.shield.fill"
        case .nowPlaying: "music.note"
        case .search: "magnifyingglass"
        case .browser: "globe"
        case .launcher: "square.grid.3x3.fill"
        case .translator: "character.bubble.fill"
        case .stats: "gauge.with.dots.needle.67percent"
        case .timer: "stopwatch.fill"
        case .snippets: "text.badge.plus"
        case .shortcuts: "square.stack.3d.up.fill"
        case .devices: "airpods"
        case .live: "sportscourt.fill"
        case .f1: "flag.checkered"
        case .alerts: "bell.badge.fill"
        case .plugins: "puzzlepiece.extension.fill"
        case .voiceNotes: "waveform.badge.mic"
        case .screenTime: "hourglass"
        case .quickAdd: "calendar.badge.plus"
        case .security: "touchid"
        }
    }

    var blurb: String {
        switch self {
        case .claude: "Chat with AI: free Gemini, Groq, OpenRouter or local Ollama, or paid Claude / ChatGPT. Optionally share your screen."
        case .today: "Weather, your next calendar events and battery at a glance."
        case .mirror: "Add-on: a mirror using your camera, to check how you look before a call. Nothing is recorded."
        case .worldClock: "Add-on: the time in the cities you choose, with day or night and the time difference."
        case .tools: "Keep your Mac awake, pick colours from the screen, and a quick calculator."
        case .windows: "Snap windows into halves, thirds and quarters: drag a window to the notch, use ⌃⌥ shortcuts, or tile everything at once."
        case .notes: "Quick notes in the notch, saved automatically."
        case .focus: "A Pomodoro focus timer with a countdown beside the notch."
        case .clipboard: "Keeps everything you copy, so you can find and copy it again later."
        case .messenger: "Chat anonymously with people on your Wi-Fi, or in an encrypted room joined by code."
        case .shelf: "Drop files and folders into the notch for quick access later."
        case .share: "AirDrop plus PairDrop — local, serverless sharing with a 6-digit code."
        case .audio: "Output device, master volume, and per-app volume / EQ via BackgroundMusic."
        case .vpn: "Manage free OpenVPN / WireGuard / IKEv2 profiles."
        case .nowPlaying: "What's playing on your Mac (Music, Spotify, Anghami, browsers…) with album art, controls and lyrics. The cover shows beside the notch while music plays."
        case .launcher: "Add the apps you use most and open them straight from the notch."
        case .browser: "Browse the web and search from the notch, with a start page, back / forward and your choice of search engine."
        case .search: "Find files, apps and folders instantly with Spotlight, then open, reveal or drag them to the shelf."
        case .translator: "Add-on: translate between Arabic, English, French, Spanish, Hindi, Mandarin and German, with pronunciation you can read and hear. Sends the text you type to a free translation service."
        case .stats: "Add-on: live RAM, CPU, network speed, battery and disk space. The MacBook Center widget shows the same in Notification Center."
        case .timer: "Add-on: a countdown timer and stopwatch with laps. The time left shows beside the closed notch."
        case .snippets: "Add-on: saved bits of text you paste into any app with one click."
        case .shortcuts: "Add-on: run your Apple Shortcuts and switch Focus modes from the notch. Shortcuts can also control the notch with notchapple:// links."
        case .devices: "Add-on: battery for AirPods, Magic Mouse, keyboard and trackpad, what's using your mic or camera (with a mic mute), and Find My iPhone."
        case .f1: "Add-on: Formula 1 live timing (order, gaps, tyres, laps, flags), the weekend schedule with a countdown, and standings. Follow a driver to see their position beside the notch."
        case .live: "Add-on: live scores for the teams you follow, plus quick tracking for parcels and flights."
        case .alerts: "Add-on: see notifications from other apps in the notch, and reply to iMessages. Needs Full Disk Access."
        case .plugins: "Add-on: your own widgets. Any script in the Plugins folder shows its output in the notch."
        case .voiceNotes: "Pro: record a voice note from the notch. It's transcribed on your Mac, and one click turns it into an AI summary with action items."
        case .screenTime: "Pro: see how long you spend in each app, set daily limits, and block distracting apps during Focus sessions. Stays on your Mac."
        case .quickAdd: "Pro: type “Dentist tomorrow 3pm” or “remind me to pay rent on the 1st” and it goes straight into Calendar or Reminders."
        case .security: "Require Touch ID / Apple Watch / password to open the notch."
        }
    }

    /// Modules that render as a tab in the notch (security is a gate, not a tab).
    var isTab: Bool { self != .security }

    /// The UserDefaults key backing this module's toggle.
    var storageKey: String { self == .translator ? "isTranslatorEnabled" : "module.\(rawValue).enabled" }
}

/// Observable wrapper around module toggles and app-wide preferences.
final class SettingsManager: ObservableObject {
    static let shared = SettingsManager()

    /// Registers first-install defaults. A new install shows only Today and AI; Windows, Tools,
    /// Notes and Focus start off (turn them on in Settings → Modules). People who already
    /// use the app keep the tabs they have: their untouched modules are saved as "on" first.
    static func registerDefaults() {
        let d = UserDefaults.standard
        let alreadyInstalled = d.bool(forKey: "onboarding.permissionsShown")
        // New installs open the notch with ⌃⌥N; people already using ⌘E keep it (and can change it in Settings).
        if alreadyInstalled, d.object(forKey: "hotkey.notch.keyCode") == nil { HotkeyBinding.save(.legacyNotch, for: .notch) }
        let offByDefault: [Module] = [.windows, .tools, .notes, .focus, .browser, .launcher]
        if alreadyInstalled {
            for m in offByDefault where d.object(forKey: m.storageKey) == nil { d.set(true, forKey: m.storageKey) }
        }
        var defaults: [String: Any] = [Module.today.storageKey: true, Module.claude.storageKey: true]
        offByDefault.forEach { defaults[$0.storageKey] = false }
        // 1.14 add-ons start off for everyone, new and existing installs.
        [Module.timer, .snippets, .shortcuts, .devices, .live, .f1, .alerts, .plugins, .voiceNotes, .screenTime, .quickAdd].forEach { defaults[$0.storageKey] = false }
        d.register(defaults: defaults)
    }

    @AppStorage(Module.claude.storageKey) var claudeEnabled = true
    @AppStorage(Module.messenger.storageKey) var messengerEnabled = true
    @AppStorage(Module.today.storageKey) var todayEnabled = true
    @AppStorage(Module.focus.storageKey) var focusEnabled = false
    @AppStorage(Module.notes.storageKey) var notesEnabled = false
    @AppStorage(Module.windows.storageKey) var windowsEnabled = false
    @AppStorage(Module.tools.storageKey) var toolsEnabled = false
    /// Add-ons are off until you add them in Settings → Modules.
    @AppStorage(Module.mirror.storageKey) var mirrorEnabled = false
    @AppStorage(Module.worldClock.storageKey) var worldClockEnabled = false
    /// Show snap zones when a window is dragged up to the notch.
    @AppStorage("windows.dragToNotch") var windowDragToNotch = true
    /// ⌃⌥ + arrows / Return / C / Delete snap the front window.
    @AppStorage("windows.shortcuts") var windowShortcuts = true
    /// Space between snapped windows, in points.
    @AppStorage("windows.gap") var windowGap = 8.0
    /// Briefly show battery level beside the notch when the charger is plugged in or out.
    @AppStorage("ui.chargingActivity") var showChargingActivity = true
    @AppStorage(Module.clipboard.storageKey) var clipboardEnabled = true
    @AppStorage(Module.shelf.storageKey) var shelfEnabled = true
    @AppStorage(Module.share.storageKey) var shareEnabled = true
    @AppStorage(Module.audio.storageKey) var audioEnabled = true
    @AppStorage(Module.vpn.storageKey) var vpnEnabled = false
    @AppStorage(Module.nowPlaying.storageKey) var nowPlayingEnabled = true
    @AppStorage(Module.search.storageKey) var searchEnabled = true
    @AppStorage(Module.browser.storageKey) var browserEnabled = false
    @AppStorage(Module.launcher.storageKey) var launcherEnabled = false
    /// Add-ons: off until you add them in Settings → Modules.
    @AppStorage(Module.translator.storageKey) var translatorEnabled = false
    @AppStorage(Module.stats.storageKey) var statsEnabled = false
    @AppStorage(Module.security.storageKey) var securityEnabled = false
    @AppStorage(Module.timer.storageKey) var timerEnabled = false
    @AppStorage(Module.snippets.storageKey) var snippetsEnabled = false
    @AppStorage(Module.shortcuts.storageKey) var shortcutsEnabled = false
    @AppStorage(Module.devices.storageKey) var devicesEnabled = false
    @AppStorage(Module.live.storageKey) var liveEnabled = false
    @AppStorage(Module.f1.storageKey) var f1Enabled = false
    @AppStorage(Module.alerts.storageKey) var alertsEnabled = false
    @AppStorage(Module.plugins.storageKey) var pluginsEnabled = false
    @AppStorage(Module.voiceNotes.storageKey) var voiceNotesEnabled = false
    @AppStorage(Module.screenTime.storageKey) var screenTimeEnabled = false
    @AppStorage(Module.quickAdd.storageKey) var quickAddEnabled = false

    // MARK: Notch extras (Settings → Notch Extras)
    @AppStorage("extras.lowBatteryAlert") var lowBatteryAlert = true
    @AppStorage("extras.accessoryBatteryAlert") var accessoryBatteryAlert = true
    /// Scroll on the closed notch for volume; swipe sideways to change track.
    @AppStorage("extras.gestures") var notchGestures = true
    /// Which display shows the notch: "builtin", "pointer" (follows the mouse) or "main".
    @AppStorage("extras.displayMode") var notchDisplayMode = "builtin"
    @AppStorage("extras.privacyIndicator") var privacyIndicator = true
    @AppStorage("extras.rainAlert") var rainAlert = true
    @AppStorage("extras.meetingAlert") var meetingAlert = true
    @AppStorage("extras.downloadProgress") var downloadProgress = true
    @AppStorage("extras.keepAwakeActivity") var keepAwakeActivity = true
    @AppStorage("extras.trimAfterRecording") var trimAfterRecording = true
    @AppStorage("extras.lyrics") var showLyrics = true
    /// Album cover and moving bars beside the closed notch while music plays.
    @AppStorage("extras.musicActivity") var musicActivity = true
    /// The music bars follow the song (listens to system audio; nothing is recorded).
    @AppStorage("extras.musicBarsFollowAudio") var musicBarsFollowAudio = true
    @AppStorage("alerts.flash") var flashNotifications = true
    /// File Search scope: the whole Mac, or just the home folder (plus Applications).
    @AppStorage("search.wholeMac") var searchWholeMac = false
    @AppStorage("search.apps") var searchApps = true
    @AppStorage("search.documents") var searchDocuments = true
    @AppStorage("search.images") var searchImages = true
    @AppStorage("search.pdfs") var searchPDFs = true
    @AppStorage("search.downloads") var searchDownloads = true

    /// Claude model used for chat. Users pay for their own usage, so let them choose.
    @AppStorage("claude.model") var claudeModel = "claude-sonnet-5"
    /// Briefly show a volume / brightness gauge beside the closed notch when either changes.
    @AppStorage("ui.systemHUD") var showSystemHUD = true
    /// Hide macOS's own volume/brightness pop-ups so only the notch gauge shows (needs Accessibility).
    @AppStorage("ui.replaceSystemHUD") var replaceSystemHUD = true
    /// Show the notch's recording dot while the screen is being recorded.
    @AppStorage("ui.recordingIndicator") var showRecordingIndicator = true
    /// Show the menu-bar status item in addition to the notch hit area.
    @AppStorage("ui.showStatusItem") var showStatusItem = true
    /// Keep the notch open when it loses focus (useful while dragging files in).
    @AppStorage("ui.stickyNotch") var stickyNotch = false
    /// Open the notch when the pointer hovers over it, and close it when the pointer leaves. Off by default.
    @AppStorage("ui.hoverToOpen") var hoverToOpen = false
    /// Toggle the notch from anywhere with a global shortcut (Carbon hot key, no Accessibility permission needed).
    @AppStorage("ui.globalHotkey") var globalHotkeyEnabled = true
    /// Hide or reveal the whole notch from anywhere with ⌘O (changeable in Settings → Shortcuts & Hotkeys).
    @AppStorage("ui.invisibilityHotkey") var invisibilityHotkeyEnabled = true
    /// True while the hide shortcut has made the notch invisible. Not persisted: every launch starts visible.
    @Published var isNotchHidden = false
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
        case .notes: $notesEnabled
        case .windows: $windowsEnabled
        case .tools: $toolsEnabled
        case .mirror: $mirrorEnabled
        case .worldClock: $worldClockEnabled
        case .clipboard: $clipboardEnabled
        case .shelf: $shelfEnabled
        case .share: $shareEnabled
        case .audio: $audioEnabled
        case .vpn: $vpnEnabled
        case .nowPlaying: $nowPlayingEnabled
        case .search: $searchEnabled
        case .browser: $browserEnabled
        case .launcher: $launcherEnabled
        case .translator: $translatorEnabled
        case .stats: $statsEnabled
        case .security: $securityEnabled
        case .timer: $timerEnabled
        case .snippets: $snippetsEnabled
        case .shortcuts: $shortcutsEnabled
        case .devices: $devicesEnabled
        case .live: $liveEnabled
        case .f1: $f1Enabled
        case .alerts: $alertsEnabled
        case .plugins: $pluginsEnabled
        case .voiceNotes: $voiceNotesEnabled
        case .screenTime: $screenTimeEnabled
        case .quickAdd: $quickAddEnabled
        }
    }

    /// Tabs to show in the notch, in display order.
    var enabledTabs: [Module] {
        orderedTabs.filter { isEnabled($0) }
    }

    /// The user's tab order (Settings → Appearance), as comma-separated raw values.
    @AppStorage("ui.tabOrder") var tabOrderData = ""

    /// Every tab module, in the user's order; new modules go at the end.
    var orderedTabs: [Module] {
        let saved = tabOrderData.split(separator: ",").compactMap { Module(rawValue: String($0)) }.filter(\.isTab)
        return saved + Module.allCases.filter { $0.isTab && !saved.contains($0) }
    }

    func setTabOrder(_ tabs: [Module]) {
        objectWillChange.send()
        tabOrderData = tabs.map(\.rawValue).joined(separator: ",")
    }

    func resetTabOrder() {
        objectWillChange.send()
        tabOrderData = ""
    }
}
