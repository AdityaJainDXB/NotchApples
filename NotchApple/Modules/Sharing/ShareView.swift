//
//  ShareView.swift
//  Notch apple
//
//  Two ways to share: Apple AirDrop via `NSSharingService`, and PairDrop for
//  local sharing with a 6-digit code.
//
//  PairDrop has two clear modes:
//   • Receive — shows your code. Read it out to the sender. That's it.
//   • Send    — type the other device's code and pick files. No need to pick
//               a device; the right one is found automatically.
//

import SwiftUI
import UniformTypeIdentifiers

struct ShareView: View {
    @StateObject private var pairDrop = PairDropService.shared

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AirDropCard().frame(width: 250)
            PairDropCard(pairDrop: pairDrop)
        }
        .onAppear { pairDrop.start() }
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

    func send(_ items: [Any]) {
        guard !items.isEmpty else { return }
        guard let service = NSSharingService(named: .sendViaAirDrop) else {
            status = "AirDrop isn't available on this Mac."
            return
        }
        service.delegate = self
        guard service.canPerform(withItems: items) else {
            status = "AirDrop can't send that. Turn on Wi-Fi and Bluetooth, and set AirDrop to Contacts Only or Everyone in Finder."
            return
        }
        status = "Choose who to send it to…"
        NSApp.activate(ignoringOtherApps: true)
        service.perform(withItems: items)
    }

    nonisolated func sharingService(_ service: NSSharingService, didShareItems items: [Any]) {
        Task { @MainActor in self.status = "Sent." }
    }

    nonisolated func sharingService(_ service: NSSharingService, didFailToShareItems items: [Any], error: Error) {
        let ns = error as NSError
        // Closing AirDrop's window without choosing anyone is not a failure.
        Task { @MainActor in self.status = ns.code == NSUserCancelledError ? nil : "AirDrop failed: \(error.localizedDescription)" }
    }
}

private struct AirDropCard: View {
    enum Mode: String, CaseIterable { case files = "Files", text = "Text / code" }
    @StateObject private var sender = AirDropSender.shared
    @State private var mode: Mode = .files
    @State private var targeted = false
    @State private var text = ""
    @State private var asFile = false
    @State private var ext = "txt"

    private static let extensions = ["txt", "md", "swift", "py", "js", "ts", "json", "html", "css", "sh"]

