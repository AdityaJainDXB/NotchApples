//
//  EmailGateWindow.swift
//  Notch Apple
//
//  After the update that ties each key to one email, a Mac whose key has no email yet sees this: "Please set up your email".
//  It appears at launch (before the notch is used for paid features) and is done once. "Not now" closes it; paid features stay
//  locked until the email is confirmed, free features are never affected.
//

import SwiftUI
import AppKit
import Combine

@MainActor
final class EmailGateWindow {
    static let shared = EmailGateWindow()
    private var window: NSWindow?
    private var cancellable: AnyCancellable?

    /// Starts watching the gate and checks it now. Call once at launch.
    func start() {
        cancellable = Entitlements.shared.$emailGate.receive(on: DispatchQueue.main).sink { [weak self] gate in
            if gate == nil { self?.close() } else { self?.show() }
        }
        Task { await Entitlements.shared.checkEmailGate() }
    }

    private func show() {
        if let window { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }
        let host = NSHostingController(rootView: EmailGateView(onClose: { [weak self] in self?.close() }))
        let w = NSWindow(contentViewController: host)
        w.title = "Notch Apple"
        w.styleMask = [.titled, .closable]
        w.isReleasedWhenClosed = false
        w.level = .floating
        w.center()
        window = w
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
    }

    private func close() { window?.close(); window = nil }
}

private struct EmailGateView: View {
    @ObservedObject private var entitlements = Entitlements.shared
    var onClose: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 18) {
            ZStack {
                Circle().fill(Theme.accentGradient).frame(width: 56, height: 56)
                Image(systemName: "envelope.badge.shield.half.filled").font(.system(size: 24, weight: .bold)).foregroundStyle(.white)
            }
            VStack(alignment: .leading, spacing: 12) {
                Text("Please set up your email").font(.system(size: 20, weight: .bold)).foregroundStyle(.white)
                Text("Your \(entitlements.tier.name) key now belongs to one email address, so a key that leaks can't be used by anyone else. Confirm your email with a code to keep using your paid features. It takes a minute and you only do it once.")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                if let gate = entitlements.emailGate {
                    VerifyKeyView(key: gate.key, bound: gate.bound, hint: gate.hint, onDone: onClose, onCancel: onClose)
                }
                Text("Free features keep working either way. \"Cancel\" leaves your paid features locked until this is done.")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            .frame(width: 420, alignment: .leading)
        }
        .padding(24)
        .background(Color(white: 0.09))
        .preferredColorScheme(.dark)
    }
}
