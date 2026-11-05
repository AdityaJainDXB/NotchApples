//
//  Entitlements.swift
//  Notch Apple
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

    func canUse(_ feature: Feature) -> Bool { !UpdateChecker.isLocked && !(Self.emailGateLocked && feature.tier != .free) && feature.isReady && feature.isAllowed(at: tier) }
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
            notice = "Notch Apple couldn't check your license for over \(LicenseKey.verificationGraceHours / 24) days. Connect to the internet and it comes back on its own."
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
                if r["reason"] as? String == "verify" { throw LicenseKey.Problem.needsVerification(bound: r["bound"] as? Bool ?? false, hint: r["hint"] as? String) }
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

    // MARK: The email gate
    // After the update that ties keys to an email, a Mac whose key has no email yet is asked to set it up before it carries on with its
    // paid features. Free features never wait. Nothing is checked until the server answers (offline Macs are left alone), and once the
    // email is set this never asks again.

    struct EmailGate: Equatable { var key: String; var bound: Bool; var hint: String? }
    @Published var emailGate: EmailGate?
    nonisolated static var emailGateLocked: Bool { UserDefaults.standard.bool(forKey: "license.emailGate") }
    private static let emailSetKey = "license.emailSet"

    func checkEmailGate() async {
        guard let k = key, !UserDefaults.standard.bool(forKey: Self.emailSetKey), let server = await LicenseServer.url() else { return }
        let base = ["key": k.text, "device": Self.deviceHash(for: k), "name": Self.deviceLabel]
        guard let a = await LicenseServer.post(server, "activate", base) else { return }
        if a["ok"] as? Bool == false {
            guard a["reason"] as? String == "verify" else { return }               // revoked, full…: not this screen's business
            setGate(EmailGate(key: k.text, bound: a["bound"] as? Bool ?? false, hint: a["hint"] as? String))
        } else {
            guard let s = await LicenseServer.post(server, "security", base), s["ok"] as? Bool == true else { return }   // an older server: leave everything as it is
            if s["email"] as? Bool == true { UserDefaults.standard.set(true, forKey: Self.emailSetKey); setGate(nil) }
            else { setGate(EmailGate(key: k.text, bound: false, hint: nil)) }
        }
    }

    private func setGate(_ gate: EmailGate?) {
        UserDefaults.standard.set(gate != nil, forKey: "license.emailGate")
        emailGate = gate
        notice = gate == nil ? (notice == Self.emailNotice ? nil : notice) : Self.emailNotice
        recompute()
    }
    static let emailNotice = "Please set up your email to keep using your paid features. Settings → License → Security."

    /// Called when the email is confirmed (from the gate or from Settings).
    func emailConfirmed() { UserDefaults.standard.set(true, forKey: Self.emailSetKey); setGate(nil) }

    // MARK: Email code and authenticator app
    // A key belongs to one email. A Mac that is new to the key confirms it once, with a code we email or one from an authenticator app;
    // after that this Mac is remembered and never asked again (not at launch, not after deactivating and activating again).

    private func secure(_ path: String, _ key: String, _ extra: [String: String] = [:]) async -> [String: Any] {
        guard case .success(let k) = LicenseKey.parse(key), let server = await LicenseServer.url() else {
            return ["error": "Couldn't reach the server. Check your connection and try again."]
        }
        var body = ["key": k.text, "device": Self.deviceHash(for: k)]
        body.merge(extra) { $1 }
        return await LicenseServer.post(server, path, body) ?? ["error": "Couldn't reach the server. Check your connection and try again."]
    }

    private static func failure(_ r: [String: Any]) -> String? {
        r["error"] as? String ?? (r["ok"] as? Bool == false ? (r["reason"] as? String == "limit" ? "That key is already on \(r["limit"] as? Int ?? 3) Macs. Deactivate it on one first." : "That didn't work. Try again.") : nil)
    }

    /// Emails a six-digit code. The answer is the same for a wrong address, on purpose. Returns an error message or nil.
    func requestCode(key: String, email: String) async -> String? {
        let r = await secure("otp/start", key, ["email": email.trimmingCharacters(in: .whitespaces)])
        if r["reason"] as? String == "revoked" { return LicenseKey.Problem.revoked.errorDescription }
        return r["sent"] as? Bool == true ? nil : (Self.failure(r) ?? "Couldn't send the code.")
    }

    /// Checks the code (`totp` for an authenticator app), then activates the key on this Mac. Returns an error message or nil.
    func verify(key: String, email: String, code: String, totp: Bool) async -> String? {
        let r = await secure("otp/verify", key, ["email": email.trimmingCharacters(in: .whitespaces), "code": code.trimmingCharacters(in: .whitespaces),
                                                  "method": totp ? "totp" : "email", "name": Self.deviceLabel])
        if let e = Self.failure(r) { return e }
        do { try await activate(key); emailConfirmed(); return nil } catch { return error.localizedDescription }
    }

    /// What Settings shows: whether the key has an email and an authenticator. Nil when offline.
    func securityStatus() async -> (email: Bool, hint: String?, totp: Bool)? {
        guard let key = key else { return nil }
        let r = await secure("security", key.text)
        guard r["ok"] as? Bool == true else { return nil }
        return (r["email"] as? Bool ?? false, r["hint"] as? String, r["totp"] as? Bool ?? false)
    }

    /// Adds an email to a key that has none (from a Mac that already uses it): step 1 emails a code, step 2 confirms it.
    func addEmailStart(_ email: String) async -> String? { guard let key = key else { return "No key on this Mac." }; return await requestCode(key: key.text, email: email) }
    func addEmailFinish(_ email: String, code: String) async -> String? {
        guard let key = key else { return "No key on this Mac." }
        let e = Self.failure(await secure("otp/verify", key.text, ["email": email.trimmingCharacters(in: .whitespaces), "code": code.trimmingCharacters(in: .whitespaces), "method": "email", "name": Self.deviceLabel]))
        if e == nil { emailConfirmed() }
        return e
    }
    func totpSetup() async -> (uri: String, secret: String)? {
        guard let key = key else { return nil }
        let r = await secure("totp/setup", key.text)
        guard let u = r["uri"] as? String, let s = r["secret"] as? String else { return nil }
        return (u, s)
    }
    func totpSetupError() async -> String { "Couldn't start setup. Add your email first, or try again." }
    func totpConfirm(_ code: String) async -> String? { guard let key = key else { return "No key on this Mac." }; return Self.failure(await secure("totp/confirm", key.text, ["code": code])) }
    func totpDisable(_ code: String) async -> String? { guard let key = key else { return "No key on this Mac." }; return Self.failure(await secure("totp/disable", key.text, ["code": code])) }

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
        } else if notice?.hasPrefix("Notch Apple couldn't check") == true {
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
        case .wallpaper: .liveWallpaper
        case .convert: .convert
        case .doIt: .doIt
        default: nil
        }
    }

    /// True for tabs that need Pro.
    var isGated: Bool { feature != nil }
}

/// Where the license server lives. The website's api.json names it, so it can move
/// without an app update. Cached for a week.
enum LicenseServer {
    static let directory = URL(string: "https://adityajaindxb.github.io/NotchApples/api.json")!
    static let site = "https://adityajaindxb.github.io/NotchApples/pro.html"

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
