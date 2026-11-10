//
//  AppContextLogic.swift
//  Notch Apple
//
//  "Suggest a tab for the app you're in": which kind of app is in front, and which notch tab helps there. Foundation only, so it is
//  tested on its own. A category lists its apps by bundle id (or id prefix) and the tabs it would suggest, best first; the app
//  suggests the first of those that is actually on the bar.
//

import Foundation

enum AppContextLogic {
    struct Category: Identifiable, Equatable {
        let id: String
        let name: String
        /// Tab raw values (Module.rawValue), best first.
        let tabs: [String]
        /// What the suggestion says, e.g. "Time your meeting".
        let offer: String
        let bundles: [String]
        let prefixes: [String]

        init(_ id: String, _ name: String, tabs: [String], offer: String, bundles: [String] = [], prefixes: [String] = []) {
            self.id = id; self.name = name; self.tabs = tabs; self.offer = offer; self.bundles = bundles; self.prefixes = prefixes
        }
    }

    static let categories: [Category] = [
        .init("meetings", "Meetings and calls", tabs: ["timer", "today"], offer: "Time your meeting",
              bundles: ["us.zoom.xos", "com.microsoft.teams", "com.microsoft.teams2", "com.cisco.webexmeetingsapp", "com.apple.FaceTime"]),
        .init("coding", "Coding and terminals", tabs: ["claudeUsage", "claude", "devTools"], offer: "Check Claude",
              bundles: ["com.apple.dt.Xcode", "com.microsoft.VSCode", "com.apple.Terminal", "com.googlecode.iterm2", "dev.warp.Warp-Stable", "com.mitchellh.ghostty", "dev.zed.Zed", "com.sublimetext.4"],
              prefixes: ["com.jetbrains.", "com.todesktop."]),
        .init("music", "Music and podcasts", tabs: ["nowPlaying", "audio"], offer: "See what's playing",
              bundles: ["com.apple.Music", "com.spotify.client", "com.apple.podcasts", "com.apple.TV"]),
        .init("messaging", "Chat apps", tabs: ["messenger"], offer: "Open Messenger",
              bundles: ["com.apple.MobileSMS", "net.whatsapp.WhatsApp", "ru.keepcoder.Telegram", "com.tinyspeck.slackmacgap", "com.hnc.Discord", "org.whispersystems.signal-desktop"]),
        .init("writing", "Writing and notes", tabs: ["notes", "tools"], offer: "Jot a note",
              bundles: ["com.apple.Notes", "com.apple.iWork.Pages", "com.microsoft.Word", "md.obsidian", "notion.id", "com.apple.TextEdit", "com.bear-writer.BearNotes"]),
        .init("browsing", "Web browsers", tabs: ["clipboard", "browser"], offer: "Open the clipboard",
              bundles: ["com.apple.Safari", "com.google.Chrome", "company.thebrowser.Browser", "org.mozilla.firefox", "com.microsoft.edgemac", "com.brave.Browser"]),
        .init("design", "Design and media files", tabs: ["utilities", "convert", "shelf"], offer: "Convert or hold files",
              bundles: ["com.figma.Desktop", "com.bohemiancoding.sketch3", "com.adobe.Photoshop", "com.pixelmatorteam.pixelmator.x", "com.apple.Preview", "com.apple.FinalCut"],
              prefixes: ["com.adobe."]),
        .init("files", "Finder", tabs: ["utilities", "shelf"], offer: "Hold files on the Shelf", bundles: ["com.apple.finder"]),
        .init("calendar", "Calendar and mail", tabs: ["home", "today"], offer: "See your day",
              bundles: ["com.apple.iCal", "com.apple.mail", "com.microsoft.Outlook", "com.readdle.smartemail-Mac"]),
        .init("video", "Video players", tabs: ["audio"], offer: "Adjust the sound",
              bundles: ["com.apple.QuickTimePlayerX", "org.videolan.vlc", "com.colliderli.iina", "tv.plex.desktop"]),
        .init("numbers", "Spreadsheets and money", tabs: ["tools"], offer: "Open the calculator",
              bundles: ["com.apple.iWork.Numbers", "com.microsoft.Excel", "com.apple.calculator"]),
        .init("games", "Games", tabs: ["games"], offer: "Take a game break",
              bundles: ["com.valvesoftware.steam", "com.epicgames.EpicGamesLauncher", "com.apple.Chess"]),
        .init("system", "System tools", tabs: ["utilities", "stats"], offer: "See your Mac's stats",
              bundles: ["com.apple.ActivityMonitor", "com.apple.systempreferences", "com.apple.Console", "com.apple.DiskUtility"]),
        .init("capture", "Screenshots and recording", tabs: ["utilities", "shelf"], offer: "Hold it on the Shelf",
              bundles: ["com.apple.screencaptureui", "com.apple.Screenshot", "com.obsproject.obs-studio"]),
    ]

    /// The category an app belongs to, unless that category is turned off.
    static func category(forBundleID id: String?, disabled: Set<String> = []) -> Category? {
        guard let id, !id.isEmpty else { return nil }
        return categories.first { c in
            !disabled.contains(c.id) && (c.bundles.contains(id) || c.prefixes.contains { id.hasPrefix($0) })
        }
    }

    /// The first of the category's tabs that is on the bar, or nil when none is (then nothing is suggested).
    static func suggestedTab(for category: Category, available: [String]) -> String? {
        category.tabs.first { available.contains($0) }
    }
}
