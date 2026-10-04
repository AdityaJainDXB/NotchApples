//
//  DemoHooks.swift
//  Notch apple
//
//  Drives the app for scripts/screenshots.sh. It only does anything in the
//  screenshot build (bundle ID com.notchapple.demo, with its own throwaway
//  data folder); in the real app every hook is ignored.
//
//  Launch arguments (all optional):
//    -openNotch <module>        open the notch on a tab (claude, f1, …)
//    -openSettings <pane>       open a Settings pane (claude, aiHistory, license, …)
//    -demoInput <file>          use an image or PDF as the AI input
//    -demoText <text>           use text as the AI input
//    -demoRun <mode>            run a mode on the input (solve, explain, code…)
//    -demoFollowUp <question>   ask a follow-up once the first answer is done
//    -demoOverlay <file>        show the capture overlay over this image (not the real screen)
//    -demoSelection x,y,w,h     with -demoOverlay, a selection in points from the top-left
//    -demoSportsDetail YES      open the details of your team's latest result
//    -demoOnboarding <1…4>      show the welcome window on that page
//    -demoAsk <question>        ask a question (add -demoWeb YES to search the web first)
//    -demoTodos "a|b|c"         add sample to-dos
//    -demoPalette <query>       open the command palette (Pro) with a search typed in
//    -demoTimer <seconds>       start a timer (shows beside the closed notch)
//    -demoActivity <query>      push a Live Activities API activity, e.g. "id=build&text=42%25&symbol=hammer.fill"
//

import AppKit
import Combine

@MainActor
enum DemoHooks {
    static var isDemo: Bool { Bundle.main.bundleIdentifier == "com.notchapple.demo" }

    private static var watcher: AnyCancellable?

    static func run() {
        guard isDemo else { return }
        let d = UserDefaults.standard
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            if d.integer(forKey: "demoOnboarding") > 0 { Onboarding.show() }
            if let todos = d.string(forKey: "demoTodos") {
                for t in todos.split(separator: "|").reversed() { TodoStore.shared.add(String(t)) }
                if let first = TodoStore.shared.items.last { TodoStore.shared.toggle(first) }
            }
            if let q = d.string(forKey: "demoPalette") {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { CommandPalette.toggle(query: q) }
            }
            if d.double(forKey: "demoTimer") > 0 { CountdownTimer.shared.startTimer(seconds: d.double(forKey: "demoTimer")) }
            if let q = d.string(forKey: "demoActivity"), let items = URLComponents(string: "x://y?" + q)?.queryItems {
                ExternalActivities.shared.handle(Dictionary(items.map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a }), end: false)
            }
            if let pane = d.string(forKey: "openSettings").flatMap(SettingsTab.init(rawValue:)) {
                AppDelegate.openSettingsWindow(tab: pane)
            }
            if let path = d.string(forKey: "demoOverlay"), let image = NSImage(contentsOfFile: path)?
                .cgImage(forProposedRect: nil, context: nil, hints: nil), let screen = NSScreen.main {
                let parts = (d.string(forKey: "demoSelection") ?? "").split(separator: ",").compactMap { Double($0) }
                let sel = parts.count == 4 ? NSRect(x: parts[0], y: screen.frame.height - parts[1] - parts[3], width: parts[2], height: parts[3]) : nil
                let window = RegionOverlayWindow(screen: screen, image: image, preset: sel) { _ in }
                NSApp.activate(ignoringOtherApps: true)
                window.makeKeyAndOrderFront(nil)
                overlay = window
            }
            let chat = ClaudeChatModel.shared
            if let path = d.string(forKey: "demoInput") { chat.load(file: URL(fileURLWithPath: path)) }
            if let text = d.string(forKey: "demoText") { chat.setTextInput(text, source: "Using the text you copied") }
            if d.bool(forKey: "demoSportsDetail") {
                DispatchQueue.main.asyncAfter(deadline: .now() + 7) {
                    if let m = SportsModel.shared.results.first { SportsModel.shared.openDetail(m) }
                }
            }
            if let tab = d.string(forKey: "openNotch").flatMap(Module.init(rawValue:)) { AppDelegate.showNotch(tab: tab) }
            if let q = d.string(forKey: "demoAsk") {
                chat.webSearch = d.bool(forKey: "demoWeb")
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { chat.send(q) }
            }
            if let mode = d.string(forKey: "demoRun").flatMap(AIMode.init(rawValue:)) {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { chat.run(mode) }
                if let follow = d.string(forKey: "demoFollowUp") {
                    var sawSending = false
                    watcher = chat.$isSending.sink { sending in
                        if sending { sawSending = true; return }
                        guard sawSending, chat.messages.count == 2 else { return }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { chat.send(follow) }
                    }
                }
            }
        }
    }

    private static var overlay: NSWindow?
}
