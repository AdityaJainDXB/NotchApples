//
//  LocalP2PManager.swift
//  Notch apple
//
//  "Nearby Wi-Fi" chat using Apple's MultipeerConnectivity:
//   • Every Notch apple with Messenger on advertises and browses the
//     `notch-chat` service (Bonjour `_notch-chat._tcp` / `_udp`).
//   • Peers connect automatically. To avoid both sides inviting each other,
//     only the peer with the smaller random ID sends the invitation.
//   • Sessions use `.required` encryption, so traffic between Macs is
//     encrypted end to end by the framework.
//   • Nothing is stored anywhere; messages live in memory until cleared.
//

import Foundation
import MultipeerConnectivity

@MainActor
final class LocalP2PManager: NSObject, ObservableObject {
    static let shared = LocalP2PManager()
    static let serviceType = "notch-chat"      // ≤ 15 chars, lowercase, hyphen allowed

    @Published private(set) var isRunning = false
    @Published private(set) var connectedPeers: [MCPeerID] = []
    @Published private(set) var messages: [MessengerMessage] = []
    @Published private(set) var status = "Off"

    private var peerID: MCPeerID?
    private var session: MCSession?
    private var advertiser: MCNearbyServiceAdvertiser?
    private var browser: MCNearbyServiceBrowser?
    private var instanceID = UUID().uuidString
    /// Maps MultipeerConnectivity peers to their messenger sender IDs.
    private var senderIDs: [MCPeerID: String] = [:]

    private let identity = MessengerIdentity.shared

    // MARK: Lifecycle

    func start() {
        guard !isRunning, SettingsManager.shared.messengerLocalDiscovery else {
            if !SettingsManager.shared.messengerLocalDiscovery { status = "Local network discovery is turned off in Settings" }
            return
        }
        instanceID = UUID().uuidString
        let me = MCPeerID(displayName: String(identity.handle.prefix(60)))
        let session = MCSession(peer: me, securityIdentity: nil, encryptionPreference: .required)
        session.delegate = self

        let info = ["id": instanceID, "sid": identity.senderID]
        let advertiser = MCNearbyServiceAdvertiser(peer: me, discoveryInfo: info, serviceType: Self.serviceType)
        advertiser.delegate = self
        let browser = MCNearbyServiceBrowser(peer: me, serviceType: Self.serviceType)
        browser.delegate = self

        peerID = me
        self.session = session
        self.advertiser = advertiser
        self.browser = browser
        advertiser.startAdvertisingPeer()
        browser.startBrowsingForPeers()
        isRunning = true
        status = "Looking for people on this Wi-Fi…"
    }

    func stop() {
        if isRunning { broadcast(kind: .leave, text: nil) }
        advertiser?.stopAdvertisingPeer()
        browser?.stopBrowsingForPeers()
        session?.disconnect()
        advertiser = nil; browser = nil; session = nil; peerID = nil
        connectedPeers = []
        senderIDs = [:]
        isRunning = false
        status = "Off"
    }

    /// Restart so a new handle is advertised.
    func restart() {
        guard isRunning else { return }
        stop(); start()
    }

    func clear() { messages.removeAll() }

    // MARK: Messaging

    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let envelope = broadcast(kind: .message, text: String(trimmed.prefix(2000)))
        messages.append(MessengerMessage(id: envelope.id, senderID: identity.senderID, sender: identity.handle,
                                         text: trimmed, date: envelope.ts, isMine: true))
    }

    @discardableResult
    private func broadcast(kind: MessengerEnvelope.Kind, text: String?) -> MessengerEnvelope {
        let envelope = MessengerEnvelope(kind: kind, id: UUID(), senderID: identity.senderID,
                                         sender: identity.handle, text: text, ts: .now)
        if let session, !session.connectedPeers.isEmpty, let data = try? JSONEncoder().encode(envelope) {
            try? session.send(data, toPeers: session.connectedPeers, with: .reliable)
        }
        return envelope
    }

    private func handle(_ data: Data, from peer: MCPeerID) {
        guard let env = try? JSONDecoder().decode(MessengerEnvelope.self, from: data) else { return }
        senderIDs[peer] = env.senderID
        switch env.kind {
        case .message:
            guard let text = env.text, !messages.contains(where: { $0.id == env.id }) else { return }
            messages.append(MessengerMessage(id: env.id, senderID: env.senderID, sender: env.sender,
                                             text: String(text.prefix(2000)), date: env.ts, isMine: false))
        case .presence, .leave:
            break
        }
    }

    private func notice(_ text: String) {
        messages.append(MessengerMessage(id: UUID(), senderID: "system", sender: "", text: text,
                                         date: .now, isMine: false, isNotice: true))
    }

    private func refreshPeers() {
        connectedPeers = session?.connectedPeers ?? []
        let n = connectedPeers.count
        status = n == 0 ? "Looking for people on this Wi-Fi…" : "\(n) \(n == 1 ? "person" : "people") nearby on Wi-Fi"
    }
}

// MARK: - MCSessionDelegate

extension LocalP2PManager: MCSessionDelegate {
    nonisolated func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        Task { @MainActor in
            switch state {
            case .connected: self.notice("\(peerID.displayName) joined")
            case .notConnected: if self.senderIDs[peerID] != nil { self.notice("\(peerID.displayName) left") }
            default: break
            }
            self.refreshPeers()
        }
    }

    nonisolated func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        Task { @MainActor in self.handle(data, from: peerID) }
    }

    nonisolated func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    nonisolated func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    nonisolated func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}

// MARK: - Advertiser / browser

extension LocalP2PManager: MCNearbyServiceAdvertiserDelegate, MCNearbyServiceBrowserDelegate {
    nonisolated func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID,
                                withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        Task { @MainActor in invitationHandler(self.session != nil, self.session) }
    }

    nonisolated func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
        Task { @MainActor in self.status = "Couldn't start: \(error.localizedDescription)" }
    }

    nonisolated func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
        Task { @MainActor in
            guard let session = self.session, let theirID = info?["id"], theirID != self.instanceID,
                  !session.connectedPeers.contains(peerID) else { return }
            // Only one side invites, so connections don't collide.
            if self.instanceID < theirID {
                browser.invitePeer(peerID, to: session, withContext: nil, timeout: 20)
            }
        }
    }

    nonisolated func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        Task { @MainActor in self.refreshPeers() }
    }

    nonisolated func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        Task { @MainActor in self.status = "Couldn't search: \(error.localizedDescription)" }
    }
}