    var body: some View {
        GlassCard {
            VStack(spacing: 10) {
                HStack {
                    Text("AirDrop").sectionTitle()
                    Spacer()
                    Picker("", selection: $mode) { ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
                        .pickerStyle(.segmented).labelsHidden().frame(width: 140)
                }
                if mode == .files { filesView } else { textView }
                if let status = sender.status {
                    Text(status).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center).lineLimit(3)
                }
                Spacer(minLength: 0)
            }
        }
        // The whole card takes a drop, not just the circle (a drop that missed the circle used to do nothing).
        .onDrop(of: [.fileURL], isTargeted: $targeted) { providers in
            guard mode == .files else { mode = .files; return false }
            loadURLs(providers) { urls in sender.send(urls) }
            return true
        }
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.accentBright, lineWidth: targeted ? 2 : 0))
    }

    private var filesView: some View {
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
    }

    private var textView: some View {
        VStack(spacing: 8) {
            TextEditor(text: $text)
                .font(.system(size: 11, design: .monospaced)).scrollContentBackground(.hidden)
                .padding(6).frame(height: 96)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            HStack(spacing: 6) {
                Toggle("As a file", isOn: $asFile).toggleStyle(.switch).controlSize(.mini).font(.system(size: 11))
                if asFile {
                    Picker("", selection: $ext) { ForEach(Self.extensions, id: \.self) { Text(".\($0)").tag($0) } }
                        .labelsHidden().fixedSize().controlSize(.small)
                }
            }
            Button { sendText() } label: { Label("Send via AirDrop", systemImage: "paperplane.fill") }
                .buttonStyle(PurpleButtonStyle()).disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private func sendText() {
        let body = String(text.prefix(1_000_000))
        guard asFile else { sender.send([body]); return }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("NotchAirDrop", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("snippet.\(ext)")
        do { try body.write(to: url, atomically: true, encoding: .utf8); sender.send([url]) }
        catch { sender.status = "Couldn't prepare the file: \(error.localizedDescription)" }
    }
}

private struct PairDropCard: View {
    @ObservedObject var pairDrop: PairDropService
    @State private var mode: Mode = .receive
    @State private var codeEntry = ""
    @State private var dropTargeted = false
    @State private var chosenPeer: PairDropPeer?

    enum Mode: String, CaseIterable { case receive = "Receive", send = "Send" }

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("PairDrop").sectionTitle()
                    Text("Same Wi-Fi, no internet needed").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Picker("", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented).labelsHidden().frame(width: 170)
                }

                if mode == .receive { receiveView } else { sendView }

                Spacer(minLength: 0)
                Label(pairDrop.status, systemImage: pairDrop.isSending ? "arrow.up.circle" : "info.circle")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(2)
            }
        }
    }

    // MARK: Receive

    private var receiveView: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Give this code to the person sending you files:")
                .font(.system(size: 13)).foregroundStyle(.white)
            HStack(spacing: 8) {
                Text(pairDrop.pairingCode.map(String.init).joined(separator: " "))
                    .font(.system(size: 34, weight: .bold, design: .monospaced))
                    .foregroundStyle(Theme.accentBright)
                    .textSelection(.enabled)
                    .accessibilityLabel("Your code is \(pairDrop.pairingCode.map(String.init).joined(separator: " "))")
                IconButton(systemImage: "arrow.clockwise", help: "New code") { pairDrop.regenerateCode() }
            }
            Label("Files you receive are saved to Downloads.", systemImage: "arrow.down.circle")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
        }
    }

    // MARK: Send

    private var sendView: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                TextField("Their 6-digit code", text: $codeEntry)
                    .textFieldStyle(.plain)
                    .font(.system(size: 18, weight: .semibold, design: .monospaced))
                    .padding(.horizontal, 12).frame(height: 36)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                    .frame(width: 200)
                    .onChange(of: codeEntry) { _, v in codeEntry = String(v.filter(\.isNumber).prefix(6)) }
                Button {
                    pickFiles { pairDrop.send($0, code: codeEntry, to: chosenPeer) }
                } label: { Label("Choose files…", systemImage: "paperplane.fill") }
                .buttonStyle(PurpleButtonStyle())
                .disabled(codeEntry.count != 6 || pairDrop.isSending)
            }

            // Drop zone — drag files here once the code is entered.
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(dropTargeted ? Theme.accentBright : Theme.separator,
                              style: StrokeStyle(lineWidth: dropTargeted ? 2 : 1, dash: [5, 4]))
                .background(RoundedRectangle(cornerRadius: 10).fill(dropTargeted ? Theme.accent.opacity(0.15) : .clear))
                .overlay(Text(codeEntry.count == 6 ? "…or drop files here to send" : "Enter the code, then drop files here")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary))
                .frame(height: 56)
                .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in
                    guard codeEntry.count == 6 else { return false }
                    loadURLs(providers) { pairDrop.send($0, code: codeEntry, to: chosenPeer) }
                    return true
                }

            // Optional: pick a specific device instead of auto-finding by code.
            Menu {
                Button("Find automatically by code") { chosenPeer = nil }
                if !pairDrop.peers.isEmpty { Divider() }
                ForEach(pairDrop.peers) { peer in Button(peer.displayName) { chosenPeer = peer } }
            } label: {
                Label(chosenPeer?.displayName ?? "\(pairDrop.peers.count) nearby device\(pairDrop.peers.count == 1 ? "" : "s") · automatic",
                      systemImage: "laptopcomputer.and.iphone")
                    .font(.system(size: 12))
            }
            .menuStyle(.borderlessButton).fixedSize()
        }
    }
}

// MARK: Helpers

private func pickFiles(_ completion: @escaping ([URL]) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = true
    panel.canChooseDirectories = false
    NSApp.activate(ignoringOtherApps: true)
    if panel.runModal() == .OK { completion(panel.urls) }
}

/// Reads dropped files in a way that works for Finder, the Desktop and other apps: it asks for the file URL itself,
/// then turns any file-reference form (file:///.file/id=…) into a normal path, which AirDrop and PairDrop need.
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
