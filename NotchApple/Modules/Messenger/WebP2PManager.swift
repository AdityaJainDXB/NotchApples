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
//     If one relay is unreachable we try the next.
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

    private var socket: URLSessionWebSocketTask?
    private var key: SymmetricKey?
    private var topic: String?
    private var relayIndex = 0
    private var relay: Relay { Self.relays[relayIndex] }
    private var buffer = Data()
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

    func join(_ rawRoom: String) {
        let room = Self.normalize(rawRoom)
        guard !room.isEmpty else { return }
        leave()
        self.room = room
        key = SymmetricKey(data: SHA256.hash(data: Data("notchapple-room-key|\(room)".utf8)))
        let topicHash = SHA256.hash(data: Data("notchapple-room-topic|\(room)".utf8))
            .map { String(format: "%02x", $0) }.joined()
        topic = "notchapple-v1-\(topicHash.prefix(40))"    // valid for both ntfy and MQTT
        relayIndex = 0
        connect()
    }

    func leave() {
        if state == .joined { publish(kind: .leave, text: nil) }
        presenceTimer?.invalidate(); pingTimer?.invalidate()
        presenceTimer = nil; pingTimer = nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        buffer.removeAll()
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
        guard let key, let topic, let json = try? JSONEncoder().encode(env),
              let sealed = try? AES.GCM.seal(json, using: key).combined else { return env }
        switch relay {
        case .ntfy(let host):
            // Publish over HTTPS. `Cache: no` = forward live, store nothing.
            var request = URLRequest(url: URL(string: "https://\(host)/\(topic)")!)
            request.httpMethod = "POST"
            request.setValue("no", forHTTPHeaderField: "Cache")
            request.setValue("no", forHTTPHeaderField: "Firebase")
            request.httpBody = Data(sealed.base64EncodedString().utf8)
            URLSession.shared.dataTask(with: request).resume()
        case .mqtt:
            sendPacket(MQTT.publish(topic: topic, payload: sealed))
        }
        return env
    }

    private func receive(payload: Data) {
        guard let key, let box = try? AES.GCM.SealedBox(combined: payload),
              let json = try? AES.GCM.open(box, using: key),
              let env = try? JSONDecoder().decode(MessengerEnvelope.self, from: json) else { return }  // not for us / tampered
        // Ignore stale or replayed traffic.
        guard abs(env.ts.timeIntervalSinceNow) < 600 else { return }
        let isMe = env.senderID == identity.senderID

        switch env.kind {
        case .presence:
            if !isMe {
                if members[env.senderID] == nil {
                    notice("\(env.sender) joined")
                    // Say hello back so the newcomer sees us right away, not 30 s later.
                    publish(kind: .presence, text: nil)
                }
                members[env.senderID] = (String(env.sender.prefix(32)), .now)
            }
        case .leave:
            if let m = members.removeValue(forKey: env.senderID) { notice("\(m.handle) left") }
        case .message:
            guard !isMe, !seenIDs.contains(env.id), let text = env.text else { return }
            seenIDs.insert(env.id)
            members[env.senderID] = (String(env.sender.prefix(32)), .now)
            messages.append(MessengerMessage(id: env.id, senderID: env.senderID, sender: String(env.sender.prefix(32)),
                                             text: String(text.prefix(2000)), date: env.ts, isMine: false))
        }
    }

    private func notice(_ text: String) {
        messages.append(MessengerMessage(id: UUID(), senderID: "system", sender: "", text: text,
                                         date: .now, isMine: false, isNotice: true))
    }

    // MARK: Transport

    private func connect() {
        guard let topic else { return }
        state = .connecting
        let task: URLSessionWebSocketTask
        switch relay {
        case .ntfy(let host):
            task = URLSession.shared.webSocketTask(with: URL(string: "wss://\(host)/\(topic)/ws")!)
        case .mqtt(let url):
            task = URLSession.shared.webSocketTask(with: url, protocols: ["mqtt"])
        }
        socket = task
        task.resume()
        if case .mqtt = relay { sendPacket(MQTT.connect(clientID: "na-\(UUID().uuidString.prefix(12))")) }
        receiveLoop(task)
        // Give each relay a few seconds before moving on.
        let attempt = relayIndex
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            guard let self, self.state == .connecting, self.relayIndex == attempt else { return }
            self.failover("timed out")
        }
    }

    private func failover(_ reason: String) {
        guard room != nil else { return }
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        buffer.removeAll()
        relayIndex += 1
        if relayIndex < Self.relays.count {
            connect()
        } else {
            state = .failed("Couldn't reach a relay (\(reason)). Check your internet connection and try again.")
        }
    }

    private func sendPacket(_ data: Data) {
        socket?.send(.data(data)) { [weak self] error in
            if let error { Task { @MainActor in self?.failover(error.localizedDescription) } }
        }
    }

    private func receiveLoop(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, task === self.socket else { return }
                switch result {
                case .success(.data(let data)):
                    self.buffer.append(data)
                    self.drainPackets()
                    self.receiveLoop(task)
                case .success(.string(let text)):
                    self.handleNtfyEvent(text)
                    self.receiveLoop(task)
                case .success:
                    self.receiveLoop(task)
                case .failure(let error):
                    self.failover(error.localizedDescription)
                }
            }
        }
    }

    /// ntfy sends one JSON event per WebSocket text frame.
    private func handleNtfyEvent(_ text: String) {
        struct Event: Decodable { let event: String; let message: String? }
        guard let event = try? JSONDecoder().decode(Event.self, from: Data(text.utf8)) else { return }
        switch event.event {
        case "open":
            didJoin()
        case "message":
            if let b64 = event.message, let payload = Data(base64Encoded: b64) { receive(payload: payload) }
        default:
            break   // keepalive
        }
    }

    private func didJoin() {
        state = .joined
        publish(kind: .presence, text: nil)
        startTimers()
    }

    /// Parses every complete MQTT packet in `buffer`.
    private func drainPackets() {
        while let (type, body, used) = MQTT.nextPacket(in: buffer) {
            buffer.removeFirst(used)
            switch type {
            case 0x20:  // CONNACK
                guard body.count >= 2, body[body.startIndex + 1] == 0, let topic else {
                    failover("refused"); return
                }
                sendPacket(MQTT.subscribe(topic: topic, packetID: 1))
            case 0x90:  // SUBACK
                didJoin()
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
                guard let self, case .mqtt = self.relay else { return }
                self.sendPacket(MQTT.pingRequest)
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
