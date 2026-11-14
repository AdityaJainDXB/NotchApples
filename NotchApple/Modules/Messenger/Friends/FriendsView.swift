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
    @State private var showQR = false
    @State private var copiedCode = false
    @State private var showNewGroup = false
    @State private var groupName = ""
    @State private var groupPick = Set<String>()
    @State private var groupNote: String?
    @State private var addToGroupKey: String?
    @State private var confirmLeave = false
    @State private var confirmClear = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            sidebar.frame(width: 186)
            Divider().opacity(0.3)
            if let key = selected, Friends.isGroupKey(key), let group = client.group(key) { groupChat(group) }
            else if let box = selected, let friend = client.book.record(box), friend.status == .active { chat(friend) } else { placeholder }
        }
        // Shown inside the notch, not as a system dialog: a dialog is another window, and an unpinned notch closes the moment it loses focus,
        // which hid the confirmation and made Clear chat look like it did nothing.
        .overlay { if confirmClear { clearCard } }
        .overlay { if showNewGroup { newGroupCard } }
        .overlay { if let key = addToGroupKey { addMembersCard(key) } }
        .overlay { if confirmLeave, let key = selected, let g = client.group(key) {
            confirmCard("Leave \(g.name)?", "Its messages are deleted from this Mac, and the others are told you left.", "Leave", close: { confirmLeave = false }) {
                client.leaveGroup(g.key); selected = nil
            } } }
        .overlay { if confirmRemove, let box = selected, let f = client.book.record(box) {
            confirmCard("Remove \(f.displayName)?", "They won't be told why, and you can add them again later.", "Remove", close: { confirmRemove = false }) {
                client.remove(f.box); selected = nil
            } } }
        .onAppear { client.activate(); if selected == nil { selected = client.friends.first?.box } }
        .onDisappear { client.viewing = nil; NotchPrefs.chatGame("friend", false) }
        .onChange(of: friendGameShowing) { _, on in NotchPrefs.chatGame("friend", on) }
        .onChange(of: selected) { _, new in client.viewing = new; if let new { client.markRead(new) } }
    }

    /// A tic-tac-toe board is on screen in the open friend chat: the notch opens taller (NotchPrefs.chatGame).
    private var friendGameShowing: Bool { selected.map { client.games[$0] != nil } ?? false }

    // MARK: Sidebar

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 5) {
                Circle().fill(linkColor).frame(width: 7, height: 7).padding(.top, 4)
                Text(linkText).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(5).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 4) {
                TextField("Friend code", text: $addText)
                    .textFieldStyle(.plain).foregroundStyle(Theme.textPrimary).font(.system(size: 12)).padding(.horizontal, 8).frame(height: 28)
                    .background(Theme.surface, in: Capsule()).onSubmit(add)
                Button(action: add) { Image(systemName: adding ? "hourglass" : "person.badge.plus") }
                    .buttonStyle(PurpleButtonStyle()).disabled(adding || addText.trimmingCharacters(in: .whitespaces).isEmpty)
                    .help("Send a friend request. They have to accept before either of you can message.")
            }
            if let note = addNote { Text(note).font(.system(size: 10)).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    if !client.incoming.isEmpty { sectionLabel("Requests"); ForEach(client.incoming) { requestRow($0) } }
                    if !client.pending.isEmpty { sectionLabel("Waiting for an answer"); ForEach(client.pending) { pendingRow($0) } }
                    sectionLabel("Friends")
                    if client.friends.isEmpty {
                        Text("Type a friend's code above to add them, or share yours (bottom left).")
                            .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(client.friends) { friendRow($0) }
                    HStack {
                        sectionLabel("Groups")
                        Spacer()
                        Button { groupName = ""; groupPick = []; groupNote = nil; showNewGroup = true } label: { Image(systemName: "plus.circle") }
                            .buttonStyle(MetalPlainStyle()).hitTarget().foregroundStyle(Theme.accentBright).help("Start a group chat with some of your friends")
                            .disabled(client.friends.isEmpty)
                    }
                    if client.groups.isEmpty {
                        Text(client.friends.isEmpty ? "Add a friend first, then you can make a group." : "Tap + to start a group chat.")
                            .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(client.groups) { groupRow($0) }
                    if !client.book.blockedPeople.isEmpty {
                        sectionLabel("Blocked")
                        ForEach(client.book.blockedPeople) { blockedRow($0) }
                        Text("Unblock someone and they can send you a request again, or you can add their code.")
                            .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            myCodePill
        }
    }

    /// A person you blocked, with a button to unblock just them.
    private func blockedRow(_ b: BlockedPerson) -> some View {
        HStack(spacing: 6) {
            Text(b.name).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            Spacer()
            Button("Unblock") { client.unblock(b.fingerprint) }.buttonStyle(PurpleButtonStyle(prominent: false))
        }
        .padding(.horizontal, 8).padding(.vertical, 4).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
    }

    private func sectionLabel(_ t: String) -> some View { Text(t.uppercased()).font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.textSecondary).padding(.top, 4) }

    private func requestRow(_ r: FriendRecord) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(r.displayName).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textPrimary).lineLimit(1)
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
            Button { client.remove(r.box) } label: { Image(systemName: "xmark.circle") }.buttonStyle(MetalPlainStyle()).foregroundStyle(Theme.textSecondary).help("Cancel this request")
        }
        .padding(.horizontal, 8).padding(.vertical, 5).background(Theme.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
    }

    private func friendRow(_ r: FriendRecord) -> some View {
        Button { selected = r.box } label: {
            HStack(spacing: 6) {
                Text(String(r.displayName.prefix(1)).uppercased()).font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.onAccent)
                    .frame(width: 22, height: 22).background(MessengerMessage.color(for: r.box).gradient, in: Circle())
                Text(r.displayName).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                Spacer(minLength: 2)
                if r.unread > 0 {
                    Text("\(r.unread)").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.onAccent).padding(.horizontal, 6).padding(.vertical, 1).background(Theme.accentBright, in: Capsule())
                }
            }
            .padding(.horizontal, 6).padding(.vertical, 4).contentShape(Rectangle())
            .background(selected == r.box ? AnyShapeStyle(Theme.surfaceHover) : AnyShapeStyle(Color.clear), in: RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(MetalPlainStyle())
        .contextMenu {
            Button("Nickname…") { selected = r.box; aliasDraft = r.alias ?? ""; renaming = true }
            Button("Clear chat…", role: .destructive) { selected = r.box; confirmClear = true }
            Button("Remove friend", role: .destructive) { client.remove(r.box); if selected == r.box { selected = nil } }
            Button("Block", role: .destructive) { client.block(r.box); if selected == r.box { selected = nil } }
        }
    }

    private func groupRow(_ g: FriendGroup) -> some View {
        Button { selected = g.key } label: {
            HStack(spacing: 6) {
                Image(systemName: "person.3.fill").font(.system(size: 10)).foregroundStyle(Theme.onAccent)
                    .frame(width: 22, height: 22).background(MessengerMessage.color(for: g.id).gradient, in: Circle())
                Text(g.name).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                Spacer(minLength: 2)
                if g.unread > 0 {
                    Text("\(g.unread)").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.onAccent).padding(.horizontal, 6).padding(.vertical, 1).background(Theme.accentBright, in: Capsule())
                }
            }
            .padding(.horizontal, 6).padding(.vertical, 4).contentShape(Rectangle())
            .background(selected == g.key ? AnyShapeStyle(Theme.surfaceHover) : AnyShapeStyle(Color.clear), in: RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(MetalPlainStyle())
        .contextMenu {
            Button("Clear chat…", role: .destructive) { selected = g.key; confirmClear = true }
            Button("Add friends…") { groupPick = []; groupNote = nil; addToGroupKey = g.key }
            Button("Leave group", role: .destructive) { client.leaveGroup(g.key); if selected == g.key { selected = nil } }
        }
    }

    /// Shown inside the notch, like the clear-chat card: a system sheet is another window, and an unpinned notch closes the moment it
    /// loses focus, which made choosing group members close the whole notch.
    private var newGroupCard: some View {
        ZStack {
            Color.black.opacity(0.55).onTapGesture { showNewGroup = false }
            VStack(alignment: .leading, spacing: 10) {
                Text("New group").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                TextField("Group name", text: $groupName).textFieldStyle(.plain).foregroundStyle(Theme.textPrimary).font(.system(size: 12)).padding(.horizontal, 8).frame(height: 28)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                Text("Pick friends to add").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(client.friends) { f in
                            let on = groupPick.contains(f.box)
                            Button { if on { groupPick.remove(f.box) } else { groupPick.insert(f.box) } } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: on ? "checkmark.square.fill" : "square").foregroundStyle(on ? Theme.accentBright : Theme.textSecondary)
                                    Text(f.displayName).font(.system(size: 12)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                                    Spacer()
                                }
                                .padding(.horizontal, 8).padding(.vertical, 5).contentShape(Rectangle())
                                .background(on ? Theme.surfaceHover : Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                            }.buttonStyle(MetalPlainStyle())
                        }
                    }
                }
                .frame(maxHeight: 150)
                Text("Everyone in a group sees messages only from people who are also their friends, so add people who know each other. Each message is encrypted separately for each person.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                if let note = groupNote { Text(note).font(.system(size: 11)).foregroundStyle(.orange) }
                HStack {
                    Spacer()
                    Button("Cancel") { showNewGroup = false }.buttonStyle(PurpleButtonStyle(prominent: false))
                    Button("Create") {
                        groupNote = client.createGroup(name: groupName, members: Array(groupPick))
                        if groupNote == nil { showNewGroup = false; selected = client.groups.first?.key }
                    }
                    .buttonStyle(PurpleButtonStyle()).disabled(groupPick.isEmpty)
                }
            }
            .padding(14).frame(maxWidth: 340)
            .background(Theme.deep, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.separator))
        }
    }

    /// A confirmation inside the notch (never a system dialog, which would close the notch).
    private func confirmCard(_ title: String, _ message: String, _ button: String, close: @escaping () -> Void, action: @escaping () -> Void) -> some View {
        ZStack {
            Color.black.opacity(0.55).onTapGesture(perform: close)
            VStack(alignment: .leading, spacing: 10) {
                Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                Text(message).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                HStack {
                    Spacer()
                    Button("Cancel", action: close).buttonStyle(PurpleButtonStyle(prominent: false))
                    Button(button) { action(); close() }.buttonStyle(PurpleButtonStyle())
                }
            }
            .padding(14).frame(maxWidth: 380)
            .background(Theme.deep, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.separator))
        }
    }

    /// Pick more of my friends to add to a group I'm in. Anyone in the group can do this, not just whoever made it.
    private func addMembersCard(_ key: String) -> some View {
        let g = client.group(key)
        let candidates = client.friends.filter { f in !(g?.members.contains(f.box) ?? true) }
        return ZStack {
            Color.black.opacity(0.55).onTapGesture { addToGroupKey = nil }
            VStack(alignment: .leading, spacing: 10) {
                Text("Add to \(g?.name ?? "group")").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                if candidates.isEmpty {
                    Text("All your friends are already in this group.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(candidates) { f in
                                let on = groupPick.contains(f.box)
                                Button { if on { groupPick.remove(f.box) } else { groupPick.insert(f.box) } } label: {
                                    HStack(spacing: 8) {
                                        Image(systemName: on ? "checkmark.square.fill" : "square").foregroundStyle(on ? Theme.accentBright : Theme.textSecondary)
                                        Text(f.displayName).font(.system(size: 12)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                                        Spacer()
                                    }
                                    .padding(.horizontal, 8).padding(.vertical, 5).contentShape(Rectangle())
                                    .background(on ? Theme.surfaceHover : Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                                }.buttonStyle(MetalPlainStyle())
                            }
                        }
                    }.frame(maxHeight: 150)
                }
                Text("You can add your own friends without asking whoever made the group. They only see messages from people who are also their friends.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                if let note = groupNote { Text(note).font(.system(size: 11)).foregroundStyle(.orange) }
                HStack {
                    Spacer()
                    Button("Cancel") { addToGroupKey = nil }.buttonStyle(PurpleButtonStyle(prominent: false))
                    Button("Add") {
                        groupNote = client.addToGroup(key, members: Array(groupPick))
                        if groupNote == nil { addToGroupKey = nil }
                    }.buttonStyle(PurpleButtonStyle()).disabled(groupPick.isEmpty)
                }
            }
            .padding(14).frame(maxWidth: 340)
            .background(Theme.deep, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.separator))
        }
    }

    private func groupChat(_ g: FriendGroup) -> some View {
        VStack(spacing: 8) {
            HStack {
                Image(systemName: "person.3.fill").foregroundStyle(Theme.accentGradient)
                VStack(alignment: .leading, spacing: 0) {
                    Text(g.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                    Text(([ "You" ] + g.members.map { client.name(ofBox: $0) }).joined(separator: ", "))
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                }
                Spacer()
                Menu {
                    Button("Add friends…") { groupPick = []; groupNote = nil; addToGroupKey = g.key }
                    Button("Clear chat…", role: .destructive) { confirmClear = true }
                    Button("Leave group", role: .destructive) { confirmLeave = true }
                } label: { Image(systemName: "ellipsis.circle") }
                    .menuStyle(.borderlessButton).frame(width: 28)
            }
            if client.unreachable(g) > 0 {
                Text("\(client.unreachable(g)) in this group aren't your friends, so you can't message or hear from them here.")
                    .font(.system(size: 10)).foregroundStyle(.orange).frame(maxWidth: .infinity, alignment: .leading)
            }
            messageList(g.key, empty: "Say hi to the group. Each message is encrypted for every member who is your friend.", group: true)
            if let problem = client.lastProblem { Text(problem).font(.system(size: 10)).foregroundStyle(.orange) }
            composer(key: g.key, typing: false) { sendToGroup(g) }
        }
    }

    private func sendToGroup(_ g: FriendGroup) {
        client.lastProblem = nil
        client.sendToGroup(draft, key: g.key); draft = ""
    }

    private func attach(to key: String) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false; panel.canChooseDirectories = false
        panel.message = "Choose a file to send (up to \(Friends.maxFileText))"
        if panel.runModal() == .OK, let url = panel.url { client.lastProblem = client.sendFile(url, to: key) }
    }

    /// The message box, the paperclip and the send button, the same for a friend and a group.
    private func composer(key: String, typing: Bool, send: @escaping () -> Void) -> some View {
        HStack(spacing: 6) {
            Button { attach(to: key) } label: { Image(systemName: "paperclip").font(.system(size: 15)).frame(width: 28, height: 28).contentShape(Rectangle()) }
                .buttonStyle(MetalPlainStyle()).foregroundStyle(Theme.textSecondary).help("Send a file (up to \(Friends.maxFileText)). It is encrypted like a message.")
            TextField("Message", text: $draft)
                .textFieldStyle(.plain).foregroundStyle(Theme.textPrimary).font(.system(size: 13)).padding(.horizontal, 12).frame(height: 32)
                .background(Theme.surface, in: Capsule())
                .onSubmit(send)
                .onChange(of: draft) { _, new in if typing, !new.isEmpty { client.typingChanged(to: key) } }
            Button(action: send) { Image(systemName: "arrow.up") }
                .buttonStyle(PurpleButtonStyle()).disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty).help("Send (Return)")
        }
    }

    private func messageList(_ key: String, empty: String, group: Bool) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    if client.messages(key).isEmpty {
                        Text(empty).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).frame(maxWidth: .infinity).padding(.top, 20)
                    }
                    ForEach(client.messages(key)) { m in
                        FriendBubble(message: m, senderName: group && !m.mine ? client.name(ofBox: m.by) : nil,
                                     open: { file in client.reveal(fileID: m.id, name: file.name, chat: key) }) { client.retry(m.id, in: key) }.id(m.id)
                    }
                }
            }
            .defaultScrollAnchor(.bottom)
            .onChange(of: client.messages(key).count) { _, _ in
                withAnimation(Theme.spring) { proxy.scrollTo(client.messages(key).last?.id, anchor: .bottom) }
                if client.viewing == key { client.markRead(key) }
            }
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

    /// Your own code, always in view at the bottom of the sidebar (never over the message bar), so it is easy to read out or
    /// copy; the QR shows the same code.
    private var myCodePill: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Your code").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            HStack(spacing: 6) {
                Text(Friends.displayCode(client.identity.code)).font(.system(size: 13, weight: .bold, design: .monospaced)).foregroundStyle(Theme.textPrimary).textSelection(.enabled)
                    .lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                Button { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(Friends.displayCode(client.identity.code), forType: .string)
                    copiedCode = true; DispatchQueue.main.asyncAfter(deadline: .now() + 2) { copiedCode = false } } label: {
                    Image(systemName: copiedCode ? "checkmark" : "doc.on.doc").font(.system(size: 11))
                }.buttonStyle(MetalPlainStyle()).hitTarget().foregroundStyle(Theme.accentBright).help("Copy your friend code")
                Button { showQR = true } label: { Image(systemName: "qrcode").font(.system(size: 12)) }
                    .buttonStyle(MetalPlainStyle()).hitTarget().foregroundStyle(Theme.accentBright).help("Show your QR code")
                    .popover(isPresented: $showQR) {
                        VStack(spacing: 8) {
                            if let qr = FriendsSettingsSection.qr(client.identity.link) { Image(nsImage: qr).interpolation(.none).resizable().frame(width: 170, height: 170) }
                            Text(Friends.displayCode(client.identity.code)).font(.system(size: 14, weight: .bold, design: .monospaced))
                            Text("A friend scans this with their camera, or types the code.").font(.system(size: 11)).foregroundStyle(.secondary).frame(width: 190)
                        }.padding(14)
                    }
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Theme.separator))
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
                Text(friend.displayName).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                if client.typing.contains(friend.box) { Text("typing…").font(.system(size: 11)).foregroundStyle(Theme.accentBright) }
                Spacer()
                FriendGamesMenu(client: client, box: friend.box, play: client.play(friend.box))
                Button { showSafety = true } label: { Label("Safety number", systemImage: "checkmark.shield") }
                    .buttonStyle(PurpleButtonStyle(prominent: false)).help("Compare these numbers with your friend to be sure nobody is in the middle")
                    .popover(isPresented: $showSafety) { safety(friend) }
                Menu {
                    Button("Nickname…") { aliasDraft = friend.alias ?? ""; renaming = true }
                    Button("Clear chat…", role: .destructive) { confirmClear = true }
                    Button("Remove friend", role: .destructive) { confirmRemove = true }
                    Button("Block", role: .destructive) { client.block(friend.box); selected = nil }
                } label: { Image(systemName: "ellipsis.circle") }.menuStyle(.borderlessButton).frame(width: 28)
            }
            .popover(isPresented: $renaming) { nicknameEditor(friend) }
            if let game = client.games[friend.box] { TicTacToeCard(io: gameIO(friend.box), game: game, myID: client.identity.box) }
            PlayCard(play: client.play(friend.box), source: "friend-play")
            messageList(friend.box, empty: "Say hi. Messages are encrypted on this Mac; the server only holds them until \(friend.displayName) is online.", group: false)
            if let problem = client.lastProblem { Text(problem).font(.system(size: 10)).foregroundStyle(.orange) }
            composer(key: friend.box, typing: true) { send(friend) }
        }
    }

    private var clearCard: some View {
        ZStack {
            Color.black.opacity(0.55).onTapGesture { confirmClear = false }
            VStack(alignment: .leading, spacing: 10) {
                Text(clearTitle).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                Text(Self.clearWarning(who: clearWho)).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                HStack {
                    Spacer()
                    Button("Cancel") { confirmClear = false }.buttonStyle(PurpleButtonStyle(prominent: false))
                    Button(clearButton) { if let key = selected { client.clearChat(key); draft = "" }; confirmClear = false }
                        .buttonStyle(PurpleButtonStyle())
                }
            }
            .padding(14).frame(maxWidth: 380)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.white.opacity(0.15)))
        }
    }

    private var clearIsGroup: Bool { selected.map(Friends.isGroupKey) ?? false }
    private var clearTitle: String { clearIsGroup ? "Clear this group chat for everyone?" : "Clear this chat?" }
    private var clearButton: String { clearIsGroup ? "Clear chat for everyone" : "Clear chat for both of us" }
    private var clearWho: String {
        guard let key = selected else { return "them" }
        if Friends.isGroupKey(key) { return "everyone in \(client.group(key)?.name ?? "the group")" }
        return client.book.record(key)?.displayName ?? "them"
    }

    /// What "Clear chat" does and does not do, in plain words (the same limits are in docs/GUIDES.md).
    static func clearWarning(who: String) -> String {
        "This deletes the whole chat for you and for \(who), including files saved from it, and cannot be undone. You both stay friends. "
        + "Notch Apple removes its own copies on both sides. It can't erase screenshots, anything copied or saved outside the app, or a modified app that ignores the request. "
        + "If \(who) is offline it is applied when they come online, and only an up-to-date Notch Apple honours it."
    }

    private func gameIO(_ box: String) -> TTTIO {
        TTTIO(name: { client.gameName($0, friend: box) }, accept: { client.acceptTicTacToe(box) }, cancel: { client.cancelTicTacToeInvite(box) },
              rematch: { client.rematchTicTacToe(box) }, leave: { client.leaveTicTacToe(box) }, close: { client.closeTicTacToe(box) },
              move: { client.playTicTacToe($0, with: box) })
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
                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).frame(width: 260, alignment: .leading)
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

