//
//  RemoteViewClient.swift
//  Notch Apple companion (iPhone)
//
//  Watches the paired Mac's screen: one long connection, started by a sealed `stream` request and then sealed, counted
//  packets (CompanionKit/CompanionStream.swift). The Mac sends JPEG frames; this side acknowledges each one so the Mac can
//  slow down or send smaller pictures when the link is poor.
//

import CryptoKit
import Foundation
import Network
import SwiftUI

@MainActor
final class RemoteViewClient: ObservableObject {
    enum State: Equatable { case idle, connecting, live, failed(String) }

    @Published private(set) var state: State = .idle
    @Published private(set) var image: UIImage?
    @Published private(set) var displays: [Companion.DisplayInfo] = []
    @Published private(set) var currentDisplay: Int?
    @Published private(set) var size = CGSize.zero
    @Published private(set) var framesPerSecond = 0

    private var conn: NWConnection?
    private var send: Companion.StreamCipher?
    private var recv: Companion.StreamCipher?
    private var buffer = Data()
    private var opened = false
    private var generation = 0
    private var frameTimes: [Date] = []
    private var lastPacket = Date()
    private var watchdog: Timer?

    func start(display: Int? = nil) {
        stop(quiet: true)
        guard let p = CompanionClient.shared.pairing, let token = Data(base64Encoded: p.token) else { state = .failed("Pair with your Mac first."); return }
        generation += 1
        let mine = generation
        state = .connecting; opened = false; buffer = Data(); image = nil
        let phoneNonce = Companion.newNonce()
        var request = Companion.Message(type: .stream, nonce: phoneNonce.base64EncodedString(), display: display, edge: Self.wantedEdge())
        request.seq = CompanionClient.shared.nextStreamSequence()
        guard let frame = try? Companion.seal(request, from: p.device, key: Companion.key(token: token)) else { state = .failed("Couldn't prepare the request."); return }
        let c = NWConnection(to: p.target.endpoint, using: .tcp)
        conn = c
        c.stateUpdateHandler = { [weak self] st in
            Task { @MainActor in
                guard let self, self.generation == mine else { return }
                switch st {
                case .ready:
                    c.send(content: frame, completion: .contentProcessed { _ in })
                    self.read(c, token: token, phoneNonce: phoneNonce, generation: mine)
                case .failed(let e), .waiting(let e):
                    self.fail(CompanionClient.classify(e, target: p.target).text ?? "Can't reach the Mac.", generation: mine)
                default: break
                }
            }
        }
        c.start(queue: .main)
        lastPacket = Date()
        watchdog?.invalidate()
        watchdog = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.generation == mine else { return }
                let limit: TimeInterval = self.opened ? 45 : 12
                if Date().timeIntervalSince(self.lastPacket) > limit { self.fail(self.opened ? "The connection to the Mac went quiet." : "The Mac isn't answering. It may be asleep, off, or Tailscale is off.", generation: mine) }
            }
        }
    }

    func stop(quiet: Bool = false) {
        watchdog?.invalidate(); watchdog = nil
        if opened, var cipher = send, let c = conn, let packet = try? cipher.seal(.info, Companion.encodeNote(.init(kind: "bye"))) { c.send(content: packet, completion: .contentProcessed { _ in c.cancel() }) }
        else { conn?.cancel() }
        conn = nil; send = nil; recv = nil; opened = false; generation += 1
        if !quiet { state = .idle }
    }

    func choose(display: Int) { start(display: display) }

    private func fail(_ message: String, generation g: Int) {
        guard g == generation else { return }
        watchdog?.invalidate(); conn?.cancel(); conn = nil; opened = false
        state = .failed(message)
    }

    private static func wantedEdge() -> Int {
        let screen = UIScreen.main.bounds.size, scale = UIScreen.main.scale
        return Int(min(2048, max(screen.width, screen.height) * scale))
    }

    // MARK: Receiving

    private func read(_ c: NWConnection, token: Data, phoneNonce: Data, generation g: Int) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 262_144) { [weak self] data, _, done, error in
            Task { @MainActor in
                guard let self, self.generation == g else { return }
                if let data { self.buffer.append(data); self.lastPacket = Date() }
                if !self.opened { self.openStream(token: token, phoneNonce: phoneNonce, generation: g) }
                if self.opened { self.drain(generation: g) }
                if self.generation != g { return }
                if error != nil || done { self.fail(self.opened ? "The Mac closed the connection." : CompanionClient.Reach.wrongKey.text ?? "The Mac refused.", generation: g); return }
                self.read(c, token: token, phoneNonce: phoneNonce, generation: g)
            }
        }
    }

    /// The first thing back is the ordinary sealed reply: either an error or the stream's start.
    private func openStream(token: Data, phoneNonce: Data, generation g: Int) {
        guard let need = Companion.frameLength(buffer), buffer.count >= need else { return }
        guard let env = Companion.envelope(from: buffer), let reply = Companion.open(env, key: Companion.key(token: token)) else { fail(CompanionClient.Reach.wrongKey.text ?? "The Mac refused.", generation: g); return }
        buffer = Data(buffer.dropFirst(need))
        guard reply.type == .stream, let macNonce = reply.nonce.flatMap({ Data(base64Encoded: $0) }), macNonce.count == 16 else {
            fail(reply.text ?? "The Mac refused to show its screen.", generation: g); return
        }
        send = .init(key: Companion.streamKey(token: token, macNonce: macNonce, phoneNonce: phoneNonce, .phoneToMac))
        recv = .init(key: Companion.streamKey(token: token, macNonce: macNonce, phoneNonce: phoneNonce, .macToPhone))
        displays = reply.displays ?? []
        opened = true
        state = .live
    }

    private func drain(generation g: Int) {
        do {
            while var cipher = recv, let (type, payload) = try cipher.open(from: &buffer) {
                recv = cipher
                switch type {
                case .video: frame(payload)
                case .info: note(Companion.decodeNote(payload), generation: g)
                case .input: break
                }
                if generation != g { return }
            }
        } catch { fail("The connection sent something this iPhone couldn't trust.", generation: g) }
    }

    private func frame(_ payload: Data) {
        guard let (number, jpeg) = Companion.splitVideo(payload), let picture = UIImage(data: jpeg) else { return }
        image = picture
        let now = Date()
        frameTimes = frameTimes.filter { now.timeIntervalSince($0) < 1 } + [now]
        framesPerSecond = frameTimes.count
        ack(number)
    }

    private func ack(_ number: Int64) {
        guard var cipher = send, let c = conn, let packet = try? cipher.seal(.info, Companion.encodeNote(.init(kind: "ack", ack: number))) else { return }
        send = cipher
        c.send(content: packet, completion: .contentProcessed { _ in })
    }

    private func note(_ note: Companion.StreamNote?, generation g: Int) {
        guard let note else { return }
        switch note.kind {
        case "layout":
            currentDisplay = note.display
            if let w = note.width, let h = note.height { size = CGSize(width: w, height: h) }
        case "bye": fail(note.text ?? "The session ended.", generation: g)
        case "error", "permission": fail(note.text ?? "The Mac couldn't show its screen.", generation: g)
        default: break
        }
    }
}
