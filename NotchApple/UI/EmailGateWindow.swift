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
    private var activation: NSObjectProtocol?

    /// Starts watching the gate and checks it now. Call once at launch.
    func start() {
        cancellable = Entitlements.shared.$emailGate.receive(on: DispatchQueue.main).sink { [weak self] gate in
            if gate == nil { self?.close() } else { self?.show() }
        }
        // Coming back from reading the email brings the window back, so it is never lost behind the browser.
        activation = NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in if Entitlements.shared.emailGate != nil { self?.bringForward() } }
        }
        Task { await Entitlements.shared.checkEmailGate() }
    }

    /// Shows the window (or raises it). Called when the notch is opened while the gate is up.
    func bringForward() {
        guard Entitlements.shared.emailGate != nil else { return }
        show()
    }

    private func show() {
        if let window { NSApp.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil); return }
        let host = NSHostingController(rootView: EmailGateView())
        let w = NSWindow(contentViewController: host)
        w.title = "Notch Apple: set up your email"
        // No close or minimise button: the only way out is confirming the email. A normal window level, so the browser can still be
        // opened on top of it to read the code.
        w.styleMask = [.titled]
        w.isReleasedWhenClosed = false
        w.hidesOnDeactivate = false
        w.collectionBehavior = [.fullScreenAuxiliary, .moveToActiveSpace]
        w.center()
        window = w
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
    }

    private func close() { window?.close(); window = nil }
}

/// The "Please set up your email" content for the window. It has no Cancel: the notch stays locked until this is done.
struct EmailGateContent: View {
    @ObservedObject private var entitlements = Entitlements.shared

    var body: some View {
        HStack(alignment: .top, spacing: 18) {
            ZStack {
                Circle().fill(Theme.accentGradient).frame(width: 56, height: 56)
                Image(systemName: "envelope.badge.shield.half.filled").font(.system(size: 24, weight: .bold)).foregroundStyle(.white)
            }
            VStack(alignment: .leading, spacing: 12) {
                Text("Please set up your email").font(.system(size: 20, weight: .bold)).foregroundStyle(.white)
                Text("Your \(entitlements.tier.name) key now belongs to one email address, so a key that leaks can't be used by anyone else. Confirm your email with a code to keep using Notch Apple. It takes a minute and you only do it once.")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                if let gate = entitlements.emailGate {
                    VerifyKeyView(key: gate.key, bound: gate.bound, hint: gate.hint, onDone: {}, onCancel: nil, remember: true)
                }
                Text("This window stays open while you check your email. Open your email in your browser, copy the code, and come back here.")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            .frame(width: 420, alignment: .leading)
        }
    }
}

private struct EmailGateView: View {
    var body: some View {
        EmailGateContent()
            .padding(24)
            .background(Color(white: 0.09))
            .preferredColorScheme(.dark)
    }
}

/// What the notch shows while the email is not set up: no form (the form lives in the window, which does not disappear when the
/// notch closes), only a pointer to it.
struct EmailGateNotchView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "envelope.badge.shield.half.filled").font(.system(size: 30)).foregroundStyle(Theme.accentGradient)
            Text("Please set up your email").font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
            Text("Finish in the window that opened. It stays open while you check your email.")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
            Button("Show the window") { EmailGateWindow.shared.bringForward() }.buttonStyle(PurpleButtonStyle())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { EmailGateWindow.shared.bringForward() }
    }
}
