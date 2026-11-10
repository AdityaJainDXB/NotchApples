//
//  ShareView.swift
//  Notch Apple
//
//  Share is AirDrop, for files only: drop files on the card or choose them, and the system's AirDrop
//  picker does the rest (`NSSharingService`).
//

import SwiftUI
import UniformTypeIdentifiers

struct ShareView: View {
    var body: some View {
        AirDropCard().frame(maxWidth: 420)
            .frame(maxWidth: .infinity)
    }
}

// MARK: AirDrop

/// Sends through the system's AirDrop service and reports what happened. The notch is a non-activating panel, so
/// the app is brought forward first (AirDrop's own window won't appear for a background app), and any failure is
/// shown instead of silently doing nothing.
@MainActor
final class AirDropSender: NSObject, ObservableObject, NSSharingServiceDelegate {
    static let shared = AirDropSender()
    @Published var status: String?
    @Published var canFallback = false

    /// Real, key-able window the share service anchors to. AirDrop refuses to show its picker when the only
    /// window is the notch's non-activating panel, which is why sending used to do nothing.
    private var anchor: NSWindow?
    private var service: NSSharingService?
    private var staged: [URL] = []

    private final class AnchorWindow: NSWindow {
        override var canBecomeKey: Bool { true }
        override var canBecomeMain: Bool { true }
    }

    func send(_ items: [Any]) {
        guard !items.isEmpty else { return }
        guard let service = NSSharingService(named: .sendViaAirDrop) else {
            status = "AirDrop isn't available on this Mac."
            return
        }
        guard service.canPerform(withItems: items) else {
            status = "AirDrop can't send that. Turn on Wi-Fi and Bluetooth, and set AirDrop to Contacts Only or Everyone in Finder."
            canFallback = true
            staged = items.compactMap { $0 as? URL }
            return
        }
        staged = items.compactMap { $0 as? URL }
        service.delegate = self
        self.service = service
        status = "Choose who to send it to…"
        canFallback = !staged.isEmpty
        showAnchor()
        service.perform(withItems: items)
    }

    /// Backup route: opens Finder's own AirDrop window and shows the files, so they can be dragged onto a person.
    func openAirDropWindow() {
        let finderAirDrop = URL(fileURLWithPath: "/System/Library/CoreServices/Finder.app/Contents/Applications/AirDrop.app")
        NSWorkspace.shared.open(finderAirDrop)
        if !staged.isEmpty { NSWorkspace.shared.activateFileViewerSelecting(staged) }
        status = "Drag the selected files onto a person in the AirDrop window."
    }

    private func showAnchor() {
        hideAnchor()
        // Below the notch, so on the screen the notch is on, which isn't always the focused one.
        guard let screen = DisplayLayouts.currentScreen ?? NSScreen.main ?? NSScreen.screens.first else { return }
        let size = NSSize(width: 260, height: 24)
        let origin = NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY - 80)
        let w = AnchorWindow(contentRect: NSRect(origin: origin, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        w.isOpaque = false
        w.backgroundColor = .clear
        w.hasShadow = false
        w.level = .floating
        w.ignoresMouseEvents = true
        w.isReleasedWhenClosed = false
        anchor = w
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
    }

    private func hideAnchor() { anchor?.orderOut(nil); anchor = nil }

    nonisolated func sharingService(_ service: NSSharingService, sourceWindowForShareItems items: [Any], sharingContentScope: UnsafeMutablePointer<NSSharingService.SharingContentScope>) -> NSWindow? {
        MainActor.assumeIsolated { anchor }
    }

    nonisolated func sharingService(_ service: NSSharingService, sourceFrameOnScreenForShareItem item: Any) -> NSRect {
        MainActor.assumeIsolated { anchor?.frame ?? .zero }
    }

    nonisolated func sharingService(_ service: NSSharingService, willShareItems items: [Any]) {
        Task { @MainActor in self.status = "Sending…" }
    }

    nonisolated func sharingService(_ service: NSSharingService, didShareItems items: [Any]) {
        Task { @MainActor in self.status = "Sent."; self.canFallback = false; self.hideAnchor() }
    }

    nonisolated func sharingService(_ service: NSSharingService, didFailToShareItems items: [Any], error: Error) {
        let ns = error as NSError
        // Closing AirDrop's window without choosing anyone is not a failure.
        Task { @MainActor in
            self.hideAnchor()
            if ns.code == NSUserCancelledError { self.status = nil; self.canFallback = false }
            else { self.status = "AirDrop failed: \(error.localizedDescription)"; self.canFallback = true }
        }
    }
}

private struct AirDropCard: View {
    @StateObject private var sender = AirDropSender.shared
    @State private var targeted = false

    var body: some View {
        GlassCard {
            VStack(spacing: 10) {
                HStack {
                    Text("AirDrop").sectionTitle()
                    Spacer()
                }
                VStack(spacing: 10) {
                    ZStack {
                        Circle().fill(Theme.accentGradient.opacity(targeted ? 0.9 : 0.35)).frame(width: 84, height: 84).scaleEffect(targeted ? 1.08 : 1)
                        Image(systemName: "airplayaudio").font(.system(size: 30)).foregroundStyle(.white)
                    }
                    .animation(Theme.spring, value: targeted)
                    .accessibilityLabel("AirDrop drop zone")
                    Text("Drop files anywhere on this card").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    Button("Choose files…") { pickFiles { sender.send($0) } }.buttonStyle(PurpleButtonStyle(prominent: false))
                    Text("Tip: pin the notch (the pin in the header) so it stays open while you drag from Finder.")
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
                }
                if let status = sender.status {
                    Text(status).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center).lineLimit(3)
                }
                if sender.canFallback {
                    Button("Open AirDrop window instead") { sender.openAirDropWindow() }.buttonStyle(PurpleButtonStyle(prominent: false))
                }
                Spacer(minLength: 0)
            }
        }
        // The whole card takes a drop, not just the circle (a drop that missed the circle used to do nothing).
        .magneticDrop(of: [.fileURL], label: "Let go to share", isTargeted: $targeted) { providers in
            loadURLs(providers) { urls in sender.send(urls) }
            return true
        }
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.accentBright, lineWidth: targeted ? 2 : 0))
    }
}

// MARK: Helpers

private func pickFiles(_ completion: @escaping ([URL]) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = true
    panel.canChooseDirectories = false     // files only
    NSApp.activate(ignoringOtherApps: true)
    if panel.runModal() == .OK { completion(panel.urls) }
}

/// Reads dropped files in a way that works for Finder, the Desktop and other apps: it asks for the file URL itself,
/// then turns any file-reference form (file:///.file/id=…) into a normal path, which AirDrop needs.
private func loadURLs(_ providers: [NSItemProvider], _ completion: @escaping ([URL]) -> Void) {
    let group = DispatchGroup()
    var urls: [URL] = []
    let lock = NSLock()
    for p in providers where p.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
        group.enter()
        p.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
            var url: URL?
            if let data = item as? Data { url = URL(dataRepresentation: data, relativeTo: nil) }
            else if let u = item as? URL { url = u }
            else if let str = item as? String { url = URL(string: str) }
            if let url, let resolved = (url as NSURL).filePathURL { lock.lock(); urls.append(resolved.standardizedFileURL); lock.unlock() }
            group.leave()
        }
    }
    group.notify(queue: .main) { completion(urls) }
}
