//
//  NotchMessengerView.swift
//  Notch apple
//
//  Notch Messenger: chat with people on the same Wi-Fi, or in an anonymous,
//  end-to-end-encrypted room joined with a code.
//

import SwiftUI

struct NotchMessengerView: View {
    enum Mode: String, CaseIterable { case nearby, room }

    @AppStorage("messenger.mode") private var mode: Mode = .nearby
    @AppStorage("messenger.lastRoom") private var lastRoom = ""
    @StateObject private var local = LocalP2PManager.shared
    @StateObject private var web = WebP2PManager.shared
    @StateObject private var identity = MessengerIdentity.shared
    @State private var draft = ""
    @State private var roomDraft = ""
    @State private var copied = false

    private static let emoji = ["👋", "😂", "👍", "❤️", "🔥", "🎉"]

    private var messages: [MessengerMessage] { mode == .nearby ? local.messages : web.messages }
    private var canSend: Bool { mode == .nearby ? !local.connectedPeers.isEmpty : web.state == .joined }

    var body: some View {
        VStack(spacing: 10) {
            header
            if mode == .room { roomBar }
            chatLog
            inputBar
        }
        .onAppear {
            MessengerNotifier.shared.markAllRead()
            MessengerNotifier.shared.requestAuthorizationIfNeeded()
            roomDraft = lastRoom
            if mode == .nearby { local.start() }
        }
        .onChange(of: mode) { _, new in if new == .nearby { local.start() } }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 10) {
            Picker("Mode", selection: $mode) {
                Label("Nearby Wi-Fi", systemImage: "wifi").tag(Mode.nearby)
                Label("Anonymous room", systemImage: "globe").tag(Mode.room)
            }
            .pickerStyle(.segmented).labelsHidden().frame(width: 290)

            HStack(spacing: 5) {
                Circle().fill(statusColor).frame(width: 8, height: 8)
                Text(statusText).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            Spacer(minLength: 4)
            Label(identity.handle, systemImage: "person.crop.circle.fill")
                .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                .help("Your anonymous handle. Change it in Settings → Messenger.")
        }
    }

    private var statusColor: Color {
        switch mode {
        case .nearby: local.connectedPeers.isEmpty ? .orange : .green
        case .room:
            switch web.state {
            case .joined: .green
            case .connecting: .yellow
            case .failed: .red
            case .idle: Theme.textSecondary
            }
        }
    }

    private var statusText: String {
        switch mode {
        case .nearby: return local.status
        case .room:
            switch web.state {
            case .idle: return "Not in a room"
            case .connecting: return "Joining…"
            case .joined:
                let n = web.memberCount
                return n == 0 ? "Only you here so far" : "\(n + 1) online"
            case .failed(let msg): return msg
            }
        }
    }

    // MARK: Room bar

