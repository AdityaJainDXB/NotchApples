//
//  BambuMQTT.swift
//  Notch Apple
//
//  Tiny MQTT 3.1.1 client over TLS for a Bambu Lab printer on the LAN (port 8883,
//  username bblp, password = LAN access code, self-signed certificate).
//  Timeouts and parse errors surface as callbacks; nothing blocks the main thread.
//

import Foundation
import Network
import Security

final class BambuMQTT {
    enum Event {
        case connected
        case payload(Data)
        /// The printer's certificate fingerprint, seen for the first time: the manager remembers it.
        case pinned(String)
        case failed(String)
        case disconnected
    }

    private let queue = DispatchQueue(label: "notchapple.bambu.mqtt")
    private var connection: NWConnection?
    private var buffer = Data()
    private var ping: DispatchSourceTimer?
    private var timeoutWork: DispatchWorkItem?
    private var packetId: UInt16 = 1
    private var onEvent: ((Event) -> Void)?
    private var closed = false
    private var topic = ""
    private var pinMismatch = false

    func start(host: String, password: String, topic: String, pin: String?, onEvent: @escaping (Event) -> Void) {
        queue.async { self.startLocked(host: host, password: password, topic: topic, pin: pin, onEvent: onEvent) }
    }

    func stop() {
        queue.async { self.tearDown(emit: false) }
    }

