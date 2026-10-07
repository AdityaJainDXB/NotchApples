//
//  WhatsNew.swift
//  Notch apple
//
//  Release notes inside the app. After an update, About shows a small
//  "What's new" badge once; opening it (or dismissing it) marks that version
//  as seen, so it never nags again. Older releases stay listed below.
//
//  Keep this in step with the website's What's New and the GitHub release notes.
//

import SwiftUI

struct ReleaseNote: Identifiable {
    var id: String { version }
    let version: String
    let date: String
    let headline: String
    let items: [String]
}

enum WhatsNew {
    static let releases: [ReleaseNote] = [
        ReleaseNote(version: "1.32.4", date: "7 October 2026", headline: "No more locked screen", items: [
            "The required-permission screen is gone and the notch always shows your tabs. Turn on Accessibility in Settings → Permissions for the volume gauge, ⌥A and window snapping.",
        ]),
        ReleaseNote(version: "1.32.3", date: "7 October 2026", headline: "Update reminders", items: [
            "While an update is waiting, every 4th or 5th time you open the notch it offers Update or Skip for now. Required updates can't be skipped.",
        ]),
        ReleaseNote(version: "1.32.2", date: "7 October 2026", headline: "Required updates, and choose what to switch on", items: [
            "A release can be marked required: the open notch then shows only an Update now screen until you update. Settings and the menu bar still work.",
            "After updating, a window lists the new optional features with a switch for each, once.",
        ]),
        ReleaseNote(version: "1.32.1", date: "7 October 2026", headline: "Option+A screen blackout, and the Accessibility prompt fixed", items: [
            "Press Option+A to take the screen brightness to zero and again to bring it back. Switch it off in Settings if you type å.",
            "macOS keeps a stale Accessibility entry after each update, so Notch apple kept asking even when it was switched on. It now clears that entry once per version and asks again, and the setup screen has an \"It's already on: fix it\" button.",
        ]),
        ReleaseNote(version: "1.30.3", date: "6 October 2026", headline: "Add your VPN app, and a required setup step", items: [
            "Your own VPN is now just \"add the app\": click VPN app in the VPN tab and pick Proton VPN, NordVPN, Mullvad, WireGuard or any other app. The power button opens it and turns green when your Mac has a VPN tunnel up. No addresses or passwords.",
            "The Accessibility permission is now a required first step. Until it is on, the open notch shows a short setup screen; the moment it is granted, the volume and brightness gauge starts, with no relaunch.",
        ]),
        ReleaseNote(version: "1.30.2", date: "6 October 2026", headline: "The notch is back at the top, and one pop-up at a time", items: [
            "Fixed the notch sitting below the top of the screen in 1.30.0 and 1.30.1. It is flush with the top edge again, and macOS can no longer push it under the menu bar.",
            "Fixed two volume or brightness pop-ups showing on top of each other: until Accessibility is allowed only the macOS pop-up shows; once it is, only the notch gauge shows.",
        ]),
        ReleaseNote(version: "1.30.1", date: "6 October 2026", headline: "Cookie Clicker unlocks", items: [
            "Cookie Clicker buildings now unlock as you bake: they show as locked goals first and open up as your total baked cookies grows.",
        ]),
        ReleaseNote(version: "1.30.0", date: "6 October 2026", headline: "A huge update", items: [
            "Claude Code status dot: a small dot beside the notch, green for 4 seconds when a Claude Code task finishes and yellow for 4 seconds when it needs your input or finishes with warnings or errors. Set it up in Settings → Notch Extras → Claude Code.",
            "A pin in the notch header keeps the notch open while you drag files in from Finder or the Desktop.",
            "A new VPN page: one big power button to connect or disconnect, a discreet server picker on the right, and your own custom VPNs (IKEv2, OpenVPN, WireGuard). The VPN badge is gone from the header.",
            "AirDrop drops now work anywhere on the AirDrop card, and Share can AirDrop text and code snippets (as text or as a file).",
            "Two new games: Cookie Clicker (click multipliers and auto-clickers, saved progress) and Runner, a fast arcade jumper.",
            "Live scores moved into the Sports tab. The old Live tab is now Parcels & Flights and is off by default.",
            "The notch stays put in full-screen apps, including on Macs without a hardware notch.",
        ]),
        ReleaseNote(version: "1.29.0", date: "6 October 2026", headline: "Lid Fold", items: [
            "Lid Fold folds your desktop like a closing laptop lid: it tilts, frosts and dims, then comes back. It is off by default. Turn it on in Settings → Lid Fold, then try Preview, the timed demo, or press ⌃⌥F to fold and hold.",
            "On a MacBook with a lid-angle sensor, “Follow the lid” folds the desktop as you close the screen and unfolds it as you reopen it. Macs without the sensor can still use Preview, the demo and the hotkey.",
            "A fold is always dismissible: click anywhere, press Esc or the hotkey. Every fold except the lid-following one also ends by itself, and any error, sleep, lock or display change removes it. Without Screen Recording it previews on a plain backdrop and captures nothing.",
            "Settings → About → Acknowledgements credits the open-source projects Lid Fold builds on, with their licences.",
        ]),
        ReleaseNote(version: "1.28.1", date: "5 October 2026", headline: "Smoother window switching", items: [
            "Switching tabs now has the Duo blur-morph too: the new page slides in from the side it sits on in the tab bar, coming into focus out of a blur, while the old page blurs and fades away. The pages overlap while they swap, so nothing jumps.",
        ]),
        ReleaseNote(version: "1.28.0", date: "5 October 2026", headline: "Arrange your tabs by dragging", items: [
            "The welcome tour now asks which tabs you want and lets you put them in order by dragging cards, with no up and down arrows. Click + to add a tab, ✕ to remove one, or drag it up to the exact spot you want. The other cards make room as you drag.",
            "The same drag-and-drop organizer replaces the arrows in Settings → Appearance (“Notch tabs and order”), and it uses the same switches as Settings → Modules, so there is only one list.",
            "The Purge tab is now a small menu: “Free up space” opens Purge, “Review removed apps” opens Purge's leftovers review, and if Purge isn't installed the tab asks whether you want to install it.",
        ]),
        ReleaseNote(version: "1.27.3", date: "5 October 2026", headline: "The Duo animation, done properly", items: [
            "The iPhone Duo open and close animation now works the way the Dynamic Island does: the notch grows out with a soft overshoot while what's inside comes into focus out of a blur, and on closing it blurs away quickly as the notch tucks back in with no bounce.",
        ]),
        ReleaseNote(version: "1.27.2", date: "5 October 2026", headline: "Duo animations and full-screen in Modules", items: [
            "“Use iPhone Duo animations” and “Keep the notch visible in full-screen apps” are now also at the top of Settings → Modules, so the notch's switches are in one place. They're still in Settings → Notch too, and both are on by default.",
        ]),
        ReleaseNote(version: "1.27.1", date: "5 October 2026", headline: "The notch stays visible in full-screen apps", items: [
            "“Keep the notch visible in full-screen apps” is now on by default, so the notch stays where it is when an app goes full screen (including on Macs without a hardware notch, like the base M1). Turn it off in Settings → Notch → Stepping aside if you'd rather it step aside.",
        ]),
        ReleaseNote(version: "1.27.0", date: "5 October 2026", headline: "Tidier Settings, a faster Snake and two new games", items: [
            "Settings is shorter. Permissions and Privacy share one entry, “Privacy & Permissions”: choose it and pick which one to open. Focus timer settings moved into Notch → Focus.",
            "Snake no longer drops or ignores quick taps: turns are queued in order (two per move), keys are read directly, the game runs off the main thread and the board is drawn as one fast canvas.",
            "New games: Breakout (mouse or ← → to move the paddle, three lives, faster levels) and Memory (repeat the pattern of lights, one more each round).",
            "Every game keeps its best score, and there is one Sound switch for all of them in the Games sidebar.",
        ]),
        ReleaseNote(version: "1.26.1", date: "5 October 2026", headline: "Purge instead of our own cleaner", items: [
            "The Ultimate Cache Cleaner tab is now the Purge tab. It opens the Purge app (a separate disk cleaner) from the notch, and links you to it if it isn't installed. Notch apple no longer scans or deletes anything itself.",
            "Fixed: a two-finger sideways swipe over the tab bar used to scroll the tabs and also switch to the next one. It now only scrolls. If you liked switching by swipe, turn on Settings → Notch → Swipe on the tab bar switches tabs.",
        ]),
        ReleaseNote(version: "1.26.0", date: "5 October 2026", headline: "Duo animations, Cache Cleaner and full-screen notch", items: [
            "iPhone Duo animations (on by default): the panel springs out of the notch, the highlight slides between tabs as one shape and pages scale into place, like the Dynamic Island. Turn them off in Settings → Notch → Use iPhone Duo animations. Reduce Motion always wins.",
            "Ultimate: Cache Cleaner. Scans app caches, Xcode derived data, logs and old temporary files and clears them in one click. (Replaced by the Purge tab in 1.26.1.)",
            "Keep the notch visible in full-screen apps (Settings → Notch → Stepping aside): for Macs without a hardware notch, like the base M1, where the notch used to vanish when an app went full screen.",
            "The welcome tour's tab picker now also offers Translator, Mac Stats and Cache Cleaner, and what you pick there is what Settings → Modules shows.",
        ]),
        ReleaseNote(version: "1.25.0", date: "5 October 2026", headline: "Your own hot corners", items: [
            "Settings → Notch → Hot corners: push the pointer into any screen corner to open a website, an app, a file or folder, run a Shortcut, open Mission Control, or open and close the notch.",
            "Pick a different action for each corner, how long the pointer must rest there, and optionally a key to hold (⌥, ⌘, ⌃ or ⇧) so it never fires by accident.",
            "Works next to macOS's own hot corners. In System Settings → Desktop & Dock → Hot Corners, set a corner to “–” if you give it to Notch apple. Free for everyone.",
        ]),
        ReleaseNote(version: "1.24.0", date: "4 October 2026", headline: "Notch apple on your iPhone", items: [
            "Ultimate: the iPhone companion. Send text and links to the notch, see the Mac's battery and music, and control music, timers and Keep Awake. It works over your Wi-Fi with no server, and every message is encrypted.",
            "Get NotchAppleCompanion.ipa from the release and install it with Sideloadly. With a free Apple ID, reinstall it every 7 days. Pair it in Settings → iPhone.",
            "Shortcuts on iPhone: “Send to Mac notch” and “Get Mac status”, including from the share sheet.",
            "Pro: speed (0.5× to 3×) and skip 10 seconds for video and podcasts playing in Safari, Chrome, Arc, Brave or Edge.",
            "Questions about a purchase? Write to notchapples.support@gmail.com.",
        ]),
        ReleaseNote(version: "1.23.1", date: "4 October 2026", headline: "Pro and Ultimate are on sale", items: [
            "Buy Pro ($1) or Ultimate ($5) on the website: your signed key is shown and emailed, and works on up to 3 Macs.",
            "Every future update is included for buyers, 2.0 and beyond. Add an optional tip at checkout if you'd like.",
            "Students can ask for a free Pro promo code.",
        ]),
        ReleaseNote(version: "1.23.0", date: "4 October 2026", headline: "The finishing touches", items: [
            "Peek: rest the pointer on the closed notch for a one-line glance (what's playing, your next event or the weather). Click to open.",
            "Swipe down on the notch to open it (Settings → Notch), and a countdown beside the notch 15 minutes before your next event.",
            "Undo: deleting a note, to-do, clipboard item, shelf file or Home widget shows Undo for a few seconds (⌘Z works too).",
            "Focus: with a Shortcuts automation, the notch stays quiet or steps aside while a Focus is on; with Pro it switches to the matching profile.",
            "AppleScript: tell application \"Notch apple\" to run notch command \"timer?minutes=5\".",
            "Pro: a Do Not Disturb toggle, send to-dos to Things or Todoist, and drag-and-drop in Home.",
        ]),
        ReleaseNote(version: "1.22.0", date: "4 October 2026", headline: "Trust, and a few more extras", items: [
            "Settings → Privacy: every permission, everywhere Notch apple can connect to and when, and what it keeps on this Mac, with Delete buttons.",
            "Settings → Help & Feedback: send feedback, and a bug report you read in full before you submit it yourself on GitHub.",
            "Crash reports, off by default: after a crash you can review the report (name and home folder removed) and send it.",
            "Pro: a 12-hour and 7-day forecast for up to six cities, a meeting-time planner in World Clock, mic mute, and top apps by CPU.",
            "Ultimate: the beta channel, priority support, and notes and to-dos synced through iCloud.",
        ]),
        ReleaseNote(version: "1.21.0", date: "4 October 2026", headline: "Make it yours", items: [
            "Pro: Home, a dashboard tab of widgets (clock, weather, battery, next event, Now Playing, timer, to-do, markets) in small, medium or large.",
            "Pro: profiles (Work, Study, Gaming…) that choose your tabs and theme, switching by the app in front or the time of day.",
            "Pro: per-app rules: hide the notch in an app, or have it open on a tab when an app comes forward.",
            "Pro: animation styles and speed, your own open/close sounds and haptic feel, rounded/serif/monospaced text and a menu bar icon.",
            "Ultimate: the plugin SDK. Plugins can show beside the notch (activity: lines), be Home widgets and keep running in the background.",
            "Ultimate: the plugin gallery: install community plugins in one click, after reading their source.",
        ]),
        ReleaseNote(version: "1.20.0", date: "4 October 2026", headline: "Get more done", items: [
            "A To-do list in the Notes tab, saved on this Mac.",
            "Pro: Reminders in To-do (tick them off right there), Markdown preview and #tags for notes.",
            "Pro: the command palette (⌃⌥P): search and run tabs, timers, snippets, saved prompts, apps and Settings, or ask the AI.",
            "Pro: a text expander: give a snippet an abbreviation like ;sig and type it anywhere.",
            "Pro: screenshot markup (arrows, boxes, highlights, text), a screen ruler, and unit and currency conversion in the calculator.",
            "Pro: shelf folders, auto-expiry and a Share button; up to 5,000 clipboard items and apps whose copies are never saved.",
            "Ultimate: a notch command for Terminal and more notchapple:// commands (ask, note, todo, theme, palette…).",
        ]),
        ReleaseNote(version: "1.19.0", date: "4 October 2026", headline: "A smarter assistant", items: [
            "Apple Intelligence as an AI provider: free, private and on this Mac (macOS 26 or newer with Apple Intelligence on).",
            "Pro: web search with sources. Turn on the globe and answers search DuckDuckGo first and cite what they used.",
            "Pro: personas (Tutor, Concise, Code reviewer, Writing coach or your own) and saved prompts.",
            "Pro: slash commands: /summarize, /explain, /eli5, /fix, /translate fr: …, /code, /web, /persona.",
            "Pro: dictate questions and have answers read aloud.",
            "Pro: AI on your clipboard: summarise, fix, translate or explain a copied item; the result is copied back.",
            "Ultimate: AI automations, prompts that run on a schedule (say a morning summary of your calendar), delivered as a notification.",
        ]),
        ReleaseNote(version: "1.18.0", date: "4 October 2026", headline: "More live activities", items: [
            "A soft pulse beside the notch when a video call is about to start, with Join one click away.",
            "Pro: Markets, a watchlist of stocks and crypto with today's change and a chart; pin one beside the notch.",
            "Pro: live flight status in Live (altitude and speed while it's in the air), pinned beside the notch.",
            "Pro: follow up to five more teams in Sports; their live scores take turns beside the notch.",
            "Ultimate: the Live Activities API. Show your own builds, uploads or anything else beside the notch from Terminal, Shortcuts or an app.",
            "Ultimate: two activities at once, one in each ear (say a timer and a live score).",
        ]),
        ReleaseNote(version: "1.17.0", date: "4 October 2026", headline: "A notch that fits how you work", items: [
            "Settings → Notch: hover delay, hide in fullscreen apps, and (optionally) hide while the screen is recorded.",
            "Keyboard control: ⌘1–⌘9 jump to a tab, ⌘[ and ⌘] step through them. Long-press the closed notch for quick actions; swipe on the tab bar to change tabs, swipe up to close.",
            "A four-step welcome for new installs: permissions, your tabs, your look and a quick tour (show it again from Settings → General).",
            "Search in Settings, optional open/close sounds and trackpad haptics, and stronger contrast when Increase Contrast is on.",
            "Pro: resize the open notch with a live preview (or pinch it), edge trigger zones along the top of the screen, tabs per display, remappable gestures, eight new themes and a theme editor with import and export.",
        ]),
        ReleaseNote(version: "1.16.0", date: "4 October 2026", headline: "Free, Pro and Ultimate", items: [
            "Three tiers, each paid once: Free stays complete, Pro is $1 and Ultimate is $5. No subscription, no account, every 1.x update included. See Settings → License → Compare tiers.",
            "AI is free: ask anything and keep asking, with your own free key or Ollama. Asking about your screen (⌃⌥S), selected text, images and PDFs, and AI History are Pro.",
            "Signed product keys, checked on your Mac, offline. They're emailed to you, work on up to 3 Macs, and activate with one click from the checkout page.",
            "Settings → License: your tier, Deactivate this Mac, Lost my key?, Upgrade to Ultimate for $4, and Terms.",
            "Moved to Pro: Launcher, Snippets, Mirror, Focus timer, meeting alerts, download progress, rain alerts, lyrics and automatic sync. Backup, F1, sports, clipboard, window snapping, AirDrop, screenshots, Shortcuts and the world clock stay free.",
            "Already bought Pro? Your key or access code keeps working as Pro. Donors and $2 supporters get Ultimate free; ask on GitHub.",
        ]),
        ReleaseNote(version: "1.15.3", date: "3 October 2026", headline: "Clearer cricket scores", items: [
            "Cricket fixtures show each side's score under its name, LIVE or Result between them, and the match status (\"West Indies require 166 runs\") on its own line instead of squeezed into the score column.",
        ]),
        ReleaseNote(version: "1.15.2", date: "3 October 2026", headline: "Windows, charts and a full view", items: [
            "Capture a single window: hold the capture button and choose Window under the pointer, or make it the default in Settings → AI.",
            "Charts and tables are recognised (\"Looks like a chart or table\") with Explain, Summarize and Extract suggested.",
            "Open full view: the conversation in a resizable window for long answers.",
            "First-run AI setup in the AI tab: pick free Gemini or private Ollama, test it, then try a capture.",
            "Settings → AI → Temperature, and Settings → Appearance → Settings window (System, Light or Dark).",
        ]),
        ReleaseNote(version: "1.15.1", date: "3 October 2026", headline: "Match day, cricket and games", items: [
            "Sports: match alerts (30 minutes before kick-off, plus a flash in the notch on goals and at full time), a league table next to the fixtures, and match details with goalscorers, cards and lineups.",
            "Cricket: India's internationals and the IPL. National teams: the World Cup, qualifiers, Nations League, Euro, Copa América, Asian Cup and friendlies.",
            "If ESPN is down or changes, Sports says it's unavailable instead of showing an empty tab.",
            "Notch Games: 2048, Snake and a reaction test for short breaks (Settings → Modules).",
            "Fixed: an old \"Update available\" notification could stay around after you'd updated.",
        ]),
        ReleaseNote(version: "1.15.0", date: "3 October 2026", headline: "See it, capture it, understand it", items: [
            "Capture anything with ⌃⌥S: drag a box on the display under the pointer (Retina-sharp), take the whole display, or every display.",
            "Paste or drop an image or PDF onto the AI tab, or use the text you copied or selected.",
            "One-click modes: Solve, Explain, Explain simply, Answer only, Hint, Summarize, Translate, Extract text, Rewrite, Code and Ask, with suggestions from a quick on-device look at what you captured.",
            "Answers stream in. Stop keeps what's written, Retry asks again (with a new provider if you switched), Edit resends your question, and follow-ups remember the image.",
            "Readable math instead of raw LaTeX, plus code blocks with Copy and real tables.",
            "History keeps the image, mode and model, with search, reopen-and-continue, export, and a retention setting. It all stays on this Mac.",
            "Settings → AI: Test connection, an images/text-only badge, a Privacy summary and capture defaults. Retired models switch to a current one automatically.",
            "F1: pick a favourite team as well as a driver.",
        ]),
        ReleaseNote(version: "1.14.6", date: "2 October 2026", headline: "Sports", items: [
            "Follow your team (Barcelona by default): next match with a countdown, every competition, recent results and the live score beside the notch.",
            "Fixtures and scores for the big football leagues, the NBA, NFL, MLB and NHL.",
        ]),
        ReleaseNote(version: "1.14.5", date: "2 October 2026", headline: "F1 in the notch", items: [
            "The live running order during every session, then the full classification with gaps, tyres and lap times.",
            "The weekend schedule with a countdown, driver and team standings, and a followed driver beside the notch.",
        ]),
        ReleaseNote(version: "1.14.4", date: "1 October 2026", headline: "Updates that install", items: [
            "The Update button downloads, checks and installs the new version, then relaunches.",
        ]),
        ReleaseNote(version: "1.14.2", date: "1 October 2026", headline: "Get Pro", items: [
            "A product key for $1 in Litecoin (or $2 to cover fees and support the developer), or free with a promo code. Older access codes keep working.",
        ]),
        ReleaseNote(version: "1.14.1", date: "30 September 2026", headline: "Now Playing like the iPhone", items: [
            "Anything playing on your Mac with album art beside the notch and bars that move with the song; Charging with time to full.",
            "Sign in with Google to bring your setup and Pro to any Mac; iCloud sync and backup files.",
        ]),
        ReleaseNote(version: "1.14.0", date: "30 September 2026", headline: "22 new features", items: [
            "Timer, Snippets, Shortcuts, Devices, Live scores, Alerts, Plugins, Voice Notes, Screen Time and Quick Add.",
        ]),
    ]

