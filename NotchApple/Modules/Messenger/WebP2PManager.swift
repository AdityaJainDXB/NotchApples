//
//  WebP2PManager.swift
//  Notch apple
//
//  "Anonymous Room" chat over the internet with zero developer cost.
//
//  How it works:
//   • The room code (e.g. `#cafe-study` or `8821`) is normalised and hashed
//     locally with SHA-256 twice, with different labels:
//       – one hash becomes the relay topic,
//       – the other becomes a 256-bit AES-GCM key.
//     The relay therefore never sees the room name, and can't read messages.
//   • Messages travel through a free, public relay over TLS WebSockets:
//       1. ntfy.sh (open source, port 443, so it works on school and office
//          networks that block other ports). Every publish sends
//          `Cache: no`, so the relay forwards it live and stores nothing.
//       2. Public MQTT brokers (QoS 0, never retained) as fallbacks.
//     Every Mac connects to all of them at once and sends through each (duplicates are
//     dropped), so people whose networks block different relays still reach each other.
//   • Presence: every client announces itself (encrypted) every 30 s, which
//     builds the "online in this room" list.
//
//  A real WebRTC data channel would need Google's WebRTC library as a large
//  dependency; an end-to-end-encrypted relay gives the same privacy with no
//  dependencies, no accounts and no cost.
//
//  Note: short numeric codes are easy to guess. Anyone who knows (or guesses)
//  the code can join, so longer room names are more private. The UI says so.
//

import Foundation
import CryptoKit

@MainActor
final class WebP2PManager: ObservableObject {
    static let shared = WebP2PManager()

    /// Free public relays, tried in order.
    enum Relay {
        case ntfy(host: String)
        case mqtt(URL)
    }
    static let relays: [Relay] = [
        .ntfy(host: "ntfy.sh"),
        .mqtt(URL(string: "wss://broker.emqx.io:8084/mqtt")!),
        .mqtt(URL(string: "wss://broker.hivemq.com:8884/mqtt")!),
        .mqtt(URL(string: "wss://test.mosquitto.org:8081/mqtt")!),
    ]

    enum State: Equatable { case idle, connecting, joined, failed(String) }

    @Published private(set) var state: State = .idle
    @Published private(set) var room: String?
    @Published private(set) var members: [String: (handle: String, lastSeen: Date)] = [:] {
        didSet { memberCount = members.count }
    }
    @Published private(set) var memberCount = 0
    @Published private(set) var messages: [MessengerMessage] = []

    private var key: SymmetricKey?
    private var topic: String?
    /// One live connection per relay. Every Mac connects to all relays it can reach, sends
    /// through each and drops duplicates, so two people on different networks (where one
    /// relay is blocked) still end up talking to each other.
    private var links: [Int: Link] = [:]
    private var generation = 0
    private var presenceTimer: Timer?
    private var pingTimer: Timer?
    private var seenIDs = Set<UUID>()
    private let identity = MessengerIdentity.shared

    var memberHandles: [String] { members.values.map(\.handle).sorted() }

    // MARK: Room lifecycle

    /// Normalises what the user typed so `#Cafe-Study ` and `cafe-study` are the same room.
    static func normalize(_ raw: String) -> String {
        var r = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        while r.hasPrefix("#") { r.removeFirst() }
        return r
    }

    /// A fresh, readable, hard-to-guess room code, e.g. `violet-otter-4821-k7qz`.
    static func newRoomCode() -> String {
        let words = ["violet", "amber", "cobalt", "coral", "jade", "lunar", "solar", "misty", "velvet", "neon",
                     "maple", "cedar", "orbit", "pixel", "ember", "frost"]
        let animals = ["otter", "panda", "falcon", "lynx", "koala", "raven", "tiger", "gecko",
                       "moose", "heron", "bison", "dingo", "manta", "puffin", "yak", "zebra"]
        let alphabet = Array("abcdefghjkmnpqrstuvwxyz23456789")
        var rng = SystemRandomNumberGenerator()
        let tail = String((0..<4).map { _ in alphabet.randomElement(using: &rng)! })
        return "\(words.randomElement(using: &rng)!)-\(animals.randomElement(using: &rng)!)-\(Int.random(in: 1000...9999, using: &rng))-\(tail)"
    }

