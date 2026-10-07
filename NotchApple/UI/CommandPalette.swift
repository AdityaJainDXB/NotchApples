//
//  CommandPalette.swift
//  Notch apple
//
//  Command palette (Pro, ⌃⌥P): one box to search and run everything Notch apple
//  can do: open a tab, start a timer, paste a snippet, run a saved prompt, open
//  an app or a Settings pane, or just ask the AI. ↑↓ to choose, Return to run,
//  Esc to close. Fully keyboard-driven.
//

import AppKit
import SwiftUI

struct PaletteCommand: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let symbol: String
    let run: () -> Void
}

@MainActor
enum CommandPalette {
    private static var panel: NSPanel?

    static func toggle(query: String = "") {
        if let panel, panel.isVisible { close(); return }
        guard Entitlements.shared.canUse(.commandPalette) else { return }
        let p = PalettePanel(contentRect: NSRect(x: 0, y: 0, width: 620, height: 420), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isOpaque = false
        p.backgroundColor = .clear
        p.level = .modalPanel
        p.hasShadow = true
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.contentView = NSHostingView(rootView: PaletteView(query: query) { close() })
        if let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }) ?? NSScreen.main {
            p.setFrameOrigin(NSPoint(x: screen.frame.midX - 310, y: screen.frame.maxY - screen.frame.height * 0.28 - 420))
        }
        panel = p
        NSApp.activate(ignoringOtherApps: true)
        p.makeKeyAndOrderFront(nil)
    }

    static func close() {
        panel?.orderOut(nil)
        panel = nil
    }

    /// Everything the palette can do, built fresh each time it opens.
    static func commands() -> [PaletteCommand] {
        var list: [PaletteCommand] = []
        let notch = AppDelegate.current?.notch
        for tab in SettingsManager.shared.enabledTabs {
            list.append(PaletteCommand(title: "Open \(tab.title)", subtitle: "Tab", symbol: tab.symbol) { AppDelegate.showNotch(tab: tab) })
        }
        list += [
            PaletteCommand(title: "Timer for 5 minutes", subtitle: "Timer", symbol: "timer") { CountdownTimer.shared.startTimer(seconds: 300) },
            PaletteCommand(title: "Timer for 25 minutes", subtitle: "Timer", symbol: "timer") { CountdownTimer.shared.startTimer(seconds: 1500) },
            PaletteCommand(title: "Start stopwatch", subtitle: "Timer", symbol: "stopwatch") { CountdownTimer.shared.startStopwatch() },
            PaletteCommand(title: "Keep awake for an hour", subtitle: "Tools", symbol: "cup.and.saucer.fill") { KeepAwake.shared.start(minutes: 60) },
            PaletteCommand(title: "Stop keeping awake", subtitle: "Tools", symbol: "cup.and.saucer") { KeepAwake.shared.stop() },
            PaletteCommand(title: "Copy text from the screen", subtitle: "Tools", symbol: "text.viewfinder") { TextGrab.shared.grab {} },
            PaletteCommand(title: "Take a screenshot", subtitle: "Tools", symbol: "camera.viewfinder") { ScreenCaptureActions.shared.takeScreenshot() },
            PaletteCommand(title: "Start or stop screen recording", subtitle: "Tools", symbol: "record.circle") { ScreenRecorder.shared.toggle() },
            PaletteCommand(title: "Ruler", subtitle: "Tools · Pro", symbol: "ruler") { ScreenRuler.show() },
            PaletteCommand(title: "Mark up part of the screen", subtitle: "Tools · Pro", symbol: "pencil.tip.crop.circle") { ScreenMarkup.captureAndMarkUp() },
            PaletteCommand(title: "Ask AI about part of the screen", subtitle: "AI · Pro", symbol: "sparkles") { CaptureManager.shared.captureToAI() },
            PaletteCommand(title: "Browser video: 1.5× speed", subtitle: "Media · Pro", symbol: "speedometer") { BrowserMedia.setSpeed(1.5) },
            PaletteCommand(title: "Browser video: normal speed", subtitle: "Media · Pro", symbol: "speedometer") { BrowserMedia.setSpeed(1) },
            PaletteCommand(title: "Browser video: back 10 seconds", subtitle: "Media · Pro", symbol: "gobackward.10") { BrowserMedia.skip(-10) },
            PaletteCommand(title: "Browser video: forward 10 seconds", subtitle: "Media · Pro", symbol: "goforward.10") { BrowserMedia.skip(10) },
            PaletteCommand(title: DNDToggle.isOn ? "Turn Do Not Disturb off" : "Turn Do Not Disturb on", subtitle: "System · Pro", symbol: "moon") { DNDToggle.toggle() },
            PaletteCommand(title: DarkModeToggle.isDark ? "Switch to light mode" : "Switch to dark mode", subtitle: "System", symbol: DarkModeToggle.isDark ? "sun.max" : "moon.stars") { DarkModeToggle.toggle() },
            PaletteCommand(title: MicMute.shared.isMuted ? "Unmute microphone" : "Mute microphone", subtitle: "System · Pro", symbol: "mic.slash") { MicMute.shared.toggle() },
            PaletteCommand(title: "Full-screen lyrics", subtitle: "Media · Pro", symbol: "text.quote") { FullScreenLyrics.toggle() },
            PaletteCommand(title: "Hide the notch", subtitle: "Notch", symbol: "eye.slash") { notch?.setInvisible(true) },
            PaletteCommand(title: "Show the notch", subtitle: "Notch", symbol: "eye") { notch?.setInvisible(false) },
        ]
        for s in SnippetStore.shared.items {
            list.append(PaletteCommand(title: "Paste \(s.title)", subtitle: "Snippet" + (s.abbreviation.map { " · \($0)" } ?? ""), symbol: "text.quote") { PasteHelper.paste(s.text) })
        }
        for p in AIExtras.shared.prompts where Entitlements.shared.canUse(.personas) {
            list.append(PaletteCommand(title: p.title, subtitle: "Saved prompt", symbol: "text.badge.star") {
                AppDelegate.showNotch(tab: .claude)
                ClaudeChatModel.shared.draft = p.text
                if !p.text.hasSuffix(" ") && !p.text.hasSuffix(":") { ClaudeChatModel.shared.send() }
            })
        }
        for tab in SettingsTab.allCases {
            list.append(PaletteCommand(title: "Settings: \(tab.title)", subtitle: "Settings", symbol: tab.symbol) { AppDelegate.openSettingsWindow(tab: tab) })
        }
        for app in installedApps {
            list.append(PaletteCommand(title: "Open \(app.deletingPathExtension().lastPathComponent)", subtitle: "App", symbol: "app") {
                NSWorkspace.shared.openApplication(at: app, configuration: .init())
            })
        }
        return list
    }

    /// Apps in /Applications and ~/Applications, read once.
    private static let installedApps: [URL] = {
        let fm = FileManager.default
        // The screenshot build lists only macOS's own apps, so nobody's installed apps end up in screenshots.
        let dirs = Bundle.main.bundleIdentifier == "com.notchapple.demo" ? [URL(fileURLWithPath: "/System/Applications")]
            : [URL(fileURLWithPath: "/Applications"), URL(fileURLWithPath: "/System/Applications"), fm.homeDirectoryForCurrentUser.appendingPathComponent("Applications")]
        return dirs.flatMap { (try? fm.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil)) ?? [] }
            .filter { $0.pathExtension == "app" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }()

    /// Fuzzy score: every query letter appears in order; earlier, contiguous and word-start matches score higher.
    static func score(_ title: String, _ query: String) -> Int? {
        let q = query.lowercased().filter { !$0.isWhitespace }, t = title.lowercased()
        guard !q.isEmpty else { return 0 }
        var score = 0, ti = t.startIndex, last: String.Index?
        for c in q {
            guard let found = t[ti...].firstIndex(of: c) else { return nil }
            score += 10
            if let last, t.index(after: last) == found { score += 8 }
            if found == t.startIndex || t[t.index(before: found)] == " " { score += 6 }
            score -= t.distance(from: ti, to: found)
            last = found
            ti = t.index(after: found)
        }
        if t.hasPrefix(query.lowercased()) { score += 30 }
        return score
    }
}

