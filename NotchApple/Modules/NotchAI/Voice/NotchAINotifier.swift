//
//  NotchAINotifier.swift
//  Notch Apple
//
//  Tells the user when a task finishes, fails or needs approval: a system notification (macOS Focus decides whether it
//  is delivered), an optional chime and an optional spoken line. Chimes and speech are held back in quiet mode (on a
//  call, or switched on). All three are off until the user turns them on in the Voice section. Also the live captions:
//  while NotchAI speaks, the sentence being spoken shows at the bottom of the screen.
//

import AppKit
import Combine
import SwiftUI
import UserNotifications

@MainActor
final class NotchAINotifier: ObservableObject {
    static let shared = NotchAINotifier()

    @AppStorage("notchai.notify.on") var notify = false { willSet { objectWillChange.send() } }
    @AppStorage("notchai.notify.chime") var chime = false { willSet { objectWillChange.send() } }
    @AppStorage("notchai.notify.speak") var speak = false { willSet { objectWillChange.send() } }
    @AppStorage("notchai.notify.quiet") var quietManual = false { willSet { objectWillChange.send() } }
    @AppStorage("notchai.voice.captions") var captions = true { willSet { objectWillChange.send() } }

    var isQuiet: Bool { NotchAIQuietLogic.isQuiet(manual: quietManual, frontmostBundleID: NSWorkspace.shared.frontmostApplication?.bundleIdentifier) }

    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { _, _ in }
    }

    /// Called by the task store when a task changes state.
    func taskChanged(title: String, from old: TaskState?, to new: TaskState) {
        guard old != new, let text = NotchAIQuietLogic.announcement(title: title, state: new) else { return }
        if NotchAIQuietLogic.shouldNotify(enabled: notify) {
            let c = UNMutableNotificationContent()
            c.title = "NotchAI"; c.body = text
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
        }
        if NotchAIQuietLogic.shouldChime(enabled: chime, quiet: isQuiet) { NSSound(named: "Glass")?.play() }
        if NotchAIQuietLogic.shouldSpeakUpdate(enabled: speak, quiet: isQuiet) { try? NotchAIVoice.shared.speakText(text) }
    }
}

/// The caption bar: the words being spoken, at the bottom of the screen, only while NotchAI speaks.
@MainActor
final class CaptionOverlay {
    static let shared = CaptionOverlay()
    private var panel: NSPanel?
    private var bag = Set<AnyCancellable>()

    func start() {
        let v = NotchAIVoice.shared
        Publishers.CombineLatest(v.$state, v.$caption).receive(on: RunLoop.main).sink { [weak self] state, caption in
            MainActor.assumeIsolated { self?.update(show: state == .speaking && !caption.isEmpty && NotchAINotifier.shared.captions, text: caption) }
        }.store(in: &bag)
    }

    private func update(show: Bool, text: String) {
        guard show else { panel?.orderOut(nil); panel = nil; return }
        guard let screen = NSScreen.main else { return }
        let size = CGSize(width: min(760, screen.frame.width - 80), height: 90)
        if panel == nil {
            let p = NSPanel(contentRect: CGRect(x: screen.frame.midX - size.width / 2, y: screen.frame.minY + 90, width: size.width, height: size.height),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = true
            p.level = .statusBar; p.ignoresMouseEvents = true
            p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            p.isReleasedWhenClosed = false
            panel = p
        }
        panel?.contentView = NSHostingView(rootView: Text(text).font(.system(size: 18, weight: .medium)).foregroundStyle(.white).multilineTextAlignment(.center)
            .lineLimit(3).padding(.horizontal, 18).padding(.vertical, 10).frame(width: size.width)
            .background(.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 14, style: .continuous)))
        panel?.orderFrontRegardless()
    }
}