    func join(_ rawRoom: String) {
        let room = Self.normalize(rawRoom)
        guard !room.isEmpty else { return }
        leave(remember: true)
        self.room = room
        key = SymmetricKey(data: SHA256.hash(data: Data("notchapple-room-key|\(room)".utf8)))
        let topicHash = SHA256.hash(data: Data("notchapple-room-topic|\(room)".utf8))
            .map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(room, forKey: "messenger.activeRoom")
        topic = "notchapple-v1-\(topicHash.prefix(40))"    // valid for both ntfy and MQTT
        state = .connecting
        generation += 1
        for i in Self.relays.indices { connect(i) }
        scheduleGiveUpCheck()
    }

    /// Leaves the room. `remember: false` is used on quit so the room is rejoined next launch.
    func leave(remember: Bool = false) {
        if !remember { UserDefaults.standard.removeObject(forKey: "messenger.activeRoom") }
        if state == .joined { publish(kind: .leave, text: nil) }
        presenceTimer?.invalidate(); pingTimer?.invalidate()
        presenceTimer = nil; pingTimer = nil
        generation += 1
        for link in links.values { link.socket.cancel(with: .normalClosure, reason: nil) }
        links = [:]
        members = [:]
        state = .idle
        room = nil
    }

    func clear() { messages.removeAll(); seenIDs.removeAll() }

