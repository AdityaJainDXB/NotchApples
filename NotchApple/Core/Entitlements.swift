//
//  Entitlements.swift
//  Notch apple
//
//  The one place that decides what this Mac may use: `Entitlements.shared.tier`
//  and `canUse(_:)`. Every paid feature asks it; nothing else checks licenses.
//
//  Where the tier comes from:
//   • a signed key (LicenseKey), checked offline against the built-in public key;
//   • otherwise an activation from before tiers (access code or website key) = Pro.
//
//  Network (all optional; the app works offline and nothing identifies you):
//   • once, the website's api.json says where the license server is;
//   • activating or deactivating a key sends the key and a one-way hash of this
//     Mac (salted per key), only to enforce the 3-Mac limit;
//   • about once a day, while a key is active, it downloads the signed list of
//     revoked key IDs (refunds and leaked keys). Nothing about you is sent.
//

import Combine
import CryptoKit
import Foundation
import IOKit

@MainActor
final class Entitlements: ObservableObject {
    static let shared = Entitlements()

    @Published private(set) var tier: Tier = .free
    @Published private(set) var key: LicenseKey?
    /// Shown once in Settings → License, e.g. when a key was revoked.
    @Published var notice: String?
    /// What the license server shows beside this device in the admin panel. Deliberately generic: the Mac's own
    /// name (often "Someone's MacBook") is never sent.
    static var deviceLabel: String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "Mac (macOS \(v.majorVersion).\(v.minorVersion))"
    }

    /// A key from a notchapple://activate link, waiting in Settings → License for the user to confirm.
    @Published var pendingKey: String?

    private var cancellables = Set<AnyCancellable>()
    private let defaults = UserDefaults.standard

    private init() {
        if let text = KeychainHelper.get(.licenseKey), case .success(let k) = LicenseKey.parse(text) { key = k }
        // Keys from before this check started: the 30 days begin now.
        if key != nil, lastVerified == nil { lastVerified = Date() }
        recompute()
        LicenseState.shared.$isActivated.dropFirst().sink { [weak self] _ in
            DispatchQueue.main.async { self?.recompute() }
        }.store(in: &cancellables)
    }

    func canUse(_ feature: Feature) -> Bool { !UpdateChecker.isLocked && feature.isReady && feature.isAllowed(at: tier) }
    func canUse(_ module: Module) -> Bool { !UpdateChecker.isLocked && (module.feature.map(canUse) ?? true) }

    /// What's legacy-activated (access code or pre-tier website key) counts as Pro.
    var hasLegacyActivation: Bool { LicenseState.shared.isActivated }

    private var revoked: Set<String> { Set(defaults.stringArray(forKey: "license.revoked") ?? []) }

    /// When the revoked list was last fetched successfully. A key not verified for 3 days pauses until it is.
    private var lastVerified: Date? {
        get { (defaults.object(forKey: "license.verifiedAt") as? Double).map { Date(timeIntervalSince1970: $0) } }
        set { defaults.set(newValue?.timeIntervalSince1970, forKey: "license.verifiedAt") }
    }

    private func recompute() {
        var usable = key
        if key != nil, LicenseKey.verificationLapsed(lastVerified: lastVerified) {
            usable = nil
            notice = "Notch apple couldn't check your license for over \(LicenseKey.verificationGraceHours / 24) days. Connect to the internet and it comes back on its own."
        }
        let t = LicenseKey.tier(key: usable, revoked: revoked, legacyActivated: hasLegacyActivation)
        if t != tier { tier = t }
    }

    // MARK: Activate / deactivate

    /// Checks the key offline, then (if the server is reachable) registers this Mac.
    /// Being offline never blocks activation; the device limit is a soft one.
    func activate(_ input: String) async throws {
        let k: LicenseKey
        switch LicenseKey.parse(input) {
        case .success(let parsed): k = parsed
        case .failure(let problem): throw problem
        }
        if revoked.contains(k.keyID) { throw LicenseKey.Problem.revoked }
        if let server = await LicenseServer.url() {
            switch await LicenseServer.post(server, "activate", ["key": k.text, "device": Self.deviceHash(for: k), "name": Self.deviceLabel]) {
            case .some(let r) where r["ok"] as? Bool == false:
                if r["reason"] as? String == "revoked" { throw LicenseKey.Problem.revoked }
                if r["reason"] as? String == "limit" { throw LicenseKey.Problem.tooManyMacs(r["limit"] as? Int ?? 3) }
                if let e = r["error"] as? String { throw LicenseKey.Problem.server(e) }
            default: break   // offline or server down: allow
            }
        }
        guard KeychainHelper.set(k.text, for: .licenseKey) else { throw LicenseKey.Problem.server("Couldn't save the key on this Mac.") }
        key = k
        notice = nil
        lastVerified = Date()
        recompute()
    }

    /// Frees this Mac's slot on the server (best effort) and removes the key here.
    /// Older activations are removed too, so the Mac goes back to Free.
    func deactivateThisMac() async {
        if let k = key, let server = await LicenseServer.url() {
            _ = await LicenseServer.post(server, "deactivate", ["key": k.text, "device": Self.deviceHash(for: k)])
        }
        KeychainHelper.delete(.licenseKey)
        key = nil
        LicenseState.shared.deactivate()
        recompute()
    }

    // MARK: Revocation

    /// At most every 10 minutes (launch and wake always check; a 10-minute timer calls it too), and only while a
    /// signed key is active. A suspended key stops working at the next check; no update is needed.
    func checkRevocationIfDue(force: Bool = false) async {
        guard let k = key else { return }
        let last = defaults.double(forKey: "license.revokedCheckedAt")
        guard force || Date().timeIntervalSince1970 - last > 600, let server = await LicenseServer.url(),
              let r = await LicenseServer.get(server, "revoked"),
              let list = r["list"] as? String, let sig = r["sig"] as? String,
              let ids = LicenseKey.revokedIDs(list: list, signature: sig) else { return }
        defaults.set(ids, forKey: "license.revoked")
        defaults.set(Date().timeIntervalSince1970, forKey: "license.revokedCheckedAt")
        lastVerified = Date()
        if ids.contains(k.keyID) {
            notice = LicenseKey.Problem.revoked.errorDescription
        } else if notice?.hasPrefix("Notch apple couldn't check") == true {
            notice = nil
        }
        recompute()
    }

    // MARK: Device

    /// SHA-256 of this Mac's hardware UUID salted with the key ID: the server can tell Macs
    /// apart for one key, but can't link a Mac across keys or recover the UUID.
    static func deviceHash(for key: LicenseKey) -> String {
        let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPlatformExpertDevice"))
        defer { IOObjectRelease(service) }
        let uuid = IORegistryEntryCreateCFProperty(service, "IOPlatformUUID" as CFString, kCFAllocatorDefault, 0)?
            .takeRetainedValue() as? String ?? "mac"
        return SHA256.hash(data: Data("notchapple-license|\(key.keyID)|\(uuid)".utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

extension Module {
    /// The paid feature a whole tab belongs to, if any.
    var feature: Feature? {
        switch self {
        case .messenger: .messenger
        case .audio: .audio
        case .vpn: .vpn
        case .voiceNotes: .voiceNotes
        case .screenTime: .screenTime
        case .quickAdd: .quickAdd
        case .markets: .markets
        case .home: .homeLayout
        case .cacheCleaner: .cacheCleaner
        case .claudeUsage: .claudeUsage
        case .smartHome: .smartHome
        case .launcher: .launcher
        case .snippets: .snippets
        case .mirror: .mirror
        case .focus: .focus
        case .klick: .klick
        default: nil
        }
    }

    /// True for tabs that need Pro.
    var isGated: Bool { feature != nil }
}

/// Where the license server lives. The website's api.json names it, so it can move
/// without an app update. Cached for a week.
enum LicenseServer {
    static let directory = URL(string: "https://virajsinghchadha.github.io/notchapples-site/api.json")!
    static let site = "https://virajsinghchadha.github.io/notchapples-site/pro.html"

    static func url() async -> URL? {
        let d = UserDefaults.standard
        if let cached = d.string(forKey: "license.server"), Date().timeIntervalSince1970 - d.double(forKey: "license.serverAt") < 7 * 86_400 {
            return URL(string: cached)
        }
        guard let (data, _) = try? await URLSession.shared.data(for: URLRequest(url: directory, timeoutInterval: 10)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let s = json["licenseServer"] as? String, s.hasPrefix("https://"), let url = URL(string: s) else {
            return d.string(forKey: "license.server").flatMap(URL.init(string:))
        }
        d.set(s, forKey: "license.server")
        d.set(Date().timeIntervalSince1970, forKey: "license.serverAt")
        return url
    }

    static func get(_ base: URL, _ path: String) async -> [String: Any]? {
        guard let (data, _) = try? await URLSession.shared.data(for: URLRequest(url: base.appendingPathComponent(path), timeoutInterval: 15)) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    static func post(_ base: URL, _ path: String, _ body: [String: String]) async -> [String: Any]? {
        var r = URLRequest(url: base.appendingPathComponent(path), timeoutInterval: 15)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "content-type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        guard let (data, _) = try? await URLSession.shared.data(for: r) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}