private final class PalettePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override func resignKey() { super.resignKey(); CommandPalette.close() }
}

private struct PaletteView: View {
    @State var query = ""
    let close: () -> Void
    @State private var selected = 0
    @FocusState private var focused: Bool
    private let all = CommandPalette.commands()

    private var results: [PaletteCommand] {
        var scored = all.compactMap { c in CommandPalette.score(c.title, query).map { (c, $0) } }
            .sorted { $0.1 > $1.1 }.prefix(9).map(\.0)
        if let word = EmojiLogic.trigger(query) {
            // "emoji heart" or ":fire": matching emoji and symbols; Return copies the highlighted one.
            let rows = EmojiLogic.search(word, limit: 9).map { e in
                PaletteCommand(title: e.title, subtitle: "Emoji · Return copies it", symbol: "face.smiling") {
                    NSPasteboard.general.clearContents(); NSPasteboard.general.setString(e.emoji, forType: .string)
                }
            }
            return rows.isEmpty ? [PaletteCommand(title: "No emoji for “\(word)”", subtitle: "Try another word", symbol: "face.dashed") {}] : rows
        }
        if let a = QuickAnswerLogic.answer(query) {
            scored.insert(PaletteCommand(title: a.text, subtitle: "Answer · Return copies it", symbol: "equal.circle.fill") {
                NSPasteboard.general.clearContents(); NSPasteboard.general.setString(a.copy, forType: .string)
            }, at: 0)
        }
        if !query.trimmingCharacters(in: .whitespaces).isEmpty {
            let q = query
            scored.append(PaletteCommand(title: "Ask AI: \(q)", subtitle: "AI", symbol: "sparkles") {
                AppDelegate.showNotch(tab: .claude)
                ClaudeChatModel.shared.send(q)
            })
        }
        return scored
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "command").foregroundStyle(Theme.accent)
                TextField("Search actions, tabs, snippets, apps, “emoji heart”, or ask AI…", text: $query)
                    .textFieldStyle(.plain).font(.system(size: 18)).focused($focused)
                    .onSubmit(runSelected)
                    .onChange(of: query) { _, _ in selected = 0 }
            }
            .padding(16)
            Divider().overlay(Theme.separator)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(Array(results.enumerated()), id: \.element.id) { i, c in
                            HStack(spacing: 10) {
                                Image(systemName: c.symbol).frame(width: 22).foregroundStyle(i == selected ? .white : Theme.accentBright)
                                Text(c.title).foregroundStyle(.white).lineLimit(1)
                                Spacer()
                                Text(c.subtitle).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(RoundedRectangle(cornerRadius: 8).fill(i == selected ? Theme.accent.opacity(0.45) : .clear))
                            .contentShape(Rectangle())
                            .onTapGesture { selected = i; runSelected() }
                            .id(i)
                            .accessibilityAddTraits(i == selected ? .isSelected : [])
                        }
                    }
                    .padding(8)
                }
                .onChange(of: selected) { _, s in proxy.scrollTo(s) }
            }
        }
        .frame(width: 620, height: 420)
        .background(Theme.backdrop, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.separator))
        .preferredColorScheme(.dark)
        .onAppear { focused = true }
        .onKeyPress(.downArrow) { selected = min(selected + 1, max(results.count - 1, 0)); return .handled }
        .onKeyPress(.upArrow) { selected = max(selected - 1, 0); return .handled }
        .onExitCommand(perform: close)
    }

    private func runSelected() {
        let r = results
        guard r.indices.contains(selected) else { return }
        close()
        r[selected].run()
    }
}
