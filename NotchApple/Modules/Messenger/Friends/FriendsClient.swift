//
//  FriendsClient.swift
//  Notch Apple
//
//  Messenger → Friends, the network side. It keeps one WebSocket to this Mac's mailbox on Notch Apple's relay
//  (server/room-relay, src/friends.js), turns what arrives into FriendsBook changes, and does the HTTP calls for adding,
//  accepting, sending and removing. Everything leaves the Mac sealed (FriendCrypto); the server only sees random IDs.
//  Off until you open Messenger → Friends for the first time. The format is docs/FRIENDS_PROTOCOL.md.
//

import AppKit
import Foundation
import SwiftUI

@MainActor
final class FriendsClient: ObservableObject {
    static let shared = FriendsClient()

    enum Link: Equatable { case off, connecting, online, problem(String) }

    /// Switched on the first time Friends is opened; from then on the app connects at launch.
    @AppStorage("friends.active") var active = false
    @AppStorage("friends.nick") var nick = ""
    @AppStorage("friends.receipts") var receipts = true

    @Published private(set) var link: Link = .off
    @Published private(set) var book = FriendsBook()
    @Published private(set) var typing: Set<String> = []
    /// The friend whose chat is on screen right now (so their messages don't pile up as unread).
    var viewing: String?

    private(set) var identity: FriendIdentity
    private let store = FriendsStore.shared
    private let base = URL(string: "https://notchapple-rooms.adityajain1225.workers.dev")!
    private var socket: URLSessionWebSocketTask?
    private var session = URLSession(configuration: .ephemeral)
    private var lastTs: Int64 = 0
    private var attempt = 0
    private var reconnectWork: Task<Void, Never>?
    private var saveWork: Task<Void, Never>?
    private var lastTypingSent: [String: Date] = [:]
    private var readSent = Set<String>()
    private var claimed = false

    private init() {
        identity = store.identity()
        book.vault = store.load()
    }

    var displayNick: String { nick.trimmingCharacters(in: .whitespaces).isEmpty ? MessengerIdentity.shared.handle : nick }
    var incoming: [FriendRecord] { book.vault.friends.filter { $0.status == .incoming }.sorted { $0.added < $1.added } }
    var pending: [FriendRecord] { book.vault.friends.filter { $0.status == .outgoing }.sorted { $0.added < $1.added } }
    var friends: [FriendRecord] { book.vault.friends.filter { $0.status == .active }.sorted { $0.lastActivity > $1.lastActivity } }
    func messages(_ box: String) -> [FriendMessage] { book.vault.messages[box] ?? [] }
    var totalUnread: Int { book.vault.friends.reduce(0) { $0 + $1.unread } + incoming.count }

    // MARK: Starting and stopping

    func startIfActive() { if active { connect() } }

    /// Called when the Friends screen first opens.
    func activate() { active = true; connect() }

