//
//  FriendsView.swift
//  Notch Apple
//
//  Messenger → Friends: the list (requests, pending, friends), adding by code, and one chat per friend with
//  sent / delivered / read, a typing indicator, nicknames and the safety number. The logic is in FriendsLogic.swift.
//

import AppKit
import CoreImage.CIFilterBuiltins
import SwiftUI

struct FriendsView: View {
    @StateObject private var client = FriendsClient.shared
    @State private var selected: String?
    @State private var addText = ""
    @State private var addNote: String?
    @State private var adding = false
    @State private var draft = ""
    @State private var showSafety = false
    @State private var renaming = false
    @State private var aliasDraft = ""
    @State private var confirmRemove = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            sidebar.frame(width: 186)
            Divider().opacity(0.3)
            if let box = selected, let friend = client.book.record(box), friend.status == .active { chat(friend) } else { placeholder }
        }
        .onAppear { client.activate(); if selected == nil { selected = client.friends.first?.box } }
        .onDisappear { client.viewing = nil }
        .onChange(of: selected) { _, new in client.viewing = new; if let new { client.markRead(new) } }
    }

    // MARK: Sidebar

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 5) {
                Circle().fill(linkColor).frame(width: 7, height: 7).padding(.top, 4)
                Text(linkText).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(5).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 4) {
                TextField("Friend code", text: $addText)
                    .textFieldStyle(.plain).font(.system(size: 12)).padding(.horizontal, 8).frame(height: 28)
                    .background(Theme.surface, in: Capsule()).onSubmit(add)
                Button(action: add) { Image(systemName: adding ? "hourglass" : "person.badge.plus") }
                    .buttonStyle(PurpleButtonStyle()).disabled(adding || addText.trimmingCharacters(in: .whitespaces).isEmpty)
                    .help("Send a friend request. They have to accept before either of you can message.")
            }
            Button("Paste a QR image") { addFromClipboardImage() }.buttonStyle(.link).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            if let note = addNote { Text(note).font(.system(size: 10)).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    if !client.incoming.isEmpty { sectionLabel("Requests"); ForEach(client.incoming) { requestRow($0) } }
                    if !client.pending.isEmpty { sectionLabel("Waiting for an answer"); ForEach(client.pending) { pendingRow($0) } }
                    sectionLabel("Friends")
                    if client.friends.isEmpty {
                        Text("Your code is in Settings → Messenger. Share it, or add someone's.")
                            .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(client.friends) { friendRow($0) }
                }
            }
        }
    }

    private func sectionLabel(_ t: String) -> some View { Text(t.uppercased()).font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.textSecondary).padding(.top, 4) }

    private func requestRow(_ r: FriendRecord) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(r.displayName).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
            Text("wants to be friends").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            HStack(spacing: 4) {
                Button("Accept") { Task { addNote = await client.accept(r.box); if addNote == nil { selected = r.box } } }.buttonStyle(PurpleButtonStyle())
                Button("Block") { client.block(r.box) }.buttonStyle(PurpleButtonStyle(prominent: false))
            }
        }
        .padding(8).frame(maxWidth: .infinity, alignment: .leading).background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
    }

    private func pendingRow(_ r: FriendRecord) -> some View {
        HStack {
            Text(r.alias ?? "Friend \(Friends.hex(r.fingerprint).prefix(4).uppercased())").font(.system(size: 12)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            Spacer()
            Button { client.remove(r.box) } label: { Image(systemName: "xmark.circle") }.buttonStyle(.plain).foregroundStyle(Theme.textSecondary).help("Cancel this request")
        }
        .padding(.horizontal, 8).padding(.vertical, 5).background(Theme.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
    }

    private func friendRow(_ r: FriendRecord) -> some View {
        Button { selected = r.box } label: {
            HStack(spacing: 6) {
                Text(String(r.displayName.prefix(1)).uppercased()).font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 22, height: 22).background(MessengerMessage.color(for: r.box).gradient, in: Circle())
                Text(r.displayName).font(.system(size: 12, weight: .medium)).foregroundStyle(.white).lineLimit(1)
                Spacer(minLength: 2)
                if r.unread > 0 {
                    Text("\(r.unread)").font(.system(size: 10, weight: .bold)).foregroundStyle(.white).padding(.horizontal, 6).padding(.vertical, 1).background(Theme.accentBright, in: Capsule())
                }
            }
            .padding(.horizontal, 6).padding(.vertical, 4)
            .background(selected == r.box ? AnyShapeStyle(Theme.surfaceHover) : AnyShapeStyle(Color.clear), in: RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Nickname…") { selected = r.box; aliasDraft = r.alias ?? ""; renaming = true }
            Button("Remove friend", role: .destructive) { client.remove(r.box); if selected == r.box { selected = nil } }
            Button("Block", role: .destructive) { client.block(r.box); if selected == r.box { selected = nil } }
        }
    }

    private var linkColor: Color {
        switch client.link { case .online: .green; case .connecting: .yellow; case .problem: .red; case .off: Theme.textSecondary }
    }
    private var linkText: String {
        switch client.link {
        case .online: "Online"
        case .connecting: "Connecting…"
        case .problem(let m): m
        case .off: "Not connected"
        }
    }

    private func add() {
        let text = addText
        adding = true; addNote = nil
        Task {
            addNote = await client.addFriend(text)
            adding = false
            if addNote == nil { addText = ""; addNote = "Request sent. They have to accept it." }
        }
    }

    private func addFromClipboardImage() {
        guard let image = NSPasteboard.general.readObjects(forClasses: [NSImage.self])?.first as? NSImage, let tiff = image.tiffRepresentation,
              let ci = CIImage(data: tiff), let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: nil),
              let text = (detector.features(in: ci).first as? CIQRCodeFeature)?.messageString else { addNote = "Copy a picture of the QR code first, then press this."; return }
        addText = text; add()
    }

    // MARK: Chat

    private var placeholder: some View {
        VStack(spacing: 6) {
            Image(systemName: "person.2.fill").font(.system(size: 26)).foregroundStyle(Theme.accentGradient)
            Text("Private, end-to-end encrypted chat with people you add by code. Nobody can message you until you accept them.")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center).frame(maxWidth: 360)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func chat(_ friend: FriendRecord) -> some View {
        VStack(spacing: 8) {
            HStack {
                Text(friend.displayName).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                if client.typing.contains(friend.box) { Text("typing…").font(.system(size: 11)).foregroundStyle(Theme.accentBright) }
                Spacer()
                Button { showSafety = true } label: { Label("Safety number", systemImage: "checkmark.shield") }
                    .buttonStyle(PurpleButtonStyle(prominent: false)).help("Compare these numbers with your friend to be sure nobody is in the middle")
                    .popover(isPresented: $showSafety) { safety(friend) }
                Menu {
                    Button("Nickname…") { aliasDraft = friend.alias ?? ""; renaming = true }
                    Button("Remove friend", role: .destructive) { confirmRemove = true }
                    Button("Block", role: .destructive) { client.block(friend.box); selected = nil }
                } label: { Image(systemName: "ellipsis.circle") }.menuStyle(.borderlessButton).frame(width: 28)
            }
            .popover(isPresented: $renaming) { nicknameEditor(friend) }
            .confirmationDialog("Remove \(friend.displayName)? They won't be told why, and you can add them again later.", isPresented: $confirmRemove) {
                Button("Remove", role: .destructive) { client.remove(friend.box); selected = nil }
            }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 6) {
                        if client.messages(friend.box).isEmpty {
                            Text("Say hi. Messages are encrypted on this Mac; the server only holds them until \(friend.displayName) is online.")
                                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).frame(maxWidth: .infinity).padding(.top, 20)
                        }
                        ForEach(client.messages(friend.box)) { m in FriendBubble(message: m) { client.retry(m.id, in: friend.box) }.id(m.id) }
                    }
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: client.messages(friend.box).count) { _, _ in
                    withAnimation(Theme.spring) { proxy.scrollTo(client.messages(friend.box).last?.id, anchor: .bottom) }
                    if client.viewing == friend.box { client.markRead(friend.box) }
                }
            }
            if let problem = client.lastProblem { Text(problem).font(.system(size: 10)).foregroundStyle(.orange) }
            HStack(spacing: 6) {
                TextField("Message", text: $draft)
                    .textFieldStyle(.plain).font(.system(size: 13)).padding(.horizontal, 12).frame(height: 32)
                    .background(Theme.surface, in: Capsule())
                    .onSubmit { send(friend) }
                    .onChange(of: draft) { _, new in if !new.isEmpty { client.typingChanged(to: friend.box) } }
                Button { send(friend) } label: { Image(systemName: "arrow.up") }
                    .buttonStyle(PurpleButtonStyle()).disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty).help("Send (Return)")
            }
        }
    }

    private func send(_ friend: FriendRecord) {
        client.lastProblem = nil
        client.send(draft, to: friend.box); draft = ""
    }

    private func safety(_ friend: FriendRecord) -> some View {
        let number = FriendCrypto.safetyNumber(signA: client.identity.signPublic, dhA: client.identity.dhPublic, signB: friend.sign, dhB: friend.dh)
        let rows = stride(from: 0, to: 12, by: 4).map { Array(number.split(separator: " ")[$0..<$0 + 4]).joined(separator: "  ") }
        return VStack(alignment: .leading, spacing: 8) {
            Text("Safety number with \(friend.displayName)").font(.system(size: 13, weight: .semibold))
            ForEach(rows, id: \.self) { Text($0).font(.system(size: 14, design: .monospaced)) }
            Text("Read these out (in person or on a call). If they match on both Macs, no one can read your chat in the middle.")
                .font(.system(size: 11)).foregroundStyle(.secondary).frame(width: 260, alignment: .leading)
        }
        .padding(14)
    }

    private func nicknameEditor(_ friend: FriendRecord) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Nickname (only you see it)").font(.system(size: 12, weight: .semibold))
            TextField("Nickname", text: $aliasDraft).frame(width: 200).onSubmit { client.setAlias(friend.box, aliasDraft); renaming = false }
            Button("Save") { client.setAlias(friend.box, aliasDraft); renaming = false }
        }
        .padding(14)
    }
}

