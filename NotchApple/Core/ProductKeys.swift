//
//  ProductKeys.swift
//  Notch apple
//
//  One-time product keys (NOTCH-XXXX-XXXX-XXXX) from the website: bought for
//  $1 in Litecoin, or claimed free with a promo code. The site writes the
//  key's SHA-256 to Firestore as keys/{hash} = { source, ref, redeemed }, with
//  claims/{ref} = { key } so one payment or promo code only ever makes one key.
//
//  Redeeming here checks everything again instead of trusting the site:
//   • promo: ref must be a real promo code's hash (enforced by the Firestore rules);
//   • ltc:   ref is a Litecoin transaction that must really pay our wallet
//            (about $1 or more), read from the public blockchain;
//   • the claim must point back at this key, and the key must be unused.
//  Then it's marked redeemed for this Mac (rules allow that change only once).
//  The same Mac can activate again later; any other Mac is refused.
//

import CryptoKit
import Foundation
import IOKit

enum ProductKeys {
    static let wallet = "ltc1qymlmvkdmvpk5f90esthzgwaw6w0tuzq6tdr6kf"
    /// Lowest payment the app accepts: 0.005 LTC (well under $1, to allow for price swings).
    static let minimumLitoshi: Int64 = 500_000

    enum KeyError: LocalizedError {
        case notFound, used, invalid, payment, offline(String)
        var errorDescription: String? {
            switch self {
            case .notFound: "That product key doesn't exist. Check it and try again."
            case .used: "That product key has already been used on another Mac."
            case .invalid: "That product key isn't valid."
            case .payment: "The Litecoin payment for that key couldn't be confirmed."
            case .offline(let why): "Couldn't check the key (\(why)). Connect to the internet and try again."
            }
        }
    }

    /// True for the new 12-character keys (the older 8-character access codes are checked offline).
    static func isProductKey(_ sanitized: String) -> Bool { sanitized.count == 17 && sanitized.hasPrefix("NOTCH") }

    /// Anonymous ID for this Mac: SHA-256 of its hardware UUID, so the key stays tied to one Mac.
    static let macID: String = {
        let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPlatformExpertDevice"))
        defer { IOObjectRelease(service) }
        let uuid = IORegistryEntryCreateCFProperty(service, "IOPlatformUUID" as CFString, kCFAllocatorDefault, 0)?
            .takeRetainedValue() as? String ?? Host.current().localizedName ?? "mac"
        return SHA256.hash(data: Data(("notchapple" + uuid).utf8)).map { String(format: "%02x", $0) }.joined()
    }()

    // MARK: Redeem

    /// Checks and redeems a key. Returns its hash, which is what gets saved as the activation.
    static func redeem(_ sanitized: String) async throws -> String {
        guard isProductKey(sanitized) else { throw KeyError.invalid }
        let hash = AccessCodeManager.hash(of: sanitized)
        let key = try await verify(hash: hash)
        if key.redeemed {
            guard key.mac == macID else { throw KeyError.used }
            return hash
        }
        try await markRedeemed(hash)
        return hash
    }

    /// For activations restored from the user's account: the key must exist, be genuine and have been redeemed.
    static func verifyRedeemed(hash: String) async -> Bool {
        guard let key = try? await verify(hash: hash) else { return false }
        return key.redeemed
    }

    private struct Key { let redeemed: Bool; let mac: String? }

    private static func verify(hash: String) async throws -> Key {
        guard let doc = try await document("keys/\(hash)") else { throw KeyError.notFound }
        guard let source = doc["source"], let ref = doc["ref"] else { throw KeyError.invalid }
        // One key per payment/promo: the claim must name this key.
        guard try await document("claims/\(ref)")?["key"] == hash else { throw KeyError.invalid }
        switch source {
        // Promo keys can only be created for a real promo code: the Firestore rules check the code's
        // hash against the list (see firestore.rules and scripts/promo_codes.py), so the app doesn't ship one.
        case "promo": guard ref.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { throw KeyError.invalid }
        case "ltc": guard try await paysWallet(txid: ref) else { throw KeyError.payment }
        default: throw KeyError.invalid
        }
        return Key(redeemed: doc["redeemed"] == "true", mac: doc["mac"])
    }

    // MARK: Litecoin

    private static func paysWallet(txid: String) async throws -> Bool {
        guard txid.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
              let url = URL(string: "https://litecoinspace.org/api/tx/\(txid)") else { return false }
        let (data, response) = try await fetch(url)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let tx = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let outs = tx["vout"] as? [[String: Any]] else { return false }
        let paid = outs.filter { $0["scriptpubkey_address"] as? String == wallet }
            .reduce(Int64(0)) { $0 + (($1["value"] as? NSNumber)?.int64Value ?? 0) }
        // The website already checked the dollar value when it made the key. Here only a fixed LTC
        // floor is used, so a genuine key still works months later even if the price of LTC has fallen.
        return paid >= minimumLitoshi
    }

    // MARK: Firestore (public REST, no sign-in needed)

    private static func base() throws -> String {
        guard let cfg = AccountSync.Config.load else { throw KeyError.offline("missing configuration") }
        return "https://firestore.googleapis.com/v1/projects/\(cfg.projectID)/databases/(default)/documents"
    }

    /// A document's fields as strings (booleans become "true"/"false"), or nil if it doesn't exist.
    private static func document(_ path: String) async throws -> [String: String]? {
        guard let cfg = AccountSync.Config.load, let url = URL(string: "\(try base())/\(path)?key=\(cfg.apiKey)") else { return nil }
        let (data, response) = try await fetch(url)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 404 || status == 403 { return nil }
        guard status == 200, let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw KeyError.offline("server said \(status)")
        }
        var out: [String: String] = [:]
        for (k, v) in (json["fields"] as? [String: [String: Any]]) ?? [:] {
            if let s = v["stringValue"] as? String { out[k] = s }
            else if let b = v["booleanValue"] as? Bool { out[k] = b ? "true" : "false" }
        }
        return out
    }

    private static func markRedeemed(_ hash: String) async throws {
        guard let cfg = AccountSync.Config.load,
              let url = URL(string: "\(try base())/keys/\(hash)?key=\(cfg.apiKey)&updateMask.fieldPaths=redeemed&updateMask.fieldPaths=redeemedAt&updateMask.fieldPaths=mac&currentDocument.exists=true")
        else { throw KeyError.invalid }
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["fields": [
            "redeemed": ["booleanValue": true],
            "redeemedAt": ["timestampValue": ISO8601DateFormatter().string(from: .now)],
            "mac": ["stringValue": macID],
        ]])
        let (_, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        // 403 = the rules refused: someone redeemed it a moment ago.
        if status == 403 { throw KeyError.used }
        guard status == 200 else { throw KeyError.offline("server said \(status)") }
    }

    private static func fetch(_ url: URL) async throws -> (Data, URLResponse) {
        do { return try await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 20)) }
        catch { throw KeyError.offline(error.localizedDescription) }
    }
}
