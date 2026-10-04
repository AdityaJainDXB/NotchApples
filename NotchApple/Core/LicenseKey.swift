//
//  LicenseKey.swift
//  Notch apple
//
//  Tiers, the features each one unlocks, and the signed product keys that
//  prove which tier you bought. Pure logic (no UI, no network), so the tests
//  compile it directly. Entitlements.swift is the live object the app uses.
//
//  Keys look like NTCH-PRO-XXXXXX-… or NTCH-ULTM-XXXXXX-…: a 12-byte payload
//  (version, tier, 8-byte key ID, issue day) plus its 64-byte Ed25519 signature,
//  in Crockford base32. The app checks the signature offline with the public
//  key below; the private key only exists on the license server
//  (server/license-worker). There is no expiry: a key is for life.
//

import CryptoKit
import Foundation

enum Tier: Int, Comparable, CaseIterable, Codable {
    case free = 0, pro = 1, ultimate = 2

    static func < (a: Tier, b: Tier) -> Bool { a.rawValue < b.rawValue }

    var name: String {
        switch self {
        case .free: "Free"
        case .pro: "Pro"
        case .ultimate: "Ultimate"
        }
    }

    var price: String {
        switch self {
        case .free: "$0"
        case .pro: "$1 once"
        case .ultimate: "$5 once"
        }
    }
}

/// Everything that needs Pro or Ultimate. Anything not listed here is free.
/// `isReady == false` keeps a paid feature hidden until it fully works.
enum Feature: String, CaseIterable, Identifiable {
    // Pro: notch
    case notchResize, edgeTrigger, displayLayouts, gestureRemap
    // Pro: customization
    case proThemes, customColors, themeEditor
    // Pro: live activities
    case meetingAlert, downloadProgress, markets, flightStatus, multiMatch
    // Ultimate: live activities
    case activityStacking
    // Pro: AI
    case aiCapture, aiHistory, aiFileDrop
    // Pro: tabs
    case messenger, audio, vpn, voiceNotes, screenTime, quickAdd, launcher, snippets, mirror, focus
    // Pro: system and media
    case rainAlert, lyrics
    // Pro: sync
    case sync
    // Ultimate (built in later phases; hidden until ready)
    case liveActivityAPI, pluginSDK, prioritySupport, betaChannel

    var id: String { rawValue }

    var tier: Tier {
        switch self {
        case .liveActivityAPI, .activityStacking, .pluginSDK, .prioritySupport, .betaChannel: .ultimate
        default: .pro
        }
    }

    var isReady: Bool {
        switch self {
        case .pluginSDK, .prioritySupport, .betaChannel: false
        default: true
        }
    }

    var title: String {
        switch self {
        case .notchResize: "Notch size"
        case .edgeTrigger: "Edge trigger zones"
        case .displayLayouts: "Tabs per display"
        case .gestureRemap: "Custom gestures"
        case .proThemes: "Pro themes"
        case .customColors: "Custom colours"
        case .themeEditor: "Theme editor"
        case .meetingAlert: "Meeting alerts"
        case .downloadProgress: "Download progress"
        case .markets: "Markets"
        case .flightStatus: "Live flight status"
        case .multiMatch: "More teams"
        case .activityStacking: "Two activities at once"
        case .aiCapture: "Ask about your screen"
        case .aiHistory: "AI history"
        case .aiFileDrop: "Images and PDFs in AI"
        case .messenger: "Messenger"
        case .audio: "Audio"
        case .vpn: "VPN"
        case .voiceNotes: "Voice Notes"
        case .screenTime: "Screen Time"
        case .quickAdd: "Quick Add"
        case .launcher: "Launcher"
        case .snippets: "Snippets"
        case .mirror: "Mirror"
        case .focus: "Focus timer"
        case .rainAlert: "Rain alerts"
        case .lyrics: "Lyrics"
        case .sync: "Sync across Macs"
        case .liveActivityAPI: "Live Activities API"
        case .pluginSDK: "Plugin SDK"
        case .prioritySupport: "Priority support"
        case .betaChannel: "Beta channel"
        }
    }

    /// One line on what you get, shown next to the lock.
    var benefit: String {
        switch self {
        case .notchResize: "Make the open notch wider or taller, with a live preview."
        case .edgeTrigger: "Open the notch from anywhere along the top of the screen."
        case .displayLayouts: "Choose which tabs show on each display."
        case .gestureRemap: "Choose what each swipe, scroll and long-press does."
        case .proThemes: "Eight more themes, from Aurora to Rose Gold."
        case .customColors: "Your own accent colour and glow."
        case .themeEditor: "Build a theme, then export it or import one from a friend."
        case .meetingAlert: "A heads-up before meetings, with a Join button."
        case .downloadProgress: "Watch downloads fill up beside the notch."
        case .markets: "Stocks and crypto with today's change; pin one beside the notch."
        case .flightStatus: "Altitude and speed of a flight in the air, beside the notch."
        case .multiMatch: "Follow up to five more teams; live scores take turns beside the notch."
        case .activityStacking: "Show two live activities at once, one in each ear."
        case .aiCapture: "Capture any part of the screen (⌃⌥S) or selected text and ask about it."
        case .aiHistory: "Search, reopen and export past AI conversations."
        case .aiFileDrop: "Drop or paste images and PDFs into the AI tab."
        case .messenger: "Your chats in the notch."
        case .audio: "Per-app volume and output switching."
        case .vpn: "Connect your VPN from the notch."
        case .voiceNotes: "Record and transcribe voice notes."
        case .screenTime: "See where your time goes and block distractions."
        case .quickAdd: "Add reminders and events in plain English."
        case .launcher: "Your apps in a grid, one click away."
        case .snippets: "Saved text you can paste anywhere."
        case .mirror: "A quick camera check before calls."
        case .focus: "Pomodoro sessions in the notch."
        case .rainAlert: "A nudge before it starts raining."
        case .lyrics: "Lyrics for what's playing."
        case .sync: "Your setup on every Mac, through iCloud or your account."
        case .liveActivityAPI: "Let your own apps and scripts show live activities."
        case .pluginSDK: "Build your own widgets."
        case .prioritySupport: "Your issues answered first."
        case .betaChannel: "Try new versions early."
        }
    }