private struct FriendBubble: View {
    let message: FriendMessage
    var retry: () -> Void

    var body: some View {
        HStack(alignment: .bottom) {
            if message.mine { Spacer(minLength: 60) }
            VStack(alignment: message.mine ? .trailing : .leading, spacing: 2) {
                Text(message.text).font(.system(size: 13)).foregroundStyle(.white).textSelection(.enabled)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(message.mine ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Theme.surfaceHover)))
                HStack(spacing: 4) {
                    Text(message.date, style: .time)
                    if message.mine { stateLabel }
                }
                .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
            if !message.mine { Spacer(minLength: 60) }
        }
    }

    @ViewBuilder private var stateLabel: some View {
        switch message.state {
        case .sending: Text("· sending…")
        case .sent: Text("· sent")
        case .delivered: Text("· delivered")
        case .read: Text("· read").foregroundStyle(Theme.accentBright)
        case .failed: Button("· failed, tap to retry", action: retry).buttonStyle(.plain).foregroundStyle(.orange)
        }
    }
}

// MARK: - Settings

struct FriendsSettingsSection: View {
    @StateObject private var client = FriendsClient.shared
    @State private var copied = false
    @State private var confirmDelete = false
    @State private var deleting = false

    var body: some View {
        Section {
            LabeledContent("Your friend code") {
                HStack {
                    Text(Friends.displayCode(client.identity.code)).font(.system(size: 14, weight: .semibold, design: .monospaced)).textSelection(.enabled)
                    Button(copied ? "Copied" : "Copy") {
                        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(Friends.displayCode(client.identity.code), forType: .string)
                        copied = true; DispatchQueue.main.asyncAfter(deadline: .now() + 2) { copied = false }
                    }
                }
            }
            if let qr = Self.qr(client.identity.link) {
                LabeledContent("QR code") {
                    Image(nsImage: qr).interpolation(.none).resizable().frame(width: 120, height: 120).accessibilityLabel("QR code for your friend code")
                }
            }
            TextField("Name shown in friend requests", text: $client.nick, prompt: Text(MessengerIdentity.shared.handle))
            Toggle("Send read receipts and typing", isOn: $client.receipts)
            if !client.book.vault.blocked.isEmpty {
                LabeledContent("Blocked people") { Button("Unblock all (\(client.book.vault.blocked.count))") { client.unblockAll() } }
            }
            Button(deleting ? "Deleting…" : "Delete all my chat data", role: .destructive) { confirmDelete = true }.disabled(deleting)
                .confirmationDialog("Delete every friend, message and block, here and on the server? Your friend code stays the same.", isPresented: $confirmDelete) {
                    Button("Delete everything", role: .destructive) { deleting = true; Task { await client.deleteEverything(); deleting = false } }
                }
        } header: {
            Text("Friends")
        } footer: {
            Text("Your code is an address, not a password: someone who has it can only send you a request, and you choose whether to accept. Messages are end-to-end encrypted; the server sees only random IDs and encrypted data, and history stays on this Mac.")
        }
    }

    /// A QR code for the link, as a crisp image.
    static func qr(_ text: String) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8); filter.correctionLevel = "M"
        guard let out = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)) else { return nil }
        let rep = NSCIImageRep(ciImage: out)
        let image = NSImage(size: rep.size); image.addRepresentation(rep)
        return image
    }
}
