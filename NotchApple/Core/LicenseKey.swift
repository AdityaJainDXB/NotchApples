//
//  LicenseKey.swift
//  Notch apple
//
//  Tiers, the features each one unlocks, and the signed product keys that
//  prove which tier you bought. Pure logic (no UI, no network), so the tests
//  compile it directly. Entitlements.swift is the live object the app uses.
//
//  Keys look like NTCH-PRO-XXXXXX-… or NTCH-ULTM-XXXXXX-…: a 12-byte payload
//  (version, tier, 8-byte key ID, issue day) plus its 64-byte Ed25519 signature,
//  in Crockford base32. The app checks the signature offline with the public
//  key below; the private key only exists on the license server
//  (server/license-worker). There is no expiry: a key is for life.
//

import CryptoKit
import Foundation

enum Tier: Int, Comparable, CaseIterable, Codable {
    case free = 0, pro = 1, ultimate = 2

    static func < (a: Tier, b: Tier) -> Bool { a.rawValue < b.rawValue }

    var name: String {
        switch self {
        case .free: "Free"
        case .pro: "Pro"
        case .ultimate: "Ultimate"
        }
    }

    var price: String {
        switch self {
        case .free: "$0"
        case .pro: "$1 once"
        case .ultimate: "$5 once"
        }
    }
}

/// Everything that needs Pro or Ultimate. Anything not listed here is free.
/// `isReady == false` keeps a paid feature hidden until it fully works.
enum Feature: String, CaseIterable, Identifiable {
    // Pro: wellbeing
    case habits
    // Pro: notch
    case notchResize, edgeTrigger, displayLayouts, gestureRemap
    // Pro: customization
    case proThemes, customColors, themeEditor, homeLayout, profiles, appRules, animationStyles, customSounds, fontsAndIcons
    // Ultimate: customization
    case pluginGallery
    // Ultimate: platform
    case notesSync, iphoneCompanion
    // Ultimate: storage
    case cacheCleaner
    // Ultimate: developers
    case claudeUsage
    // Ultimate: home
    case smartHome
    // Ultimate: devices
    case clipboardLink
    // Pro: live activities
    case meetingAlert, downloadProgress, markets, flightStatus, multiMatch
    // Ultimate: live activities
    case activityStacking
    // Pro: AI
    case aiCapture, aiHistory, aiFileDrop, personas, slashCommands, webSearch, voice, clipboardAI
    // Ultimate: AI
    case automations
    // Pro: productivity
    case meetingNotes, namedTimers, focusProjects, richNotes, remindersSync, clipboardUnlimited, shelfPlus, textExpander, annotate, ruler, currency, commandPalette
    // Ultimate: scripting
    case scripting
    // Pro: tabs
    case messenger, audio, vpn, voiceNotes, screenTime, quickAdd, launcher, snippets, mirror, focus
    // Pro: system and media
    case rainAlert, lyrics, forecast, meetingPlanner, micMute, topProcesses, dndToggle, browserMedia
    // Pro: sync
    case sync
    // Ultimate (built in later phases; hidden until ready)
    case liveActivityAPI, pluginSDK, prioritySupport, betaChannel

    var id: String { rawValue }

    var tier: Tier {
        switch self {
        case .liveActivityAPI, .activityStacking, .automations, .scripting, .pluginSDK, .pluginGallery, .notesSync, .iphoneCompanion, .cacheCleaner, .claudeUsage, .smartHome, .clipboardLink, .prioritySupport, .betaChannel: .ultimate
        default: .pro
        }
    }

    var isReady: Bool {
        switch self {
        default: true
        }
    }