    // MARK: Messaging

    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, state == .joined else { return }
        let env = publish(kind: .message, text: String(trimmed.prefix(2000)))
        seenIDs.insert(env.id)
        messages.append(MessengerMessage(id: env.id, senderID: identity.senderID, sender: identity.handle,
                                         text: trimmed, date: env.ts, isMine: true))
    }

    @discardableResult
    private func publish(kind: MessengerEnvelope.Kind, text: String?) -> MessengerEnvelope {
        let env = MessengerEnvelope(kind: kind, id: UUID(), senderID: identity.senderID,
                                    sender: identity.handle, text: text, ts: .now)
        // Only publish once at least one relay is live (timers can fire while reconnecting).
        guard state == .joined || kind == .leave,
              let key, let topic, let json = try? JSONEncoder().encode(env),
              let sealed = try? AES.GCM.seal(json, using: key).combined else { return env }
        // Send through every relay we're connected to; receivers drop the duplicates by ID.
        for (i, link) in links where link.joined {
            switch Self.relays[i] {
            case .ntfy(let host):
                // Publish over HTTPS. `Cache: no` = forward live, store nothing.
                var request = URLRequest(url: URL(string: "https://\(host)/\(topic)")!)
                request.httpMethod = "POST"
                request.setValue("no", forHTTPHeaderField: "Cache")
                request.setValue("no", forHTTPHeaderField: "Firebase")
                request.httpBody = Data(sealed.base64EncodedString().utf8)
                URLSession.shared.dataTask(with: request).resume()
            case .mqtt:
                send(MQTT.publish(topic: topic, payload: sealed), on: i)
            }
        }
        return env
    }

    private func receive(payload: Data) {
        guard let key, let box = try? AES.GCM.SealedBox(combined: payload),
              let json = try? AES.GCM.open(box, using: key),
              let env = try? JSONDecoder().decode(MessengerEnvelope.self, from: json) else { return }  // not for us / tampered
        // Ignore stale or replayed traffic.
        guard abs(env.ts.timeIntervalSinceNow) < 3600 else { return }   // allows for Macs whose clocks differ
        let isMe = env.senderID == identity.senderID

        switch env.kind {
        case .presence:
            // The same envelope arrives once per relay; handle it once.
            guard !seenIDs.contains(env.id) else { return }
            seenIDs.insert(env.id)
            if !isMe {
                if members[env.senderID] == nil {
                    notice("\(env.sender) joined")
                    // Say hello back so the newcomer sees us right away, not 30 s later.
                    publish(kind: .presence, text: nil)
                }
                members[env.senderID] = (String(env.sender.prefix(32)), .now)
            }
        case .leave:
            guard !seenIDs.contains(env.id) else { return }
            seenIDs.insert(env.id)
            if let m = members.removeValue(forKey: env.senderID) { notice("\(m.handle) left") }
        case .message:
            guard !isMe, !seenIDs.contains(env.id), let text = env.text else { return }
            seenIDs.insert(env.id)
            if members[env.senderID] == nil { notice("\(env.sender) joined") }
            members[env.senderID] = (String(env.sender.prefix(32)), .now)
            messages.append(MessengerMessage(id: env.id, senderID: env.senderID, sender: String(env.sender.prefix(32)),
                                             text: String(text.prefix(2000)), date: env.ts, isMine: false))
            MessengerNotifier.shared.incoming(messages[messages.count - 1], source: "Room #\(room ?? "")")
        }
    }

    private func notice(_ text: String) {
        messages.append(MessengerMessage(id: UUID(), senderID: "system", sender: "", text: text,
                                         date: .now, isMine: false, isNotice: true))
    }

    // MARK: Transport

    private final class Link {
        let socket: URLSessionWebSocketTask
        var buffer = Data()
        var joined = false
        init(_ socket: URLSessionWebSocketTask) { self.socket = socket }
    }

    private func connect(_ i: Int) {
        guard let topic else { return }
        let task: URLSessionWebSocketTask
        switch Self.relays[i] {
        case .ntfy(let host):
            task = URLSession.shared.webSocketTask(with: URL(string: "wss://\(host)/\(topic)/ws")!)
        case .mqtt(let url):
            task = URLSession.shared.webSocketTask(with: url, protocols: ["mqtt"])
        }
        let link = Link(task)
        links[i] = link
        task.resume()
        if case .mqtt = Self.relays[i] { send(MQTT.connect(clientID: "na-\(UUID().uuidString.prefix(12))"), on: i) }
        receiveLoop(task, relay: i)
        // A relay that doesn't answer in 8 seconds is dropped and retried later.
        let gen = generation
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            guard let self, self.generation == gen, let l = self.links[i], l === link, !l.joined else { return }
            self.drop(i)
        }
    }

    /// Closes one relay and tries it again in 30 seconds (e.g. after the network comes back).
    private func drop(_ i: Int) {
        guard room != nil, let link = links.removeValue(forKey: i) else { return }
        link.socket.cancel(with: .goingAway, reason: nil)
        updateState()
        let gen = generation
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self, self.generation == gen, self.room != nil, self.links[i] == nil else { return }
            self.connect(i)
        }
    }

    private func scheduleGiveUpCheck() {
        let gen = generation
        DispatchQueue.main.asyncAfter(deadline: .now() + 9) { [weak self] in
            guard let self, self.generation == gen else { return }
            self.updateState()
        }
    }

    private func updateState() {
        guard room != nil else { return }
        if links.values.contains(where: \.joined) {
            if state != .joined { state = .joined; publish(kind: .presence, text: nil); startTimers() }
        } else if links.isEmpty {
            state = .failed("Couldn't reach a relay. Retrying in 30 seconds…")
        }
    }

    private func send(_ data: Data, on i: Int) {
        guard let task = links[i]?.socket else { return }
        task.send(.data(data)) { [weak self] error in
            if error != nil { Task { @MainActor in if self?.links[i]?.socket === task { self?.drop(i) } } }
        }
    }

    private func receiveLoop(_ task: URLSessionWebSocketTask, relay i: Int) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, let link = self.links[i], link.socket === task else { return }
                switch result {
                case .success(.data(let data)):
                    link.buffer.append(data)
                    self.drainPackets(i)
                    self.receiveLoop(task, relay: i)
                case .success(.string(let text)):
                    self.handleNtfyEvent(text, relay: i)
                    self.receiveLoop(task, relay: i)
                case .success:
                    self.receiveLoop(task, relay: i)
                case .failure:
                    self.drop(i)
                }
            }
        }
    }

    /// ntfy sends one JSON event per WebSocket text frame.
    private func handleNtfyEvent(_ text: String, relay i: Int) {
        struct Event: Decodable { let event: String; let message: String? }
        guard let event = try? JSONDecoder().decode(Event.self, from: Data(text.utf8)) else { return }
        switch event.event {
        case "open":
            didJoin(i)
        case "message":
            if let b64 = event.message, let payload = Data(base64Encoded: b64) { receive(payload: payload) }
        default:
            break   // keepalive
        }
    }

    private func didJoin(_ i: Int) {
        guard let link = links[i], !link.joined else { return }
        link.joined = true
        if state == .joined {
            publish(kind: .presence, text: nil)   // let people on this relay see us right away
        } else {
            updateState()
        }
    }

    /// Parses every complete MQTT packet received on relay `i`.
    private func drainPackets(_ i: Int) {
        while let link = links[i], let (type, body, used) = MQTT.nextPacket(in: link.buffer) {
            link.buffer.removeFirst(used)
            switch type {
            case 0x20:  // CONNACK
                guard body.count >= 2, body[body.startIndex + 1] == 0, let topic else { drop(i); return }
                send(MQTT.subscribe(topic: topic, packetID: 1), on: i)
            case 0x90:  // SUBACK
                didJoin(i)
            case 0x30:  // PUBLISH
                if let payload = MQTT.publishPayload(body) { receive(payload: payload) }
            default:
                break   // PINGRESP etc.
            }
        }
    }

    private func startTimers() {
        presenceTimer?.invalidate(); pingTimer?.invalidate()
        presenceTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.publish(kind: .presence, text: nil)
                // Drop members we haven't heard from in 75 s.
                let cutoff = Date.now.addingTimeInterval(-75)
                self.members = self.members.filter { $0.value.lastSeen > cutoff }
            }
        }
        pingTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                for (i, link) in self.links where link.joined {
                    if case .mqtt = Self.relays[i] { self.send(MQTT.pingRequest, on: i) }
                }
            }
        }
    }
}

