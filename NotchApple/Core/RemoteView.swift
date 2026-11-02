//
//  RemoteView.swift
//  Notch Apple
//
//  Remote view for the iPhone companion (Ultimate): the paired iPhone can watch this Mac's screen, from the same Wi-Fi or,
//  over Tailscale, from anywhere. A stream is one long connection started by a sealed `stream` request (CompanionServer),
//  then sealed, counted packets both ways (CompanionKit/CompanionStream.swift): JPEG frames out, small notes in.
//
//  Safety: off until "Allow viewing this Mac's screen" is switched on; only for a phone you paired; Screen Recording must be
//  granted; the notch shows an eye while anyone is watching and Settings has a Stop button; the stream ends if the phone
//  disconnects, the Mac sleeps or the app quits. Notch Apple's own windows are left out of the picture.
//

import AppKit
import CoreImage
import CryptoKit
import Network
import ScreenCaptureKit
import SwiftUI

@MainActor
final class RemoteViewHub: ObservableObject {
    static let shared = RemoteViewHub()

    /// Off by default: watching the screen is more sensitive than the other things a paired phone can do.
    @AppStorage("companion.allowView") var allowView = false { didSet { if !allowView { stopAll("Viewing was switched off on the Mac.") } } }
    @Published private(set) var sessions: [RemoteViewSession] = []
    @Published private(set) var screenAccess = ScreenPermission.isGranted

    var isActive: Bool { !sessions.isEmpty }

    /// What the closed notch shows while someone is watching.
    var liveActivity: LiveActivity? {
        guard let first = sessions.first else { return nil }
        return LiveActivity(symbol: "eye.fill", label: sessions.count > 1 ? "\(sessions.count) viewing" : String(first.phoneName.prefix(10)), tint: .systemOrange, pulse: true)
    }

    func refreshAccess() { screenAccess = ScreenPermission.isGranted }

    func stopAll(_ reason: String = "The Mac ended the session.") {
        for s in sessions { s.stop(reason) }
    }

    fileprivate func add(_ s: RemoteViewSession) { sessions.append(s); LiveActivityCenter.shared.recompute() }
    fileprivate func remove(_ s: RemoteViewSession) { sessions.removeAll { $0 === s }; LiveActivityCenter.shared.recompute() }

    /// Called by CompanionServer for a `stream` request from a paired phone whose connection is already checked.
    /// Returns the reply to seal and send as the next envelope, or an error message; on success the session then takes over `conn`.
    func open(conn: NWConnection, phone: PairedPhone, token: Data, request: Companion.Message) async -> (reply: Companion.Message, start: () -> Void)? {
        guard allowView else { return (Companion.Message(type: .error, text: "Viewing the screen is turned off on the Mac. Turn on “Allow viewing this Mac's screen” in Settings → iPhone."), {}) }
        guard let phoneNonce = request.nonce.flatMap({ Data(base64Encoded: $0) }), phoneNonce.count == 16 else { return nil }
        guard ScreenPermission.isGranted else {
            _ = ScreenPermission.request()
            refreshAccess()
            return (Companion.Message(type: .error, text: "The Mac needs Screen Recording permission for Notch Apple. Allow it on the Mac (System Settings → Privacy & Security → Screen & System Audio Recording)."), {})
        }
        guard sessions.count < 2 else { return (Companion.Message(type: .error, text: "Two phones are already watching this Mac."), {}) }
        let displays: [SCDisplay]
        do { displays = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true).displays } catch {
            refreshAccess()
            return (Companion.Message(type: .error, text: "The Mac couldn't read its screens. Is Screen Recording allowed for Notch Apple?"), {})
        }
        guard !displays.isEmpty else { return (Companion.Message(type: .error, text: "The Mac has no screen to show."), {}) }
        let macNonce = Companion.newNonce()
        let session = RemoteViewSession(conn: conn, phoneName: phone.name, token: token, macNonce: macNonce, phoneNonce: phoneNonce, displays: displays,
                                        display: request.display, edge: request.edge ?? 1280)
        add(session)
        let infos = displays.map { Companion.DisplayInfo(id: Int($0.displayID), name: RemoteViewSession.name(of: $0), width: $0.width, height: $0.height) }
        let reply = Companion.Message(type: .stream, nonce: macNonce.base64EncodedString(), displays: infos)
        return (reply, { session.start() })
    }
}

/// State shared between the main actor and the screen-capture callback queue.
private final class StreamGate: @unchecked Sendable {
    private let lock = NSLock()
    var send: Companion.StreamCipher
    var adapter = StreamAdapter()
    var frame: Int64 = 0
    var sentAt: [Int64: Date] = [:]
    var lastSend = Date.distantPast
    var edge: Int
    var scale: Double { adapter.scale }

    init(send: Companion.StreamCipher, edge: Int) { self.send = send; self.edge = edge }

    func sync<T>(_ body: (StreamGate) -> T) -> T { lock.lock(); defer { lock.unlock() }; return body(self) }
}

@MainActor
final class RemoteViewSession: NSObject, SCStreamOutput, SCStreamDelegate, ObservableObject {
    let phoneName: String
    private let conn: NWConnection
    private let gate: StreamGate
    private var recv: Companion.StreamCipher
    private var buffer = Data()
    private var displays: [SCDisplay]
    private var display: SCDisplay
    private var stream: SCStream?
    private let ciContext = CIContext()
    private let queue = DispatchQueue(label: "notchapple.remoteview")
    private var ended = false
    private var keepalive: Timer?