    private func startLocked(host: String, password: String, topic: String, pin: String?, onEvent: @escaping (Event) -> Void) {
        tearDown(emit: false)
        closed = false
        self.onEvent = onEvent
        self.topic = topic
        pinMismatch = false
        buffer.removeAll(keepingCapacity: true)

        let tls = NWProtocolTLS.Options()
        sec_protocol_options_set_verify_block(tls.securityProtocolOptions, { [weak self] _, trust, complete in
            // The printer signs its own certificate, so trust is decided by the pinned fingerprint instead.
            let ref = sec_trust_copy_ref(trust).takeRetainedValue()
            guard let leaf = (SecTrustCopyCertificateChain(ref) as? [SecCertificate])?.first else { complete(false); return }
            let seen = BambuStatusLogic.fingerprint(of: SecCertificateCopyData(leaf) as Data)
            switch BambuStatusLogic.decidePin(stored: pin, seen: seen) {
            case .match:
                complete(true)
            case .pinFirst:
                self?.onEvent?(.pinned(seen))
                complete(true)
            case .mismatch:
                self?.pinMismatch = true
                complete(false)
            }
        }, queue)
        let tcp = NWProtocolTCP.Options()
        tcp.connectionTimeout = Int(BambuStatusLogic.connectTimeout)
        let params = NWParameters(tls: tls, tcp: tcp)
        params.expiredDNSBehavior = .allow
        let conn = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: BambuStatusLogic.mqttPort)!, using: params)
        connection = conn
        conn.stateUpdateHandler = { [weak self] state in
            self?.queue.async { self?.handle(state, password: password, topic: topic) }
        }
        conn.start(queue: queue)
        let work = DispatchWorkItem { [weak self] in
            self?.fail("Timed out reaching the printer. Check the IP and that the printer is on the same Wi-Fi.")
        }
        timeoutWork = work
        queue.asyncAfter(deadline: .now() + BambuStatusLogic.connectTimeout, execute: work)
    }

    private func handle(_ state: NWConnection.State, password: String, topic: String) {
        switch state {
        case .ready:
            send(Self.connectPacket(password: password))
            receive()
        case .waiting(let error):
            fail(Self.explain(error))
        case .failed(let error):
            fail(Self.explain(error))
        case .cancelled:
            if !closed { emit(.disconnected) }
        default:
            break
        }
    }

    private func receive() {
        connection?.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            self?.queue.async {
                guard let self, !self.closed else { return }
                if let error { self.fail(Self.explain(error)); return }
                if let data, !data.isEmpty {
                    self.buffer.append(data)
                    self.drain()
                }
                if isComplete { self.fail("The printer closed the connection."); return }
                self.receive()
            }
        }
    }

    private func drain() {
        while let packet = Self.popPacket(&buffer) {
            switch packet.type {
            case 2: // CONNACK
                timeoutWork?.cancel()
                let code = packet.payload.count >= 2 ? packet.payload[1] : 1
                if code == 0 {
                    send(Self.subscribePacket(topic: topic, packetId: nextId()))
                    startPing()
                    emit(.connected)
                } else {
                    fail(code == 4 || code == 5
                         ? "The access code was refused. Open the printer screen → Settings → LAN and copy the access code."
                         : "The printer refused the MQTT login (code \(code)).")
                }
            case 3: // PUBLISH
                if let payload = Self.publishPayload(packet) { emit(.payload(payload)) }
            case 9, 13: // SUBACK, PINGRESP
                break
            default:
                break
            }
        }
    }

    private func send(_ data: Data) {
        connection?.send(content: data, completion: .contentProcessed { [weak self] error in
            if let error { self?.queue.async { self?.fail(BambuMQTT.explain(error)) } }
        })
    }

    private func startPing() {
        ping?.cancel()
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + .seconds(Int(BambuStatusLogic.keepAlive)), repeating: .seconds(Int(BambuStatusLogic.keepAlive)))
        t.setEventHandler { [weak self] in self?.send(Data([0xC0, 0x00])) }
        t.resume()
        ping = t
    }

    private func nextId() -> UInt16 {
        packetId = packetId &+ 1
        if packetId == 0 { packetId = 1 }
        return packetId
    }

    private func fail(_ raw: String) {
        guard !closed else { return }
        let message = pinMismatch ? BambuStatusLogic.pinMismatchMessage : raw
        let cb = onEvent
        tearDown(emit: false)
        cb?(.failed(message))
    }

    private func tearDown(emit: Bool) {
        closed = true
        timeoutWork?.cancel()
        timeoutWork = nil
        ping?.cancel()
        ping = nil
        connection?.stateUpdateHandler = nil
        connection?.cancel()
        connection = nil
        buffer.removeAll()
        let cb = onEvent
        onEvent = nil
        if emit { cb?(.disconnected) }
    }

    private func emit(_ event: Event) { onEvent?(event) }

    private static func explain(_ error: Error) -> String {
        let ns = error as NSError
        if ns.domain == NSPOSIXErrorDomain, ns.code == 61 {
            return "Nothing is listening on port 8883. Check the IP and that LAN mode is on."
        }
        return "Couldn't reach the printer (\(ns.localizedDescription))."
    }

    // MARK: Packets

    private struct Packet {
        let type: UInt8
        let flags: UInt8
        let payload: Data
    }

    private static func popPacket(_ buffer: inout Data) -> Packet? {
        guard !buffer.isEmpty else { return nil }
        let type = buffer[0] >> 4
        let flags = buffer[0] & 0x0F
        var multiplier = 1, value = 0, index = 1
        while true {
            guard index < buffer.count else { return nil }
            let byte = Int(buffer[index])
            value += (byte & 0x7F) * multiplier
            index += 1
            if byte & 0x80 == 0 { break }
            multiplier *= 128
            if index > 5 { buffer.removeAll(); return nil }
        }
        let total = index + value
        // Bambu reports are a few kilobytes; a declared size past 1 MB is not a printer talking.
        if value > 1_048_576 { buffer.removeAll(); return nil }
        guard buffer.count >= total else { return nil }
        let payload = Data(buffer[index..<total])
        buffer.removeSubrange(0..<total)
        return Packet(type: type, flags: flags, payload: payload)
    }

    private static func remaining(_ length: Int) -> Data {
        var x = length, out = Data()
        repeat {
            var encoded = UInt8(x % 128)
            x /= 128
            if x > 0 { encoded |= 0x80 }
            out.append(encoded)
        } while x > 0
        return out
    }

    private static func connectPacket(password: String) -> Data {
        var vh = Data()
        func str(_ s: String) {
            let d = Data(s.utf8)
            vh.append(UInt8(d.count >> 8)); vh.append(UInt8(d.count & 0xFF)); vh.append(d)
        }
        str("MQTT")
        vh.append(4)                 // protocol level 3.1.1
        vh.append(0xC2)              // username + password + clean session
        vh.append(UInt8(BambuStatusLogic.keepAlive >> 8))
        vh.append(UInt8(BambuStatusLogic.keepAlive & 0xFF))
        str("notchapple")
        str(BambuStatusLogic.mqttUser)
        str(password)
        var pkt = Data([0x10])
        pkt.append(remaining(vh.count))
        pkt.append(vh)
        return pkt
    }

    private static func subscribePacket(topic: String, packetId: UInt16) -> Data {
        var body = Data()
        body.append(UInt8(packetId >> 8)); body.append(UInt8(packetId & 0xFF))
        let t = Data(topic.utf8)
        body.append(UInt8(t.count >> 8)); body.append(UInt8(t.count & 0xFF)); body.append(t)
        body.append(0)               // QoS 0
        var pkt = Data([0x82])
        pkt.append(remaining(body.count))
        pkt.append(body)
        return pkt
    }

    private static func publishPayload(_ packet: Packet) -> Data? {
        guard packet.payload.count >= 2 else { return nil }
        let tlen = Int(packet.payload[0]) << 8 | Int(packet.payload[1])
        var offset = 2 + tlen
        let qos = (packet.flags >> 1) & 0x03
        if qos > 0 { offset += 2 }
        guard offset <= packet.payload.count else { return nil }
        return Data(packet.payload[offset...])
    }
}