    var title: String {
        switch self {
        case .notchResize: "Notch size"
        case .meetingNotes: "Meeting notes"
        case .namedTimers: "Named timers"
        case .focusProjects: "Focus by project"
        case .richNotes: "Markdown notes and tags"
        case .remindersSync: "Reminders, Things and Todoist"
        case .clipboardUnlimited: "Longer clipboard history"
        case .shelfPlus: "Shelf folders, expiry and sharing"
        case .textExpander: "Text expander"
        case .annotate: "Screenshot markup"
        case .ruler: "Screen ruler"
        case .currency: "Unit and currency converter"
        case .commandPalette: "Command palette"
        case .scripting: "Command-line and scripting"
        case .edgeTrigger: "Edge trigger zones"
        case .displayLayouts: "Tabs per display"
        case .gestureRemap: "Custom gestures"
        case .proThemes: "Pro themes"
        case .customColors: "Custom colours"
        case .themeEditor: "Theme editor"
        case .homeLayout: "Home dashboard"
        case .profiles: "Profiles"
        case .appRules: "Per-app rules"
        case .animationStyles: "Animation styles"
        case .customSounds: "Custom sounds and haptics"
        case .fontsAndIcons: "Fonts and menu bar icon"
        case .pluginGallery: "Plugin gallery"
        case .notesSync: "Notes and to-dos in iCloud"
        case .iphoneCompanion: "iPhone companion"
        case .cacheCleaner: "Purge disk cleaner"
        case .claudeUsage: "Claude usage tracker"
        case .habits: "Habit tracker"
        case .smartHome: "Smart Home"
        case .clipboardLink: "Clipboard Link"
        case .meetingAlert: "Meeting alerts"
        case .downloadProgress: "Download progress"
        case .markets: "Markets"
        case .flightStatus: "Live flight status"
        case .multiMatch: "More teams"
        case .activityStacking: "Two activities at once"
        case .aiCapture: "Ask about your screen"
        case .aiHistory: "AI history"
        case .aiFileDrop: "Images and PDFs in AI"
        case .personas: "Personas and saved prompts"
        case .slashCommands: "Slash commands"
        case .webSearch: "Web search with sources"
        case .voice: "Voice input and read aloud"
        case .clipboardAI: "AI on your clipboard"
        case .automations: "AI automations"
        case .messenger: "Messenger"
        case .audio: "Audio"
        case .vpn: "VPN"
        case .voiceNotes: "Voice Notes"
        case .screenTime: "Screen Time"
        case .quickAdd: "Quick Add"
        case .launcher: "Launcher"
        case .snippets: "Snippets"
        case .mirror: "Mirror"
        case .focus: "Focus timer"
        case .rainAlert: "Rain alerts"
        case .lyrics: "Lyrics"
        case .forecast: "Week forecast and more cities"
        case .meetingPlanner: "Meeting-time planner"
        case .micMute: "Mic mute"
        case .topProcesses: "Top apps by CPU"
        case .dndToggle: "Do Not Disturb toggle"
        case .browserMedia: "Browser video controls"
        case .sync: "Sync across Macs"
        case .liveActivityAPI: "Live Activities API"
        case .pluginSDK: "Plugin SDK"
        case .prioritySupport: "Priority support"
        case .betaChannel: "Beta channel"
        }
    }

