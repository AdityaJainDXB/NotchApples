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
    static func noteLaunch() { if seenVersion.isEmpty { seenVersion = currentVersion } }

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