/// The Games menu in a friend chat; it watches that chat's games so it hides while one is open.
private struct FriendGamesMenu: View {
    @ObservedObject var client: FriendsClient
    let box: String
    @ObservedObject var play: PlayController
    var body: some View {
        if client.games[box]?.isFinished ?? true, !play.isActive {
            GamesMenu(tictactoe: { client.inviteToTicTacToe(box) }, start: { play.invite($0) })
        }
    }
}

private struct FriendBubble: View {
    let message: FriendMessage
    var senderName: String? = nil
    var open: (FriendFile) -> Void = { _ in }
    var retry: () -> Void

    var body: some View {
        if message.isNotice {
            Text(message.text).font(.system(size: 11)).italic().foregroundStyle(Theme.textSecondary)
                .frame(maxWidth: .infinity).padding(.vertical, 6).accessibilityLabel(message.text)
        } else { bubble }
    }

    private var bubble: some View {
        HStack(alignment: .bottom) {
            if message.mine { Spacer(minLength: 60) }
            VStack(alignment: message.mine ? .trailing : .leading, spacing: 2) {
                if let senderName {
                    Text(senderName).font(.system(size: 11, weight: .semibold)).foregroundStyle(MessengerMessage.color(for: message.by ?? senderName))
                }
                if let file = message.file {
                    Button { open(file) } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "doc.fill")
                            VStack(alignment: .leading, spacing: 0) {
                                Text(file.name).font(.system(size: 12, weight: .medium)).lineLimit(1).truncationMode(.middle)
                                Text(Self.size(file.size)).font(.system(size: 10)).opacity(0.7)
                            }
                        }
                        .foregroundStyle(message.mine ? Theme.onAccent : Theme.textPrimary).padding(.horizontal, 10).padding(.vertical, 6).frame(maxWidth: 240, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(message.mine ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Theme.surfaceHover)))
                    }
                    .buttonStyle(MetalPlainStyle()).help("Show in Finder")
                }
                if !message.text.isEmpty {
                    Text(message.text).font(.system(size: 13)).foregroundStyle(message.mine ? Theme.onAccent : Theme.textPrimary).textSelection(.enabled)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(message.mine ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Theme.surfaceHover)))
                }
                HStack(spacing: 4) {
                    Text(message.date, style: .time)
                    if message.mine { stateLabel }
                }
                .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
            if !message.mine { Spacer(minLength: 60) }
        }
    }

    private static func size(_ bytes: Int) -> String { bytes < 1000 ? "\(bytes) B" : String(format: "%.0f KB", Double(bytes) / 1000) }

    @ViewBuilder private var stateLabel: some View {
        switch message.state {
        case .sending: Text("· sending…")
        case .sent: Text("· sent")
        case .delivered: Text("· delivered")
        case .read: Text("· read").foregroundStyle(Theme.accentBright)
        case .failed: Button("· failed, tap to retry", action: retry).buttonStyle(MetalPlainStyle()).foregroundStyle(.orange)
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
                ForEach(client.book.blockedPeople) { b in
                    LabeledContent(b.name) { Button("Unblock") { client.unblock(b.fingerprint) } }
                }
                LabeledContent("Everyone you blocked") { Button("Unblock all (\(client.book.vault.blocked.count))") { client.unblockAll() } }
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