    func isAllowed(at tier: Tier) -> Bool { tier >= self.tier }
}

struct LicenseKey: Equatable {
    let tier: Tier
    /// 16 hex characters; identifies the key for revocation and the device limit.
    let keyID: String
    let issued: Date
    /// The key as the user typed it, normalised (NTCH-PRO-XXXXXX-…).
    let text: String

    enum Problem: LocalizedError, Equatable {
        case notAKey, tampered, wrongTier, revoked, tooManyMacs(Int), server(String)
        var errorDescription: String? {
            switch self {
            case .notAKey: "That doesn't look like a Notch apple key. Copy the whole key, from NTCH- to the end."
            case .tampered: "That key isn't valid. Check it was copied completely, or use \"Lost my key?\"."
            case .wrongTier: "That key's tier label doesn't match the key. Copy it again from your email."
            case .revoked: "That key has been turned off (refunded or shared publicly). Use \"Lost my key?\" or contact us."
            case .tooManyMacs(let n): "That key is already active on \(n) Macs. Deactivate it on one of them (Settings → License) and try again."
            case .server(let why): why
            }
        }
    }

    /// The license server's public key. The private half never leaves the server.
    static let productionPublicKey = Data(base64Encoded: "HmCtNtd+sFaJO+8TQ57od7pptH3dhEx00SO16I1fhvs=")!

    private static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    private static let epoch = Date(timeIntervalSince1970: 1_767_225_600)   // 1 January 2026, UTC

    /// True when the text starts like a new key (so the field doesn't format it as an old code).
    static func looksLikeKey(_ input: String) -> Bool {
        input.trimmingCharacters(in: .whitespacesAndNewlines).uppercased().hasPrefix("NTCH")
    }

    /// Parses and checks the signature. Doesn't check revocation (Entitlements does, when online).
    static func parse(_ input: String, publicKey: Data = productionPublicKey) -> Result<LicenseKey, Problem> {
        let s = input.uppercased().filter { !$0.isWhitespace }
        let label: String, rest: Substring
        if s.hasPrefix("NTCH-PRO-") { label = "PRO"; rest = s.dropFirst(9) }
        else if s.hasPrefix("NTCH-ULTM-") { label = "ULTM"; rest = s.dropFirst(10) }
        else if s.hasPrefix("NTCH") { return .failure(s.count > 40 ? .wrongTier : .notAKey) }
        else { return .failure(.notAKey) }
        guard let bytes = decode(rest.filter { $0 != "-" }), bytes.count == 76, bytes[0] == 1 else { return .failure(.tampered) }
        let payload = bytes.prefix(12), signature = bytes.suffix(64)
        guard let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey),
              key.isValidSignature(signature, for: payload) else { return .failure(.tampered) }
        guard let tier = Tier(rawValue: Int(bytes[1])), tier != .free else { return .failure(.tampered) }
        guard (tier == .pro ? "PRO" : "ULTM") == label else { return .failure(.wrongTier) }
        let day = Int(bytes[10]) << 8 | Int(bytes[11])
        let id = bytes[2..<10].map { String(format: "%02x", $0) }.joined()
        let groups = stride(from: 0, to: rest.filter { $0 != "-" }.count, by: 6).map { i -> String in
            let body = Array(rest.filter { $0 != "-" })
            return String(body[i..<min(i + 6, body.count)])
        }
        return .success(LicenseKey(tier: tier, keyID: id, issued: epoch.addingTimeInterval(Double(day) * 86400),
                                   text: "NTCH-\(label)-" + groups.joined(separator: "-")))
    }

    /// Partly hidden, for Settings: NTCH-PRO-04138Y-…-EEKC7P.
    var masked: String {
        let parts = text.split(separator: "-")
        guard parts.count > 4 else { return text }
        return "\(parts[0])-\(parts[1])-\(parts[2])-…-\(parts[parts.count - 2])"
    }

    private static func decode(_ text: some StringProtocol) -> [UInt8]? {
        var out: [UInt8] = [], bits = 0, value = 0
        for var c in text {
            if c == "O" { c = "0" } else if c == "I" || c == "L" { c = "1" }
            guard let i = alphabet.firstIndex(of: c) else { return nil }
            value = (value << 5) | i; bits += 5
            if bits >= 8 { out.append(UInt8((value >> (bits - 8)) & 255)); bits -= 8; value &= (1 << bits) - 1 }
        }
        return out
    }

    /// Checks the server's signed revocation list and returns the revoked key IDs, or nil if it isn't genuine.
    static func revokedIDs(list: String, signature: String, publicKey: Data = productionPublicKey) -> [String]? {
        guard let sig = Data(base64Encoded: signature), let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey),
              key.isValidSignature(sig, for: Data(list.utf8)),
              let json = try? JSONSerialization.jsonObject(with: Data(list.utf8)) as? [String: Any] else { return nil }
        return json["ids"] as? [String] ?? []
    }

    /// The tier this Mac is entitled to: a valid signed key wins; an older activation
    /// (access code or website key from before tiers) counts as Pro.
    static func tier(key: LicenseKey?, revoked: Set<String>, legacyActivated: Bool) -> Tier {
        if let key, !revoked.contains(key.keyID) { return key.tier }
        return legacyActivated ? .pro : .free
    }
}