// MARK: - Minimal MQTT 3.1.1 encoder / decoder

private enum MQTT {
    static let pingRequest = Data([0xC0, 0x00])

    static func connect(clientID: String) -> Data {
        var body = Data()
        body.append(string("MQTT"))
        body.append(4)                 // protocol level 3.1.1
        body.append(0x02)              // clean session
        body.append(contentsOf: [0x00, 60])   // keep-alive 60 s
        body.append(string(clientID))
        return packet(0x10, body)
    }

    static func subscribe(topic: String, packetID: UInt16) -> Data {
        var body = Data([UInt8(packetID >> 8), UInt8(packetID & 0xFF)])
        body.append(string(topic))
        body.append(0)                 // QoS 0
        return packet(0x82, body)
    }

    static func publish(topic: String, payload: Data) -> Data {
        var body = string(topic)       // QoS 0 → no packet ID; retain = 0 so nothing is stored
        body.append(payload)
        return packet(0x30, body)
    }

    /// Returns (type, body, bytesUsed) for the first complete packet, if any.
    static func nextPacket(in data: Data) -> (UInt8, Data, Int)? {
        guard data.count >= 2 else { return nil }
        let bytes = [UInt8](data)
        var multiplier = 1, length = 0, i = 1
        repeat {
            guard i < bytes.count, i <= 4 else { return nil }
            length += Int(bytes[i] & 0x7F) * multiplier
            multiplier *= 128
            i += 1
        } while bytes[i - 1] & 0x80 != 0
        guard bytes.count >= i + length else { return nil }
        return (bytes[0] & 0xF0, Data(bytes[i..<(i + length)]), i + length)
    }

    /// Extracts the payload of a QoS 0 PUBLISH body.
    static func publishPayload(_ body: Data) -> Data? {
        let b = [UInt8](body)
        guard b.count >= 2 else { return nil }
        let topicLength = Int(b[0]) << 8 | Int(b[1])
        guard b.count >= 2 + topicLength else { return nil }
        return Data(b[(2 + topicLength)...])
    }

    private static func string(_ s: String) -> Data {
        let utf8 = Data(s.utf8)
        var d = Data([UInt8(utf8.count >> 8), UInt8(utf8.count & 0xFF)])
        d.append(utf8)
        return d
    }

    private static func packet(_ header: UInt8, _ body: Data) -> Data {
        var d = Data([header])
        var length = body.count
        repeat {
            var byte = UInt8(length % 128)
            length /= 128
            if length > 0 { byte |= 0x80 }
            d.append(byte)
        } while length > 0
        d.append(body)
        return d
    }
}
