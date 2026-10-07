//
//  FullScreenLyrics.swift
//  Notch apple
//
//  Lyrics on the whole screen (Pro), like a karaoke wall: big lines, the current one bright, scrolling with the
//  song. You open it from the lyrics panel or the command palette, and close it with Esc or a click. It only
//  shows what the lyrics panel already has; nothing extra is fetched.
//

import AppKit
import SwiftUI

@MainActor
enum FullScreenLyrics {
    private static var window: NSWindow?
    static var isOpen: Bool { window != nil }

    static func toggle() {
        if window != nil { close(); return }
        guard Entitlements.shared.canUse(.lyrics) else { return }
        let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens[0]
        let w = LyricsWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false, screen: screen)
        w.isOpaque = false
        w.backgroundColor = .clear
        w.hasShadow = false
        w.level = .floating
        w.isReleasedWhenClosed = false
        w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        w.contentView = NSHostingView(rootView: FullScreenLyricsView(close: { close() }))
        window = w
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
    }

    static func close() {
        LyricsModel.shared.stop()
        window?.orderOut(nil)
        window = nil
    }
}

private final class LyricsWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { FullScreenLyrics.close() }   // Esc
}

private struct FullScreenLyricsView: View {
    let close: () -> Void
    @StateObject private var lyrics = LyricsModel.shared
    @ObservedObject private var monitor = NowPlayingMonitor.shared

    var body: some View {
        ZStack {
            Color.black.opacity(0.92).ignoresSafeArea()
            VStack(spacing: 18) {
                if let now = monitor.current, !now.title.isEmpty {
                    VStack(spacing: 2) {
                        Text(now.title).font(.system(size: 22, weight: .semibold)).foregroundStyle(.white)
                        if !now.artist.isEmpty { Text(now.artist).font(.system(size: 15)).foregroundStyle(.white.opacity(0.6)) }
                    }
                    .padding(.top, 40)
                }
                if !lyrics.lines.isEmpty {
                    let current = lyrics.currentIndex ?? -1
                    ScrollViewReader { proxy in
                        ScrollView(showsIndicators: false) {
                            VStack(spacing: 18) {
                                Spacer(minLength: 180)
                                ForEach(Array(lyrics.lines.enumerated()), id: \.offset) { n, line in
                                    Text(line.text.isEmpty ? "♪" : line.text)
                                        .font(.system(size: n == current ? 46 : 32, weight: n == current ? .bold : .medium, design: .rounded))
                                        .foregroundStyle(n == current ? .white : .white.opacity(0.35))
                                        .multilineTextAlignment(.center)
                                        .frame(maxWidth: 1000)
                                        .id(n)
                                }
                                Spacer(minLength: 260)
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .onChange(of: current) { _, n in withAnimation(.easeInOut(duration: 0.5)) { proxy.scrollTo(max(n, 0), anchor: .center) } }
                    }
                } else if let plain = lyrics.plain {
                    ScrollView { Text(plain).font(.system(size: 26, weight: .medium, design: .rounded)).foregroundStyle(.white.opacity(0.85)).multilineTextAlignment(.center).frame(maxWidth: 900).padding(.vertical, 40) }
                } else {
                    Spacer()
                    Text(lyrics.status.isEmpty ? "Play a song to see its lyrics." : lyrics.status).font(.system(size: 22)).foregroundStyle(.white.opacity(0.6))
                    Spacer()
                }
                Text("Esc or click to close").font(.system(size: 12)).foregroundStyle(.white.opacity(0.35)).padding(.bottom, 20)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: close)
        .preferredColorScheme(.dark)
        .onAppear { lyrics.start() }
    }
}