    init(conn: NWConnection, phoneName: String, token: Data, macNonce: Data, phoneNonce: Data, displays: [SCDisplay], display wanted: Int?, edge: Int) {
        self.conn = conn
        self.phoneName = phoneName
        gate = StreamGate(send: .init(key: Companion.streamKey(token: token, macNonce: macNonce, phoneNonce: phoneNonce, .macToPhone)), edge: min(max(edge, 320), 2560))
        recv = .init(key: Companion.streamKey(token: token, macNonce: macNonce, phoneNonce: phoneNonce, .phoneToMac))
        self.displays = displays
        let main = (NSScreen.main?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
        display = displays.first { wanted != nil && Int($0.displayID) == wanted } ?? displays.first { $0.displayID == main } ?? displays[0]
        super.init()
    }

    static func name(of d: SCDisplay) -> String {
        let screen = NSScreen.screens.first { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == d.displayID }
        return screen?.localizedName ?? "Display \(d.displayID)"
    }

    // MARK: Running

    func start() {
        receive()
        keepalive = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in Task { @MainActor in self?.send(.info, Companion.encodeNote(.init(kind: "ping"))) } }
        Task { await self.begin() }
    }

    private func begin() async {
        do { try await startCapture() } catch {
            send(.info, Companion.encodeNote(.init(kind: "error", text: "The Mac couldn't start capturing its screen.")))
            stop("The capture failed to start.")
        }
    }

    private func startCapture() async throws {
        if let old = stream { try? await old.stopCapture(); stream = nil }
        let ownPID = ProcessInfo.processInfo.processIdentifier
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let apps = content.applications.filter { $0.processID == ownPID }          // Notch Apple's own windows stay out of the picture
        let filter = SCContentFilter(display: display, excludingApplications: apps, exceptingWindows: [])
        let (w, h) = size(for: display, scale: gate.sync { $0.scale })
        let config = SCStreamConfiguration()
        config.width = w; config.height = h
        config.minimumFrameInterval = CMTime(value: 1, timescale: 20)
        config.queueDepth = 3
        config.showsCursor = true
        config.pixelFormat = kCVPixelFormatType_32BGRA
        let s = SCStream(filter: filter, configuration: config, delegate: self)
        try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        try await s.startCapture()
        stream = s
        send(.info, Companion.encodeNote(.init(kind: "layout", display: Int(display.displayID), width: w, height: h, controlAllowed: false)))
    }

    private func size(for d: SCDisplay, scale: Double) -> (Int, Int) {
        let longest = Double(max(d.width, d.height)), edge = Double(gate.sync { $0.edge })
        let f = min(1, edge / longest) * max(0.3, min(1, scale))
        return (max(2, Int(Double(d.width) * f) & ~1), max(2, Int(Double(d.height) * f) & ~1))
    }

    func stop(_ reason: String = "The session ended.") {
        guard !ended else { return }
        ended = true
        keepalive?.invalidate()
        send(.info, Companion.encodeNote(.init(kind: "bye", text: reason)))
        let s = stream; stream = nil
        Task { try? await s?.stopCapture() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [conn] in conn.cancel() }
        RemoteViewHub.shared.remove(self)
    }

    // MARK: Packets in and out

    private func send(_ type: Companion.PacketType, _ payload: Data) {
        let packet = gate.sync { try? $0.send.seal(type, payload) }
        if let packet { conn.send(content: packet, completion: .contentProcessed { _ in }) }
    }

    private func receive() {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, done, error in
            Task { @MainActor in
                guard let self, !self.ended else { return }
                if let data { self.buffer.append(data) }
                do {
                    while let (type, payload) = try self.recv.open(from: &self.buffer) { self.handle(type, payload) }
                } catch { self.stop("The connection sent something the Mac couldn't trust."); return }
                if error != nil || done { self.stop("The phone disconnected."); return }
                self.receive()
            }
        }
    }

    private func handle(_ type: Companion.PacketType, _ payload: Data) {
        guard type == .info, let note = Companion.decodeNote(payload) else { return }   // (input packets arrive in the control stage)
        switch note.kind {
        case "ack":
            guard let n = note.ack else { return }
            gate.sync { g in
                let rtt = g.sentAt[n].map { Date().timeIntervalSince($0) } ?? 0.2
                g.sentAt = g.sentAt.filter { $0.key > n }
                g.adapter.acknowledged(rtt: rtt, outstanding: g.sentAt.count)
            }
        case "display":
            if let id = note.display, let d = displays.first(where: { Int($0.displayID) == id }), d.displayID != display.displayID { display = d; Task { await begin() } }
        case "quality":
            if let edge = note.edge { gate.sync { $0.edge = min(max(edge, 320), 2560) }; Task { await begin() } }
        case "bye": stop("The phone ended the session.")
        default: break
        }
    }

    // MARK: Frames

    nonisolated func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sample.isValid, let pixels = CMSampleBufferGetImageBuffer(sample) else { return }
        // Only frames with new content (the others are repeats).
        if let list = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
           let raw = list.first?[.status] as? Int, SCFrameStatus(rawValue: raw) != .complete { return }
        let go: (Double, Int64)? = gate.sync { g in
            guard g.adapter.shouldSend, Date().timeIntervalSince(g.lastSend) >= g.adapter.interval else { return nil }
            g.lastSend = Date(); g.frame += 1
            return (g.adapter.quality, g.frame)
        }
        guard let (quality, number) = go else { return }
        let image = CIImage(cvPixelBuffer: pixels)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let jpeg = ciContext.jpegRepresentation(of: image, colorSpace: space, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: quality]) else { return }
        let packet: Data? = gate.sync { g in
            g.adapter.sent(); g.sentAt[number] = Date()
            return try? g.send.seal(.video, Companion.videoPayload(frame: number, jpeg: jpeg))
        }
        if let packet { conn.send(content: packet, completion: .contentProcessed { _ in }) }
    }

    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        Task { @MainActor in self.stop("The Mac's screen capture stopped.") }
    }
}
