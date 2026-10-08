//
//  ShareView.swift
//  Notch apple
//
//  Two ways to share: Apple AirDrop via `NSSharingService`, and PairDrop for
//  local sharing with a 6-digit code.
//
//  PairDrop has three modes:
//   • Receive — shows your code. Read it out to the sender. That's it.
//   • Send    — type the other device's code and pick files or folders. No need to pick
//               a device; the right one is found automatically.
//   • Chat    — type the code once to open a private chat with that device.
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
        let screen = NSScreen.main ?? NSScreen.screens[0]
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
                if sender.canFallback {
                    Button("Open AirDrop window instead") { sender.openAirDropWindow() }.buttonStyle(PurpleButtonStyle(prominent: false))
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
    @State private var nameDraft = ""
    @State private var editingName = false
    @State private var openThread: String?
    @State private var messageDraft = ""

    enum Mode: String, CaseIterable { case receive = "Receive", send = "Send", chat = "Chat" }

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Text("PairDrop").sectionTitle()
                    nameField
                    Spacer()
                    Picker("", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { m in
                            Text(m == .chat && pairDrop.unreadChats > 0 ? "Chat (\(pairDrop.unreadChats))" : m.rawValue).tag(m)
                        }
                    }
                    .pickerStyle(.segmented).labelsHidden().frame(width: 220)
                }

                switch mode {
                case .receive: receiveView
                case .send: sendView
                case .chat: chatView
                }

                Spacer(minLength: 0)
                if let p = pairDrop.progress, pairDrop.isSending {
                    ProgressView(value: p).tint(Theme.accentBright)
                }
                Label(pairDrop.status, systemImage: pairDrop.isSending ? "arrow.up.circle" : "info.circle")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(2)
            }
        }
        .onAppear { nameDraft = pairDrop.username }
    }

    // MARK: Your name

    private var nameField: some View {
        HStack(spacing: 4) {
            Image(systemName: "person.crop.circle").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            if editingName {
                TextField("Your name", text: $nameDraft)
                    .textFieldStyle(.plain).font(.system(size: 11)).frame(width: 110)
                    .onSubmit { pairDrop.setUsername(nameDraft); editingName = false }
                IconButton(systemImage: "checkmark", help: "Save name") { pairDrop.setUsername(nameDraft); editingName = false }
            } else {
                Text(pairDrop.deviceName).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                IconButton(systemImage: "pencil", help: "Change the name other people see") { nameDraft = pairDrop.username.isEmpty ? pairDrop.deviceName : pairDrop.username; editingName = true }
            }
        }
        .padding(.horizontal, 8).frame(height: 24)
        .background(Theme.surface, in: Capsule())
    }

    // MARK: Receive

    private var receiveView: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Give this code to the person sending you files, or starting a chat:")
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

    private var codeField: some View {
        TextField("Their 6-digit code", text: $codeEntry)
            .textFieldStyle(.plain)
            .font(.system(size: 18, weight: .semibold, design: .monospaced))
            .padding(.horizontal, 12).frame(height: 36)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
            .frame(width: 200)
            .onChange(of: codeEntry) { _, v in codeEntry = String(v.filter(\.isNumber).prefix(6)) }
    }

    private var sendView: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                codeField
                Button {
                    pickFiles { pairDrop.send($0, code: codeEntry, to: chosenPeer) }
                } label: { Label("Choose files…", systemImage: "paperplane.fill") }
                .buttonStyle(PurpleButtonStyle())
                .disabled(codeEntry.count != 6 || pairDrop.isSending)
            }

            // Drop zone: drag files or folders here once the code is entered.
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(dropTargeted ? Theme.accentBright : Theme.separator,
                              style: StrokeStyle(lineWidth: dropTargeted ? 2 : 1, dash: [5, 4]))
                .background(RoundedRectangle(cornerRadius: 10).fill(dropTargeted ? Theme.accent.opacity(0.15) : .clear))
                .overlay(Text(codeEntry.count == 6 ? "…or drop files or folders here to send" : "Enter the code, then drop files here")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary))
                .frame(height: 56)
                .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in
                    guard codeEntry.count == 6 else { pairDrop.status = "Type their 6-digit code first, then drop the files."; return false }
                    loadURLs(providers) { pairDrop.send($0, code: codeEntry, to: chosenPeer) }
                    return true
                }

            peerMenu
        }
    }

    private var peerMenu: some View {
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

    // MARK: Chat

    private var chatView: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Start a private chat").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                codeField.frame(width: 170)
                Button { pairDrop.startChat(code: codeEntry, with: chosenPeer) } label: { Label("Connect", systemImage: "bubble.left.and.bubble.right.fill") }
                    .buttonStyle(PurpleButtonStyle()).disabled(codeEntry.count != 6)
                peerMenu
                Text("Chats live only while Notch apple is open and both of you are on this Wi-Fi.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: 190, alignment: .leading)
            Divider().overlay(Theme.separator)
            VStack(spacing: 6) {
                if pairDrop.threads.isEmpty {
                    Text("No chats yet. Type someone's code and press Connect, or give yours and let them connect.")
                        .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(pairDrop.threads) { t in
                                Button { openThread = t.id; pairDrop.markRead(t.id) } label: {
                                    Text(t.unread > 0 ? "\(t.peerName) (\(t.unread))" : t.peerName)
                                        .font(.system(size: 11, weight: .semibold)).padding(.horizontal, 10).frame(height: 24)
                                        .background(Capsule().fill(t.id == (openThread ?? pairDrop.threads.first?.id) ? AnyShapeStyle(Theme.accent.opacity(0.45)) : AnyShapeStyle(Theme.surface)))
                                        .foregroundStyle(.white)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    if let t = pairDrop.threads.first(where: { $0.id == (openThread ?? pairDrop.threads.first?.id) }) { thread(t) }
                }
            }
        }
    }

    private func thread(_ t: PairDropChatThread) -> some View {
        VStack(spacing: 6) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 4) {
                        ForEach(t.messages) { m in
                            HStack {
                                if m.fromMe { Spacer(minLength: 40) }
                                Text(m.text).font(.system(size: 12)).foregroundStyle(.white).textSelection(.enabled)
                                    .padding(.horizontal, 10).padding(.vertical, 5)
                                    .background(m.fromMe ? Theme.accent.opacity(0.55) : Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                                if !m.fromMe { Spacer(minLength: 40) }
                            }
                            .id(m.id)
                        }
                    }
                }
                .onChange(of: t.messages.count) { _, _ in if let last = t.messages.last { proxy.scrollTo(last.id, anchor: .bottom) } }
            }
            HStack(spacing: 6) {
                TextField("Message \(t.peerName)", text: $messageDraft)
                    .textFieldStyle(.plain).font(.system(size: 12)).padding(.horizontal, 10).frame(height: 28)
                    .background(Theme.surface, in: Capsule())
                    .onSubmit { send(to: t) }
                Button { send(to: t) } label: { Image(systemName: "arrow.up.circle.fill").font(.system(size: 20)) }
                    .buttonStyle(.plain).foregroundStyle(Theme.accentBright).disabled(messageDraft.trimmingCharacters(in: .whitespaces).isEmpty)
                IconButton(systemImage: "xmark.circle", help: "End this chat") { pairDrop.closeChat(t.id); openThread = nil }
            }
        }
        .onAppear { pairDrop.markRead(t.id) }
    }

    private func send(to t: PairDropChatThread) {
        let text = messageDraft
        messageDraft = ""
        pairDrop.sendMessage(text, in: t.id)
    }
}

// MARK: Helpers

private func pickFiles(_ completion: @escaping ([URL]) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = true
    panel.canChooseDirectories = true      // a folder is zipped and sent as one file
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