    /// One line on what you get, shown next to the lock.
    var benefit: String {
        switch self {
        case .notchResize: "Make the open notch wider or taller, with a live preview."
        case .meetingNotes: "Start a note from any calendar event, with the time, an agenda and action items ready."
        case .namedTimers: "Run several timers at once, each with its own name: “Pasta 10m”, “Egg 1:30”."
        case .focusProjects: "Name what you are working on and see this week's focus time split by project."
        case .richNotes: "Preview notes as Markdown and filter them by #tags."
        case .remindersSync: "See and tick off your Apple Reminders in To-do, and send to-dos to Things or Todoist."
        case .clipboardUnlimited: "Keep up to 5,000 clipboard items, and ignore apps you choose."
        case .shelfPlus: "Group shelf files into folders, let them expire, and share them in one click."
        case .textExpander: "Type an abbreviation like ;sig anywhere and it becomes your snippet."
        case .annotate: "Draw arrows, boxes, highlights and text on a screenshot."
        case .ruler: "Measure anything on screen in points."
        case .currency: "Type 5 km to mi or 100 usd to eur in the calculator."
        case .commandPalette: "One shortcut to search and run everything Notch apple can do."
        case .scripting: "A `notch` command for Terminal and more notchapple:// commands for scripts."
        case .edgeTrigger: "Open the notch from anywhere along the top of the screen."
        case .displayLayouts: "Choose which tabs show on each display."
        case .gestureRemap: "Choose what each swipe, scroll and long-press does."
        case .proThemes: "Eight more themes, from Aurora to Rose Gold."
        case .customColors: "Your own accent colour and glow."
        case .themeEditor: "Build a theme, then export it or import one from a friend."
        case .homeLayout: "A dashboard tab of widgets you arrange, in three sizes."
        case .profiles: "Work, Study or Gaming setups that switch by app or time of day."
        case .appRules: "Hide the notch in some apps, or open a tab when an app comes forward."
        case .animationStyles: "Snappy, smooth, bouncy or calm animations, at the speed you like."
        case .customSounds: "Pick the sounds and trackpad feel for opening and closing."
        case .fontsAndIcons: "Rounded, serif or monospaced text in the notch, and your own menu bar icon."
        case .pluginGallery: "Install community plugins in one click."
        case .notesSync: "Your notes and to-dos on every Mac, through iCloud Drive."
        case .iphoneCompanion: "Send text and links from your iPhone to the notch, and control the Mac from it."
        case .cacheCleaner: "Open the Purge app from the notch to free up disk space. Purge does the cleaning."
        case .claudeUsage: "How many tokens Claude Code has used in your 5-hour window, today and this week, with your own budgets."
        case .habits: "Build streaks: tick a habit each day and watch the run grow."
        case .clipboardLink: "Copy on one device and paste on another, between your Macs and PCs. Encrypted with a code only your devices know."
        case .smartHome: "Control your Home Assistant lights, switches, scenes and more from the notch. Works with Hue, IKEA, Zigbee and Matter through Home Assistant."
        case .meetingAlert: "A heads-up before meetings, with a Join button."
        case .downloadProgress: "Watch downloads fill up beside the notch."
        case .markets: "Stocks and crypto with today's change; pin one beside the notch."
        case .flightStatus: "Altitude and speed of a flight in the air, beside the notch."
        case .multiMatch: "Follow up to five more teams; live scores take turns beside the notch."
        case .activityStacking: "Show two live activities at once, one in each ear."
        case .aiCapture: "Capture any part of the screen (⌃⌥S) or selected text and ask about it."
        case .aiHistory: "Search, reopen and export past AI conversations."
        case .aiFileDrop: "Drop or paste images and PDFs into the AI tab."
        case .personas: "Standing instructions for every answer, and your favourite prompts one click away."
        case .slashCommands: "Type /summarize, /fix, /translate fr: … or /web in the AI box."
        case .webSearch: "Answers that search the web first and cite their sources."
        case .voice: "Dictate questions and have answers read aloud."
        case .clipboardAI: "Summarise, translate or fix what you copied; the result is copied back."
        case .automations: "Prompts that run on a schedule, like a morning summary of your calendar."
        case .messenger: "Your chats in the notch."
        case .audio: "Per-app volume and output switching."
        case .vpn: "Connect your VPN from the notch."
        case .voiceNotes: "Record and transcribe voice notes."
        case .screenTime: "See where your time goes and block distractions."
        case .quickAdd: "Add reminders and events in plain English."
        case .launcher: "Your apps in a grid, one click away."
        case .snippets: "Saved text you can paste anywhere."
        case .mirror: "A quick camera check before calls."
        case .focus: "Pomodoro sessions in the notch."
        case .rainAlert: "A nudge before it starts raining."
        case .lyrics: "Lyrics for what's playing."
        case .forecast: "The next 12 hours and 7 days, for up to six cities."
        case .meetingPlanner: "Slide through the day to find a time that works in every city."
        case .micMute: "Mute your microphone in one click, with a red mic beside the notch."
        case .topProcesses: "See which apps are using the most CPU and memory."
        case .dndToggle: "Turn Do Not Disturb on and off from the notch, the palette or quick actions."
        case .browserMedia: "Speed (0.5× to 3×) and skip 10 seconds for video and podcasts playing in your browser."
        case .sync: "Your setup on every Mac, through iCloud or your account."
        case .liveActivityAPI: "Let your own apps and scripts show live activities."
        case .pluginSDK: "Your own widgets: plugins can be Home widgets and live activities."
        case .prioritySupport: "Your issues answered first."
        case .betaChannel: "Try new versions early."
        }
    }

    func isAllowed(at tier: Tier) -> Bool { tier >= self.tier }
}

struct LicenseKey: Equatable {
    let tier: Tier
    /// 16 hex characters; identifies the key for revocation and the device limit.
    let keyID: String
    let issued: Date
    /// The key as the user typed it, normalised (NTCH-PRO-XXXXXX-…).
    let text: String

    enum Problem: LocalizedError, Equatable {
        case notAKey, tampered, wrongTier, revoked, tooManyMacs(Int), server(String)
        var errorDescription: String? {
            switch self {
            case .notAKey: "That doesn't look like a Notch apple key. Copy the whole key, from NTCH- to the end."
            case .tampered: "That key isn't valid. Check it was copied completely, or use \"Lost my key?\"."
            case .wrongTier: "That key's tier label doesn't match the key. Copy it again from your email."
            case .revoked: "That key has been turned off (refunded or shared publicly). Use \"Lost my key?\" or contact us."
            case .tooManyMacs(let n): "That key is already active on \(n) Macs. Deactivate it on one of them (Settings → License) and try again."
            case .server(let why): why
            }
        }
    }

