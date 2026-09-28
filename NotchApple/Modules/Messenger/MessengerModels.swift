//
//  MessengerModels.swift
//  Notch apple
//
//  Shared types for Notch Messenger: the anonymous identity, messages, and
//  the JSON envelope both transports (Nearby Wi-Fi and Anonymous Room) send.
//

import Foundation
import SwiftUI

/// One chat message as shown in the UI.
struct MessengerMessage: Identifiable, Equatable {
    let id: UUID
    let senderID: String
    let sender: String
    let text: String
    let date: Date
    let isMine: Bool
    /// System notices such as "PurplePanda#402 joined".
    var isNotice = false
}

/// What goes over the wire. Kept tiny and versioned.
struct MessengerEnvelope: Codable {
    enum Kind: String, Codable { case message, presence, leave }
    var v = 1
    let kind: Kind
    let id: UUID
    let senderID: String
    let sender: String
    let text: String?
    let ts: Date
}

/// The user's anonymous identity: a random handle plus a random ID that is
/// never tied to the device, an account, an email or a phone number.
final class MessengerIdentity: ObservableObject {
    static let shared = MessengerIdentity()

    @AppStorage("messenger.handle") var handle: String = MessengerIdentity.randomHandle()
    /// Random per-install ID so two people can pick the same handle.
    @AppStorage("messenger.senderID") var senderID: String = UUID().uuidString

    init() {
        // @AppStorage doesn't save its default value, so a random default would
        // change on every launch. Write the first ones out explicitly.
        let d = UserDefaults.standard
        if d.string(forKey: "messenger.handle") == nil { d.set(Self.randomHandle(), forKey: "messenger.handle") }
        if d.string(forKey: "messenger.senderID") == nil { d.set(UUID().uuidString, forKey: "messenger.senderID") }
    }

    private static let adjectives = ["Purple", "Cosmic", "Quiet", "Swift", "Neon", "Lucky", "Sunny", "Misty",
                                     "Brave", "Velvet", "Pixel", "Mellow", "Frosty", "Golden", "Jolly", "Nimble"]
    private static let animals = ["Panda", "Otter", "Fox", "Koala", "Falcon", "Lynx", "Owl", "Dolphin",
                                  "Tiger", "Llama", "Hedgehog", "Penguin", "Gecko", "Raven", "Moose", "Bunny"]

    static func randomHandle() -> String {
        "\(adjectives.randomElement()!)\(animals.randomElement()!)#\(Int.random(in: 100...999))"
    }

    func regenerate() { handle = Self.randomHandle() }

    /// Handles are shown to strangers, so keep them short and single-line.
    static func sanitize(_ raw: String) -> String {
        let cleaned = raw.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
        return cleaned.isEmpty ? randomHandle() : String(cleaned.prefix(32))
    }
}

/// Stable avatar colour for a sender.
extension MessengerMessage {
    static func color(for senderID: String) -> Color {
        let palette: [Color] = [.pink, .orange, .teal, .mint, .cyan, .indigo, .yellow, .green]
        let hash = senderID.unicodeScalars.reduce(0) { ($0 &* 31) &+ Int($1.value) }
        return palette[abs(hash) % palette.count]
    }
}
