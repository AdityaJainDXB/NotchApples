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
