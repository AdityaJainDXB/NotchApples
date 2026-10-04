//
//  BrowserMedia.swift
//  Notch apple
//
//  Pro: control video and audio playing in Safari, Chrome, Arc, Brave or Edge
//  (YouTube, Netflix, podcasts on the web…): speed from 0.5× to 3×, skip
//  10 seconds and play/pause. It runs a tiny script in the front tab through
//  the browser's own AppleScript support, which needs two one-time switches:
//   • Safari: Settings → Advanced → Show features for web developers, then
//     Develop → Allow JavaScript from Apple Events.
//   • Chrome/Arc/Brave/Edge: View → Developer → Allow JavaScript from Apple Events.
//  plus macOS asking once to let Notch apple control that browser.
//  Apps without scripting (Apple Podcasts, Spotify) can't change speed.
//

import AppKit
import SwiftUI

@MainActor
enum BrowserMedia {
    static let speeds: [Double] = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]

    /// The browser to talk to: the front app if it's a supported browser, otherwise the first one running.
    private static var browser: (name: String, safari: Bool)? {
        let supported = ["com.apple.Safari": ("Safari", true), "com.google.Chrome": ("Google Chrome", false),
                         "company.thebrowser.Browser": ("Arc", false), "com.brave.Browser": ("Brave Browser", false),
                         "com.microsoft.edgemac": ("Microsoft Edge", false)]
        if let id = NSWorkspace.shared.frontmostApplication?.bundleIdentifier, let b = supported[id] { return (b.0, b.1) }
        for app in NSWorkspace.shared.runningApplications { if let id = app.bundleIdentifier, let b = supported[id] { return (b.0, b.1) } }
        return nil
    }

    /// Runs `body` against the playing (or first) video/audio element; returns its result or a reason.
    @discardableResult
    static func run(_ body: String) -> String {
        guard Entitlements.shared.canUse(.browserMedia) else { return "Needs Pro" }
        guard let b = browser else { return "Open Safari, Chrome, Arc, Brave or Edge first" }
        let js = "(()=>{const all=[...document.querySelectorAll('video,audio')];const m=all.find(v=>!v.paused)||all[0];if(!m)return 'none';\(body)})()"
        let escaped = js.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        let source = b.safari
            ? "tell application \"Safari\" to do JavaScript \"\(escaped)\" in current tab of front window"
            : "tell application \"\(b.name)\" to execute active tab of front window javascript \"\(escaped)\""
        var error: NSDictionary?
        let result = NSAppleScript(source: source)?.executeAndReturnError(&error)
        if let error {
            let message = error[NSAppleScript.errorMessage] as? String ?? ""
            if message.lowercased().contains("javascript") || message.lowercased().contains("allow") {
                return b.safari ? "Turn on Develop → Allow JavaScript from Apple Events in Safari"
                                : "Turn on View → Developer → Allow JavaScript from Apple Events in \(b.name)"
            }
            return "\(b.name) didn't respond (allow Notch apple in System Settings → Privacy & Security → Automation)"
        }
        let out = result?.stringValue ?? ""
        return out == "none" ? "No video or audio in the front tab" : out
    }

    static func setSpeed(_ rate: Double) -> String { run("m.playbackRate=\(rate);return m.playbackRate+'×'") }
    static func skip(_ seconds: Double) -> String { run("m.currentTime=Math.max(0,m.currentTime+(\(seconds)));return 'ok'") }
    static func togglePlay() -> String { run("if(m.paused){m.play()}else{m.pause()};return m.paused?'paused':'playing'") }
    static func currentSpeed() -> String { run("return m.playbackRate+'×'") }
}

/// Under Now Playing: speed and ±10 s for the browser tab (Pro).
struct BrowserMediaBar: View {
    @ObservedObject private var entitlements = Entitlements.shared
    @State private var status: String?

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "safari").foregroundStyle(Theme.textSecondary)
            if entitlements.canUse(.browserMedia) {
                IconButton(systemImage: "gobackward.10", help: "Back 10 seconds in the browser") { status = BrowserMedia.skip(-10) }
                IconButton(systemImage: "goforward.10", help: "Forward 10 seconds in the browser") { status = BrowserMedia.skip(10) }
                Menu {
                    ForEach(BrowserMedia.speeds, id: \.self) { s in Button("\(s.formatted())×") { status = BrowserMedia.setSpeed(s) } }
                } label: { Label(status?.hasSuffix("×") == true ? status! : "Speed", systemImage: "speedometer").font(.system(size: 11)) }
                .menuStyle(.borderlessButton).fixedSize()
                .help("Playback speed for the video or podcast in your browser")
                if let status, !status.hasSuffix("×"), status != "ok" {
                    Text(status).font(.system(size: 10)).foregroundStyle(.orange).lineLimit(2)
                }
            } else {
                TierBadge(tier: .pro)
                Text("Speed and skip for browser video").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
        }
        .help(Feature.browserMedia.benefit)
    }
}