    static var currentVersion: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }

    static var seenVersion: String {
        get { UserDefaults.standard.string(forKey: "whatsNew.seenVersion") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "whatsNew.seenVersion") }
    }

    /// True once after updating to a version that has notes.
    static var hasUnseen: Bool {
        !seenVersion.isEmpty && seenVersion != currentVersion && releases.contains { $0.version == currentVersion }
    }

    /// First launch ever: nothing to announce, just remember the version.
    static func noteLaunch() {
        if seenVersion.isEmpty { seenVersion = currentVersion; markOffered() }
    }

    // MARK: Offers after an update

    /// Optional things introduced in a release, offered once after updating. Only free, safe-to-try settings.
    static let offers: [(version: String, items: [NewFeatureOffer])] = [
        ("1.31.0", [
            NewFeatureOffer(id: "devtools", title: "Dev Tools tab", detail: "JSON, Base64, JWT, hashes, timestamps, regex and a QR code maker, right in the notch.", key: Module.devTools.storageKey),
            NewFeatureOffer(id: "wellbeing", title: "Wellbeing tab", detail: "Breathing, break reminders and a bedtime nudge.", key: Module.wellbeing.storageKey),
            NewFeatureOffer(id: "claudeflash", title: "Flash the screen when Claude Code needs you", detail: "A brief whole-screen colour flash along with the status dot.", key: "claudeCode.screenFlash"),
        ]),
        ("1.32.1", [
            NewFeatureOffer(id: "blackout", title: "⌥A blacks out the screen", detail: "Press Option+A to take the brightness to zero and again to bring it back. The key stops typing å while this is on.", key: "ui.brightnessBlackout", defaultOn: true),
        ]),
    ]

    private static var offeredVersion: String {
        get { UserDefaults.standard.string(forKey: "whatsNew.offeredVersion") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "whatsNew.offeredVersion") }
    }

    /// Offers newer than the last time the person was asked, up to this version.
    static func pendingOffers() -> [NewFeatureOffer] {
        let last = offeredVersion
        return offers.filter { VersionMath.isNewer($0.version, than: last.isEmpty ? "0" : last) && !VersionMath.isNewer($0.version, than: currentVersion) }
            .flatMap(\.items)
    }

    static func markOffered() { offeredVersion = currentVersion }

    static func markSeen() { seenVersion = currentVersion }
}

struct WhatsNewView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ForEach(WhatsNew.releases) { r in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("Notch apple \(r.version)").font(.headline)
                            if r.version == WhatsNew.currentVersion {
                                Text("This version").font(.caption.weight(.semibold)).foregroundStyle(Theme.accent)
                            }
                            Spacer()
                            Text(r.date).font(.caption).foregroundStyle(.secondary)
                        }
                        Text(r.headline).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        ForEach(r.items, id: \.self) { item in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text("•").foregroundStyle(.secondary)
                                Text(item).fixedSize(horizontal: false, vertical: true)
                            }
                            .font(.callout)
                        }
                    }
                    if r.id != WhatsNew.releases.last?.id { Divider() }
                }
                Link("All release notes on GitHub →", destination: URL(string: "https://github.com/AdityaJainDXB/NotchApples/releases")!)
                    .font(.callout)
            }
            .padding(20)
        }
        .onAppear { WhatsNew.markSeen() }
    }
}
