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
    case today, claude, browser, launcher, translator, stats, windows, tools, mirror, worldClock, messenger, clipboard, notes, focus, shelf, share, audio, vpn, nowPlaying, search, timer, snippets, shortcuts, devices, live, f1, tennis, radar, sports, games, alerts, plugins, voiceNotes, screenTime, quickAdd, markets, home, security, cacheCleaner, claudeUsage, smartHome, devTools, wellbeing, nonNecessities, todo, klick, convert

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: "Home"
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
        case .live: "Parcels & Flights"
        case .f1: "F1"
        case .tennis: "Tennis"
        case .radar: "Flight Radar"
        case .klick: "Klick"
        case .convert: "Convert"
        case .games: "Games"
        case .sports: "Sports"
        case .alerts: "Notifications"
        case .plugins: "Plugins"
        case .voiceNotes: "Voice Notes"
        case .screenTime: "Screen Time"
        case .quickAdd: "Quick Add"
        case .markets: "Markets"
        case .home: "Dashboard"
        case .security: "Biometric Lock"
        case .cacheCleaner: "Purge"
        case .claudeUsage: "Claude Usage"
        case .smartHome: "Smart Home"
        case .devTools: "Dev Tools"
        case .wellbeing: "Wellbeing"
        case .nonNecessities: "Non-Necessities"
        case .todo: "To-Do"
        }
    }

    var symbol: String {
        switch self {
        case .today: "house.fill"
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
        case .live: "shippingbox.fill"
        case .f1: "flag.checkered"
        case .tennis: "tennisball.fill"
        case .radar: "airplane"
        case .klick: "keyboard.fill"
        case .convert: "arrow.triangle.2.circlepath"
        case .games: "gamecontroller.fill"
        case .sports: "sportscourt"
        case .alerts: "bell.badge.fill"
        case .plugins: "puzzlepiece.extension.fill"
        case .voiceNotes: "waveform.badge.mic"
        case .screenTime: "hourglass"
        case .quickAdd: "calendar.badge.plus"
        case .markets: "chart.line.uptrend.xyaxis"
        case .home: "square.grid.2x2"
        case .security: "touchid"
        case .cacheCleaner: "internaldrive.fill"
        case .claudeUsage: "gauge.with.dots.needle.50percent"
        case .smartHome: "lightbulb.fill"
        case .devTools: "hammer.fill"
        case .wellbeing: "leaf.fill"
        case .nonNecessities: "ellipsis.circle.fill"
        case .todo: "checklist"
        }
    }

    var blurb: String {
        switch self {
        case .claude: "Chat with AI: free Gemini, Groq, OpenRouter or local Ollama, or paid Claude / ChatGPT. Optionally share your screen."
        case .today: "Your central page: clipboard, now playing and notes one click away, plus devices, notifications, quick add and Claude usage at a glance."
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
        case .games: "Add-on: tiny games for a short break: 2048, Snake and a reaction test. Best scores stay on this Mac."
        case .f1: "Add-on: Formula 1 live timing (order, gaps, tyres, laps, flags), the weekend schedule with a countdown, and standings. Follow a driver to see their position beside the notch."
        case .klick: "Pro: your keyboard sounds like a mechanical one, in any app. Eight sounds (Cream, Holy Panda, Blue, Red, Brown, Topre, Typewriter, Bubble), each with its own volume, and an on / off switch."
        case .convert: "Ultimate: drop a file and turn it into another kind. PPTX to PDF, HEIC to JPG, Word to PDF, MOV to MP4, Excel to CSV, PDF to pictures and more, saved next to the original."
        case .tennis: "Every ATP and WTA match with live scores, in Men, Women and Mixed. Grand Slams show in red, earlier weeks and recent Grand Slams are a click away, plus the ATP and WTA top 20. Star your favourite players and their live score shows beside the notch."
        case .radar: "Every aircraft flying around you right now on a round radar, with its callsign, type, height and speed, from the free adsb.lol feed. It uses your location (the same as the weather) rounded to about 1 km, and only asks while the tab is open."
        case .sports: "Follow your team (Barcelona unless you pick another): the next match with a countdown, every competition it plays in, recent results and the live score beside the notch. Browse the next two weeks of fixtures in the big football leagues, the NBA, NFL, MLB and NHL."
        case .live: "Add-on: quick tracking for parcels and flights. Live scores now live in the Sports tab."
        case .alerts: "Add-on: see notifications from other apps in the notch, and reply to iMessages. Needs Full Disk Access."
        case .plugins: "Add-on: your own widgets. Any script in the Plugins folder shows its output in the notch."
        case .voiceNotes: "Pro: record a voice note from the notch. It's transcribed on your Mac, and one click turns it into an AI summary with action items."
        case .screenTime: "Pro: see how long you spend in each app, set daily limits, and block distracting apps during Focus sessions. Stays on your Mac."
        case .quickAdd: "Pro: type “Dentist tomorrow 3pm” or “remind me to pay rent on the 1st” and it goes straight into Calendar or Reminders."
        case .markets: "Pro: a watchlist of stocks and crypto with today's change; pin one beside the notch."
        case .home: "Pro: your own dashboard of widgets in small, medium and large sizes."
        case .security: "Require Touch ID / Apple Watch / password to open the notch."
        case .wellbeing: "A breathing exercise, break reminders (eyes, water, stretch, posture) and a bedtime nudge. Free; the reminders keep running while the notch is closed."
        case .devTools: "Format JSON, encode and decode, read a JWT, hash, make a UUID, convert timestamps, test a regex, check colour contrast and make a QR code. Free, and everything stays on this Mac."
        case .smartHome: "Ultimate: lights, switches, scenes and more from your own Home Assistant (which also connects Hue, IKEA, Zigbee and Matter). The access token stays on this Mac."
        case .todo: "A to-do list with quick add built in: type a task (and a time, and !!! for high priority) and it goes straight in. High priority shows red and sits at the top."
        case .nonNecessities: "Everything you use now and then in one tab: Focus, World Clock, Audio, Snippets, Shortcuts, Timers, Plugins, Voice Notes, Screen Time and Smart Home."
        case .claudeUsage: "Ultimate: how many tokens Claude Code has used in your 5-hour window, today and this week, with budgets you set yourself. Read from ~/.claude on this Mac."
        case .cacheCleaner: "Ultimate: open the Purge app from the notch to free up disk space. Purge does the cleaning; Notch apple deletes nothing itself."
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
        // Remembered before the first-run welcome sets that flag: was Notch apple already installed when 2.0 arrived?
        if d.object(forKey: "v2.freshInstall") == nil { d.set(!alreadyInstalled, forKey: "v2.freshInstall") }
        // The notch opens and closes with ⌘J for everyone; anyone still on an old default (⌘E, ⌃⌥N) is moved once.
        HotkeyBinding.migrateNotchToCommandJ()
        HotkeyBinding.migrateInvisibilityOffCommandO()
        HotkeyBinding.migrateNotchOffCommandJ()   // ⌘E opens and closes, ⌘J hides and shows (2.0.26)
        let offByDefault: [Module] = [.windows, .tools, .notes, .focus, .browser, .launcher]
        if alreadyInstalled {
            for m in offByDefault where d.object(forKey: m.storageKey) == nil { d.set(true, forKey: m.storageKey) }
        }
        var defaults: [String: Any] = [Module.today.storageKey: true, Module.claude.storageKey: true]
        offByDefault.forEach { defaults[$0.storageKey] = false }
        // 1.14 add-ons start off for everyone, new and existing installs.
        [Module.timer, .snippets, .shortcuts, .devices, .live, .f1, .games, .alerts, .plugins, .voiceNotes, .screenTime, .quickAdd, .markets, .home, .cacheCleaner, .claudeUsage, .smartHome, .devTools, .wellbeing].forEach { defaults[$0.storageKey] = false }
        defaults[Module.sports.storageKey] = true   // everyone gets Sports, tracking Barcelona
        defaults[Module.tennis.storageKey] = true   // 2.0.5: Tennis is on for everyone
        defaults[Module.radar.storageKey] = true    // Flight Radar is on for everyone
        defaults[Module.klick.storageKey] = true    // 2.0.19: the Klick tab shows (it explains Pro until unlocked)
        defaults[Module.convert.storageKey] = true  // 2.0.22: the Convert tab shows (it explains Ultimate until unlocked)
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
    /// The Claude Code status dot (green when a task finishes, yellow when it needs you).
    @AppStorage("claudeCode.dot") var claudeCodeDot = true
    /// Off by default: a brief colour wash over every screen when the dot shows (green done, yellow needs you).
    @AppStorage("claudeCode.screenFlash") var claudeCodeScreenFlash = false
    @AppStorage(Module.f1.storageKey) var f1Enabled = false
    @AppStorage(Module.tennis.storageKey) var tennisEnabled = true
    @AppStorage(Module.radar.storageKey) var radarEnabled = true
    @AppStorage(Module.klick.storageKey) var klickEnabled = true
    @AppStorage(Module.convert.storageKey) var convertEnabled = true
    @AppStorage(Module.games.storageKey) var gamesEnabled = false
    /// On for everyone: Sports follows Barcelona out of the box.
    @AppStorage(Module.sports.storageKey) var sportsEnabled = true
    @AppStorage(Module.alerts.storageKey) var alertsEnabled = false
    @AppStorage(Module.plugins.storageKey) var pluginsEnabled = false
    @AppStorage(Module.voiceNotes.storageKey) var voiceNotesEnabled = false
    @AppStorage(Module.screenTime.storageKey) var screenTimeEnabled = false
    @AppStorage(Module.quickAdd.storageKey) var quickAddEnabled = false
    @AppStorage(Module.markets.storageKey) var marketsEnabled = false
    @AppStorage(Module.home.storageKey) var homeEnabled = false
    @AppStorage(Module.cacheCleaner.storageKey) var cacheCleanerEnabled = false
    @AppStorage(Module.claudeUsage.storageKey) var claudeUsageEnabled = false
    @AppStorage(Module.smartHome.storageKey) var smartHomeEnabled = false
    @AppStorage(Module.devTools.storageKey) var devToolsEnabled = false
    @AppStorage(Module.wellbeing.storageKey) var wellbeingEnabled = false
    @AppStorage(Module.todo.storageKey) var todoEnabled = false
    /// The iPhone Duo pop-and-morph animations (on by default).
    @AppStorage(Duo.key) var useDuoAnimations = true
    /// On (default): a two-finger sideways swipe over the tab bar only scrolls the tabs. Off: it also switches tab.
    @AppStorage("disableSwipeModuleSwitch") var disableSwipeModuleSwitch = true

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
    /// ⌥A takes the screen brightness to zero and back (needs Accessibility; it swallows the "å" the key would type).
    @AppStorage("ui.brightnessBlackout") var brightnessBlackout = true
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
    /// Hide or reveal the whole notch from anywhere with ⌃⌥O (changeable in Settings → Shortcuts & Hotkeys).
    @AppStorage("ui.invisibilityHotkey") var invisibilityHotkeyEnabled = true
    @AppStorage("ui.captureHotkey") var captureHotkeyEnabled = true
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
        case .tennis: $tennisEnabled
        case .radar: $radarEnabled
        case .klick: $klickEnabled
        case .convert: $convertEnabled
        case .games: $gamesEnabled
        case .sports: $sportsEnabled
        case .alerts: $alertsEnabled
        case .plugins: $pluginsEnabled
        case .voiceNotes: $voiceNotesEnabled
        case .screenTime: $screenTimeEnabled
        case .quickAdd: $quickAddEnabled
        case .markets: $marketsEnabled
        case .home: $homeEnabled
        case .cacheCleaner: $cacheCleanerEnabled
        case .claudeUsage: $claudeUsageEnabled
        case .smartHome: $smartHomeEnabled
        case .devTools: $devToolsEnabled
        case .wellbeing: $wellbeingEnabled
        case .nonNecessities: .constant(true)
        case .todo: $todoEnabled
        }
    }

    /// Tabs to show in the notch, in display order.
    var enabledTabs: [Module] {
        orderedTabs.filter { isEnabled($0) && ModuleLayout.shared.showsTab($0) }
    }

    /// The user's tab order (Settings → Appearance), as comma-separated raw values.
    @AppStorage("ui.tabOrder") var tabOrderData = ""

    /// Every tab module, in the user's order; new modules go at the end.
    var orderedTabs: [Module] {
        // Each tab once: an order saved by 2.0.5 or earlier could list a tab twice, and it then rendered twice.
        let ids = ModuleLayoutLogic.unique(tabOrderData.split(separator: ",").map(String.init))
        let saved = ids.compactMap { Module(rawValue: $0) }.filter(\.isTab)
        return saved + Module.allCases.filter { $0.isTab && !saved.contains($0) }
    }

    func setTabOrder(_ tabs: [Module]) {
        objectWillChange.send()
        tabOrderData = ModuleLayoutLogic.unique(tabs.map(\.rawValue)).joined(separator: ",")
    }

    func resetTabOrder() {
        objectWillChange.send()
        tabOrderData = ""
    }
}
