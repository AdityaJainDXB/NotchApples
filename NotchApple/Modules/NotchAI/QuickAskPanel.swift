//
//  QuickAskPanel.swift
//  Notch Apple
//
//  The small panel that opens when you click the green dot: a streamed chat, through the
//  provider and model already chosen in Settings → AI (AIConfig), shared with the NotchAI tab (NotchAIConversation). Free tier: text only, no screen capture.
//  The dot shows "thinking" while an answer is coming. Esc or clicking elsewhere closes it.
//

import AppKit
import QuartzCore
import SwiftUI

@MainActor
enum QuickAskPanel {
    private static var panel: NSPanel?

    /// When the panel last closed because it lost focus (not by Esc or the dot).
    private static var lastFocusLossClose: TimeInterval?

    static func toggle(near point: CGPoint) {
        if panel != nil { close(); return }
        if QuickAskRule.shouldOpen(isOpen: false, lastFocusLossClose: lastFocusLossClose, now: CACurrentMediaTime()) { show(near: point) }
    }

    /// Called by the panel when it stops being the key window.
    fileprivate static func closeForFocusLoss() {
        guard panel != nil else { return }
        lastFocusLossClose = CACurrentMediaTime()
        close()
    }

    static func show(near point: CGPoint) {
        close()
        lastFocusLossClose = nil
        let size = CGSize(width: 380, height: 340)
        let screen = NSScreen.screens.first { $0.frame.contains(point) } ?? NSScreen.main
        let vis = screen?.visibleFrame ?? CGRect(origin: .zero, size: size)
        var o = CGPoint(x: point.x + 18, y: point.y - size.height - 12)
        o.x = min(max(o.x, vis.minX + 8), vis.maxX - size.width - 8)
        if o.y < vis.minY + 8 { o.y = min(point.y + 30, vis.maxY - size.height - 8) }
        let p = AskPanel(contentRect: CGRect(origin: o, size: size), styleMask: [.borderless, .nonactivatingPanel],
                         backing: .buffered, defer: false)
        p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = true
        p.level = .screenSaver + 1
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.isReleasedWhenClosed = false
        p.hidesOnDeactivate = false
        p.contentView = NSHostingView(rootView: QuickAskView(close: { close() }, openFull: {
            close(); NotchAINav.shared.section = .chat; CursorCompanion.shared.openNotchAI()
        }))
        panel = p
        p.makeKeyAndOrderFront(nil)
    }

    static func close() {
        CursorCompanion.shared.setState(.idle)
        panel?.orderOut(nil)
        panel = nil
    }
}

private final class AskPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { QuickAskPanel.close() }
    override func resignKey() { super.resignKey(); QuickAskPanel.closeForFocusLoss() }
}

private struct QuickAskView: View {
    let close: () -> Void
    let openFull: () -> Void
    @ObservedObject private var config = AIConfig.shared

    private let green = Color(red: 0x22 / 255, green: 0xC5 / 255, blue: 0x5E / 255)

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle().fill(green).frame(width: 8, height: 8).shadow(color: green, radius: 4)
                Text("NotchAI").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                Spacer()
                Label("\(config.provider.title) · \(config.model)", systemImage: ModelLocality.of(provider: config.provider, model: config.model).symbol)
                    .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                Button(action: openFull) { Image(systemName: "arrow.up.forward.square") }.buttonStyle(MetalPlainStyle())
                    .help("Continue in NotchAI").foregroundStyle(.white)
            }
            NotchAIConversationView(compact: true)
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(green.opacity(0.35), lineWidth: 1))
        .padding(4)
        .environment(\.colorScheme, .dark)
    }
}