    /// The license server's public key. The private half never leaves the server.
    static let productionPublicKey = Data(base64Encoded: "HmCtNtd+sFaJO+8TQ57od7pptH3dhEx00SO16I1fhvs=")!

    private static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    private static let epoch = Date(timeIntervalSince1970: 1_767_225_600)   // 1 January 2026, UTC

    /// True when the text starts like a new key (so the field doesn't format it as an old code).
    static func looksLikeKey(_ input: String) -> Bool {
        input.trimmingCharacters(in: .whitespacesAndNewlines).uppercased().hasPrefix("NTCH")
    }

    /// Parses and checks the signature. Doesn't check revocation (Entitlements does, when online).
    static func parse(_ input: String, publicKey: Data = productionPublicKey) -> Result<LicenseKey, Problem> {
        let s = input.uppercased().filter { !$0.isWhitespace }
        let label: String, rest: Substring
        if s.hasPrefix("NTCH-PRO-") { label = "PRO"; rest = s.dropFirst(9) }
        else if s.hasPrefix("NTCH-ULTM-") { label = "ULTM"; rest = s.dropFirst(10) }
        else if s.hasPrefix("NTCH") { return .failure(s.count > 40 ? .wrongTier : .notAKey) }
        else { return .failure(.notAKey) }
        guard let bytes = decode(rest.filter { $0 != "-" }), bytes.count == 76, bytes[0] == 1 else { return .failure(.tampered) }
        let payload = bytes.prefix(12), signature = bytes.suffix(64)
        guard let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey),
              key.isValidSignature(signature, for: payload) else { return .failure(.tampered) }
        guard let tier = Tier(rawValue: Int(bytes[1])), tier != .free else { return .failure(.tampered) }
        guard (tier == .pro ? "PRO" : "ULTM") == label else { return .failure(.wrongTier) }
        let day = Int(bytes[10]) << 8 | Int(bytes[11])
        let id = bytes[2..<10].map { String(format: "%02x", $0) }.joined()
        let groups = stride(from: 0, to: rest.filter { $0 != "-" }.count, by: 6).map { i -> String in
            let body = Array(rest.filter { $0 != "-" })
            return String(body[i..<min(i + 6, body.count)])
        }
        return .success(LicenseKey(tier: tier, keyID: id, issued: epoch.addingTimeInterval(Double(day) * 86400),
                                   text: "NTCH-\(label)-" + groups.joined(separator: "-")))
    }

    /// Partly hidden, for Settings: NTCH-PRO-04138Y-…-EEKC7P.
    var masked: String {
        let parts = text.split(separator: "-")
        guard parts.count > 4 else { return text }
        return "\(parts[0])-\(parts[1])-\(parts[2])-…-\(parts[parts.count - 2])"
    }

    private static func decode(_ text: some StringProtocol) -> [UInt8]? {
        var out: [UInt8] = [], bits = 0, value = 0
        for var c in text {
            if c == "O" { c = "0" } else if c == "I" || c == "L" { c = "1" }
            guard let i = alphabet.firstIndex(of: c) else { return nil }
            value = (value << 5) | i; bits += 5
            if bits >= 8 { out.append(UInt8((value >> (bits - 8)) & 255)); bits -= 8; value &= (1 << bits) - 1 }
        }
        return out
    }

    /// Checks the server's signed revocation list and returns the revoked key IDs, or nil if it isn't genuine.
    static func revokedIDs(list: String, signature: String, publicKey: Data = productionPublicKey) -> [String]? {
        guard let sig = Data(base64Encoded: signature), let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey),
              key.isValidSignature(sig, for: Data(list.utf8)),
              let json = try? JSONSerialization.jsonObject(with: Data(list.utf8)) as? [String: Any] else { return nil }
        return json["ids"] as? [String] ?? []
    }

    /// The tier this Mac is entitled to: a valid signed key wins; an older activation
    /// (access code or website key from before tiers) counts as Pro.
    static func tier(key: LicenseKey?, revoked: Set<String>, legacyActivated: Bool) -> Tier {
        if let key, !revoked.contains(key.keyID) { return key.tier }
        return legacyActivated ? .pro : .free
    }
}