    func connect() {
        guard socket == nil else { return }
        reconnectWork?.cancel()
        link = .connecting
        Task {
            if !claimed { guard await claim() else { scheduleReconnect(); return } }
            openSocket()
        }
        if !watchingWake {
            watchingWake = true
            NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.wake() }
            }
        }
    }
    private var watchingWake = false

    func disconnect() {
        reconnectWork?.cancel(); socket?.cancel(with: .goingAway, reason: nil); socket = nil; link = .off
    }

    private func wake() { if active { socket?.cancel(with: .goingAway, reason: nil); socket = nil; attempt = 0; connect() } }

    private func scheduleReconnect() {
        socket = nil
        attempt += 1
        let delay = min(60.0, pow(2.0, Double(min(attempt, 6))))
        reconnectWork?.cancel()
        reconnectWork = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await MainActor.run { self?.connect() }
        }
    }

    // MARK: HTTP

    private func nextTs() -> Int64 { lastTs = max(Int64(Date().timeIntervalSince1970 * 1000), lastTs + 1); return lastTs }

    private func call(_ method: String, _ path: String, body: [String: Any]? = nil, owner: Bool = false) async -> (status: Int, json: [String: Any]) {
        var req = URLRequest(url: base.appendingPathComponent(String(path.dropFirst())))
        req.httpMethod = method
        req.timeoutInterval = 20
        var text = ""
        if let body, let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) {
            text = String(decoding: data, as: UTF8.self)
            req.httpBody = data
            req.setValue("application/json", forHTTPHeaderField: "content-type")
        }
        if owner {
            req.setValue(identity.box, forHTTPHeaderField: "x-nf-box")
            req.setValue(FriendCrypto.authHeader(identity, method: method, path: path, ts: nextTs(), body: text), forHTTPHeaderField: "x-nf-auth")
        }
        do {
            let (data, res) = try await session.data(for: req)
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            return ((res as? HTTPURLResponse)?.statusCode ?? 0, json)
        } catch { return (0, [:]) }
    }

    private func explain(_ status: Int, _ json: [String: Any]) -> String {
        switch status {
        case 0: return "Can't reach the server. Check your internet connection."
        case 429: return "Too many tries. Wait a minute and try again."
        case 507: return "Their mailbox is full."
        default: return (json["error"] as? String) ?? "Something went wrong (\(status))."
        }
    }

    /// Registers this Mac's keys for its mailbox (safe to repeat).
    private func claim() async -> Bool {
        let r = await call("POST", "/f/claim", body: ["box": identity.box, "sign": Friends.b64u(identity.signPublic), "dh": Friends.b64u(identity.dhPublic)], owner: true)
        if r.status == 200 { claimed = true; return true }
        link = .problem(explain(r.status, r.json))
        return false
    }

    // MARK: The socket

    private func openSocket() {
        let path = "/f/ws/\(identity.box)"
        var comps = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        comps.scheme = "wss"; comps.path = path
        comps.queryItems = [URLQueryItem(name: "a", value: FriendCrypto.authHeader(identity, method: "GET", path: path, ts: nextTs()))]
        guard let url = comps.url else { return }
        let task = session.webSocketTask(with: url)
        socket = task
        task.resume()
        listen(task)
        heartbeat(task)
    }

    private func listen(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, task === self.socket else { return }
                switch result {
                case .success(let message):
                    if case .string(let text) = message { await self.handle(text) }
                    self.listen(task)
                case .failure:
                    self.link = .connecting
                    self.scheduleReconnect()
                }
            }
        }
    }

    private func heartbeat(_ task: URLSessionWebSocketTask) {
        Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 25_000_000_000)
                guard let self, await self.socket === task else { return }
                task.send(.string("ping")) { _ in }
            }
        }
    }

    private func handle(_ text: String) async {
        guard text != "pong", let obj = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any], let type = obj["type"] as? String else { return }
        var acks: [Int] = []
        switch type {
        case "hello":
            attempt = 0; link = .online
            for item in (obj["requests"] as? [[String: Any]] ?? []) { if let id = item["id"] as? Int, let blob = item["blob"] as? String { processRequest(blob); acks.append(id) } }
            for item in (obj["queue"] as? [[String: Any]] ?? []) { if let id = item["id"] as? Int, let blob = item["blob"] as? String { await processMessage(blob); acks.append(id) } }
        case "req": if let id = obj["id"] as? Int, let blob = obj["blob"] as? String { processRequest(blob); acks.append(id) }
        case "msg": if let id = obj["id"] as? Int, let blob = obj["blob"] as? String { await processMessage(blob); acks.append(id) }
        case "live": if let blob = obj["blob"] as? String { processLive(blob) }
        default: break
        }
        if !acks.isEmpty, let data = try? JSONSerialization.data(withJSONObject: ["ack": acks]) { socket?.send(.string(String(decoding: data, as: UTF8.self))) { _ in } }
        persist()
    }

    // MARK: What arrives

    private func processRequest(_ blob: String) {
        guard let opened = FriendCrypto.open(blob: blob, kind: "req", myBox: identity.box, dhSeed: identity.dhSeed),
              let body = FriendBody.decode(opened.text), body.t == "req", let signText = body.sign, let sign = Friends.unb64u(signText),
              FriendCrypto.isFrom(signPublic: sign, myBox: identity.box, kind: "req", opened: opened) else { return }
        switch book.receiveRequest(body) {
        case .added(let r):
            MessengerNotifier.shared.friendEvent(title: "Friend request", body: "\(r.displayName) wants to be friends.", id: "req-\(r.box)")
        case .mutual(let r):
            MessengerNotifier.shared.friendEvent(title: "You're friends", body: "You and \(r.displayName) are now friends.", id: "mutual-\(r.box)")
        case .ignored: break
        }
    }

    private func sender(of body: FriendBody) -> FriendRecord? { (body.from ?? body.box).flatMap { book.record($0) } }

    private func openFromFriend(_ blob: String) -> (FriendBody, FriendRecord)? {
        guard let opened = FriendCrypto.open(blob: blob, kind: "msg", myBox: identity.box, dhSeed: identity.dhSeed),
              let body = FriendBody.decode(opened.text), let friend = sender(of: body),
              FriendCrypto.isFrom(signPublic: friend.sign, myBox: identity.box, kind: "msg", opened: opened) else { return nil }
        return (body, friend)
    }

    private func processMessage(_ blob: String) async {
        guard let (body, friend) = openFromFriend(blob) else { return }
        switch body.t {
        case "acc":
            if let r = book.receiveAcceptance(body) {
                MessengerNotifier.shared.friendEvent(title: "Friend request accepted", body: "\(r.displayName) accepted. You can chat now.", id: "acc-\(r.box)")
            }
        case "msg":
            guard let id = body.id, let text = body.text, let m = book.receiveMessage(from: friend.box, id: id, text: text, ts: body.ts) else { return }
            if viewing == friend.box { book.markRead(box: friend.box) }
            else { MessengerNotifier.shared.friendMessage(from: friend.displayName, box: friend.box, text: m.text, id: id) }
            if receipts { sendReceipt(to: friend, id: id, state: viewing == friend.box ? "read" : "delivered") }
            typing.remove(friend.box)
        case "rcpt":
            if let id = body.id, let state = body.state { book.setState(box: friend.box, id: id, state == "read" ? .read : .delivered) }
        case "gone":
            book.remove(box: friend.box)
        default: break
        }
    }

    private func processLive(_ blob: String) {
        guard let (body, friend) = openFromFriend(blob), body.t == "typing" else { return }
        typing.insert(friend.box)
        Task { try? await Task.sleep(nanoseconds: 6_000_000_000); await MainActor.run { _ = self.typing.remove(friend.box) } }
    }

    // MARK: Adding, accepting, blocking, removing

    /// Adds a friend from a typed code or a notchapple://friend link. Returns a message when it didn't work.
    func addFriend(_ input: String, alias: String? = nil) async -> String? {
        guard let parsed = Friends.parse(input) else { return "That doesn't look like a friend code. It has 10 letters and numbers." }
        let box = Friends.box(for: parsed.code)
        if box == identity.box { return "That's your own code." }
        if let existing = book.record(box) { return existing.status == .active ? "You're already friends." : "You already asked this person." }
        activate()
        var ready = claimed
        if !ready { ready = await claim() }
        guard ready else { return "Can't reach the server. Check your internet connection." }
        let key = await call("GET", "/f/key/\(box)")
        guard key.status == 200, let signText = key.json["sign"] as? String, let dhText = key.json["dh"] as? String,
              let sign = Friends.unb64u(signText), let dh = Friends.unb64u(dhText) else {
            return key.status == 404 ? "No one has that code yet. Check it and try again." : explain(key.status, key.json)
        }
        if let fp = parsed.fingerprint, fp != FriendCrypto.fingerprint(sign: sign, dh: dh) { return "That code's keys don't match the QR code. Someone may be interfering, so don't add it." }
        if book.isBlocked(sign: sign, dh: dh) { return "You blocked this person. Unblock them in Settings → Messenger first." }
        let mine = Friends.newToken()
        let allow = await call("PUT", "/f/allow", body: ["hash": mine.hash], owner: true)
        guard allow.status == 200 else { return explain(allow.status, allow.json) }
        let body = FriendBody(t: "req", box: identity.box, sign: Friends.b64u(identity.signPublic), dh: Friends.b64u(identity.dhPublic),
                              nick: displayNick, token: mine.token, ts: Int64(Date().timeIntervalSince1970 * 1000))
        guard let blob = try? FriendCrypto.seal(bodyText: body.encoded(), kind: "req", from: identity, toBox: box, toDH: dh) else { return "Couldn't prepare the request." }
        let sent = await call("POST", "/f/req", body: ["to": box, "blob": blob])
        guard sent.status == 202 else { _ = await call("DELETE", "/f/allow/\(mine.hash)", owner: true); return explain(sent.status, sent.json) }
        book.addOutgoing(box: box, sign: sign, dh: dh, alias: FriendsBook.clean(alias), myTokenHash: mine.hash)
        persist()
        return nil
    }

    func accept(_ box: String) async -> String? {
        guard let r = book.record(box), r.status == .incoming, let theirToken = r.pendingToken else { return "That request is gone." }
        let mine = Friends.newToken()
        let allow = await call("PUT", "/f/allow", body: ["hash": mine.hash], owner: true)
        guard allow.status == 200 else { return explain(allow.status, allow.json) }
        let body = FriendBody(t: "acc", box: identity.box, sign: Friends.b64u(identity.signPublic), dh: Friends.b64u(identity.dhPublic),
                              nick: displayNick, token: mine.token, ts: Int64(Date().timeIntervalSince1970 * 1000))
        guard let blob = try? FriendCrypto.seal(bodyText: body.encoded(), kind: "msg", from: identity, toBox: r.box, toDH: r.dh) else { return "Couldn't prepare the answer." }
        let sent = await call("POST", "/f/send", body: ["to": r.box, "token": theirToken, "blob": blob])
        guard sent.status == 200 else { _ = await call("DELETE", "/f/allow/\(mine.hash)", owner: true); return explain(sent.status, sent.json) }
        _ = book.accept(box: box, myTokenHash: mine.hash)
        persist()
        return nil
    }

    func block(_ box: String) {
        let hash = book.record(box)?.myTokenHash
        book.block(box: box); persist()
        if let hash { Task { _ = await call("DELETE", "/f/allow/\(hash)", owner: true) } }
    }

    func remove(_ box: String) {
        guard let r = book.record(box) else { return }
        let hash = r.myTokenHash
        if r.status == .active { sendControl("gone", to: r) }
        book.remove(box: box); persist()
        if let hash { Task { _ = await call("DELETE", "/f/allow/\(hash)", owner: true) } }
    }

    func setAlias(_ box: String, _ alias: String?) { book.setAlias(box: box, alias); persist() }
    func unblockAll() { book.unblockAll(); persist() }

    /// "Delete all my chat data": the server mailbox, the history, friends and block list. The code and keys stay.
    func deleteEverything() async {
        disconnect()
        _ = await call("POST", "/f/wipe", body: [:], owner: true)
        store.wipe()
        book = FriendsBook(); typing = []; claimed = false
        MessengerNotifier.shared.markAllRead()
        if active { connect() }
    }

    // MARK: Sending

    func send(_ text: String, to box: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, t.count <= 2000, let friend = book.record(box), friend.status == .active else { return }
        let id = UUID().uuidString
        book.addMine(to: box, id: id, text: t); persist()
        Task { await deliver(id: id, text: t, to: friend) }
    }

    func retry(_ id: String, in box: String) {
        guard let friend = book.record(box), let m = messages(box).first(where: { $0.id == id && $0.mine && $0.state == .failed }) else { return }
        if var list = book.vault.messages[box], let i = list.firstIndex(where: { $0.id == id }) { list[i].state = .sending; book.vault.messages[box] = list }
        Task { await deliver(id: id, text: m.text, to: friend) }
    }

    private func deliver(id: String, text: String, to friend: FriendRecord) async {
        guard let token = friend.sendToken else { book.setState(box: friend.box, id: id, .failed); return }
        let body = FriendBody(t: "msg", from: identity.box, id: id, text: text, ts: Int64(Date().timeIntervalSince1970 * 1000))
        guard let blob = try? FriendCrypto.seal(bodyText: body.encoded(), kind: "msg", from: identity, toBox: friend.box, toDH: friend.dh) else { book.setState(box: friend.box, id: id, .failed); return }
        let r = await call("POST", "/f/send", body: ["to": friend.box, "token": token, "blob": blob])
        book.setState(box: friend.box, id: id, r.status == 200 ? .sent : .failed)
        if r.status == 403 { lastProblem = "\(friend.displayName) removed you or hasn't accepted." } else if r.status != 200 { lastProblem = explain(r.status, r.json) }
        persist()
    }

    @Published var lastProblem: String?

    private func sendReceipt(to friend: FriendRecord, id: String, state: String) {
        guard let token = friend.sendToken else { return }
        let key = "\(id)|\(state)"
        guard readSent.insert(key).inserted else { return }
        let body = FriendBody(t: "rcpt", from: identity.box, id: id, state: state, ts: Int64(Date().timeIntervalSince1970 * 1000))
        guard let blob = try? FriendCrypto.seal(bodyText: body.encoded(), kind: "msg", from: identity, toBox: friend.box, toDH: friend.dh) else { return }
        Task { _ = await call("POST", "/f/send", body: ["to": friend.box, "token": token, "blob": blob]) }
    }

    private func sendControl(_ type: String, to friend: FriendRecord) {
        guard let token = friend.sendToken else { return }
        let body = FriendBody(t: type, from: identity.box, ts: Int64(Date().timeIntervalSince1970 * 1000))
        guard let blob = try? FriendCrypto.seal(bodyText: body.encoded(), kind: "msg", from: identity, toBox: friend.box, toDH: friend.dh) else { return }
        Task { _ = await call("POST", "/f/send", body: ["to": friend.box, "token": token, "blob": blob]) }
    }

    /// Called as someone types; sends at most one "typing" signal every 3 seconds.
    func typingChanged(to box: String) {
        guard receipts, let friend = book.record(box), friend.status == .active, let token = friend.sendToken else { return }
        if let last = lastTypingSent[box], Date().timeIntervalSince(last) < 3 { return }
        lastTypingSent[box] = Date()
        let body = FriendBody(t: "typing", from: identity.box, ts: Int64(Date().timeIntervalSince1970 * 1000))
        guard let blob = try? FriendCrypto.seal(bodyText: body.encoded(), kind: "msg", from: identity, toBox: friend.box, toDH: friend.dh) else { return }
        Task { _ = await call("POST", "/f/send", body: ["to": friend.box, "token": token, "blob": blob, "live": true]) }
    }

    /// The chat is on screen: clear the unread count and tell the friend (if receipts are on).
    func markRead(_ box: String) {
        book.markRead(box: box)
        guard receipts, let friend = book.record(box) else { return }
        for m in messages(box).suffix(20) where !m.mine { sendReceipt(to: friend, id: m.id, state: "read") }
        persist()
    }

    // MARK: Saving

    private func persist() {
        saveWork?.cancel()
        saveWork = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled, let self else { return }
            self.store.save(self.book.vault)
        }
        MessengerNotifier.shared.setFriendsUnread(totalUnread)
    }
}