    private var roomBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "number").foregroundStyle(Theme.textSecondary)
            TextField("Room code, e.g. cafe-study or 8821", text: $roomDraft)
                .textFieldStyle(.plain).font(.system(size: 13))
                .onSubmit(joinRoom)
            if web.state == .joined, let room = web.room {
                // Share: copy the code so friends can join the same room.
                Button { copy(room) } label: {
                    Label(copied ? "Copied" : "Copy code", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(PurpleButtonStyle(prominent: false))
                .help("Copy this room's code to share it")
            }
            if web.state == .joined || web.state == .connecting {
                Button("Leave") { web.leave() }.buttonStyle(PurpleButtonStyle(prominent: false))
            } else {
                Button { createRoom() } label: { Label("New room", systemImage: "plus.bubble") }
                    .buttonStyle(PurpleButtonStyle(prominent: false))
                    .help("Create a private room with a hard-to-guess code")
            }
            Button(web.room == WebP2PManager.normalize(roomDraft) && web.state == .joined ? "Joined" : "Join", action: joinRoom)
                .buttonStyle(PurpleButtonStyle())
                .disabled(WebP2PManager.normalize(roomDraft).isEmpty)
        }
        .padding(.horizontal, 12).frame(height: 36)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
        .help("Anyone with the same code joins the same room. Messages are end-to-end encrypted with a key made from the code, so longer codes are more private.")
    }

    /// Creates a new private room: a random, hard-to-guess code (about 10¹² combinations),
    /// joins it, and copies the code so it can be pasted to friends.
    private func createRoom() {
        let code = WebP2PManager.newRoomCode()
        roomDraft = code
        joinRoom()
        copy(code)
    }

    private func copy(_ code: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(code, forType: .string)
        withAnimation { copied = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { withAnimation { copied = false } }
    }

    private func joinRoom() {
        let room = WebP2PManager.normalize(roomDraft)
        guard !room.isEmpty else { return }
        lastRoom = roomDraft
        web.join(room)
    }

    // MARK: Chat log

    private var chatLog: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    if messages.isEmpty { emptyState }
                    ForEach(messages) { MessengerBubble(message: $0).id($0.id) }
                }
                .padding(.vertical, 4)
            }
            .onChange(of: messages.count) { _, _ in
                withAnimation(Theme.spring) { proxy.scrollTo(messages.last?.id, anchor: .bottom) }
            }
        }
        .frame(maxHeight: .infinity)
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Image(systemName: mode == .nearby ? "wifi" : "lock.shield")
                .font(.system(size: 26)).foregroundStyle(Theme.accentGradient)
            Text(mode == .nearby
                 ? "Anyone on this Wi-Fi with Notch apple and Messenger open shows up here automatically."
                 : web.state == .joined
                 ? "You're in the room. Press Copy code and send it to friends; anyone with the code can join."
                 : "Press New room to create a private room (its code is copied for you to share), or type a friend's code and press Join. Messages are end-to-end encrypted and never stored.")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center).frame(maxWidth: 420)
        }
        .frame(maxWidth: .infinity).padding(.top, 24)
    }

    // MARK: Input

    private var inputBar: some View {
        HStack(spacing: 6) {
            ForEach(Self.emoji, id: \.self) { e in
                Button { draft += e } label: {
                    Text(e).font(.system(size: 15)).frame(width: 28, height: 28).contentShape(Rectangle())
                }
                .buttonStyle(.plain).help("Insert \(e)")
            }
            TextField(canSend ? "Message" : (mode == .nearby ? "Waiting for someone nearby…" : "Join a room to chat"),
                      text: $draft)
                .textFieldStyle(.plain).font(.system(size: 13))
                .padding(.horizontal, 12).frame(height: 32)
                .background(Theme.surface, in: Capsule())
                .onSubmit(send)
            Button(action: send) { Image(systemName: "arrow.up") }
                .buttonStyle(PurpleButtonStyle())
                .disabled(!canSend || draft.trimmingCharacters(in: .whitespaces).isEmpty)
                .help("Send (Return)")
        }
    }

    private func send() {
        guard canSend else { return }
        mode == .nearby ? local.send(draft) : web.send(draft)
        draft = ""
    }
}

/// A chat bubble with avatar, handle and time.
private struct MessengerBubble: View {
    let message: MessengerMessage

    var body: some View {
        if message.isNotice {
            Text(message.text).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                .frame(maxWidth: .infinity)
        } else {
            HStack(alignment: .bottom, spacing: 8) {
                if message.isMine { Spacer(minLength: 80) } else { avatar }
                VStack(alignment: message.isMine ? .trailing : .leading, spacing: 2) {
                    if !message.isMine {
                        Text(message.sender).font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(MessengerMessage.color(for: message.senderID))
                    }
                    Text(message.text)
                        .font(.system(size: 13)).foregroundStyle(.white).textSelection(.enabled)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(message.isMine ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Theme.surfaceHover))
                        )
                    Text(message.date, style: .time).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                if !message.isMine { Spacer(minLength: 80) }
            }
        }
    }

    private var avatar: some View {
        Text(String(message.sender.prefix(1)).uppercased())
            .font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
            .frame(width: 26, height: 26)
            .background(MessengerMessage.color(for: message.senderID).gradient, in: Circle())
            .accessibilityHidden(true)
    }
}
