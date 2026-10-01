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
//   • promo: ref must be the hash of one of the 50 real promo codes;
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

    /// SHA-256 of "PROMO" + the 12 code characters.
    static let promoHashes: Set<String> = [
        "ac4a37500c7956c1f8ea62df3114d7a99f14c14da75fa217b820c1d1d1386363",
        "01e3c47261f3463dfc92aae452c39add3284a3fdea4062d810fd70773e357c22",
        "eda3d49a88774830110e754712b392751c0ab222e34b5382b2599521d04250ad",
        "65e9ee0536873b1328de7af086e64316d70dcb6e1e5f7d374ed277804e457656",
        "6cc11ea96a4802fb81414175fa39c9c7b5526b7810833379d387b786a6b04a8f",
        "49fdd7aa8a42de4665eed747b265c59950475a0a8d0f1392d7b8d603c81e763d",
        "b9ba4f7c58f9d47cd4d562a4751e2e1721f4271fe2a8846a02c0049b5b5323ec",
        "ef07990f901bad6bf8689682bc8d19985a3e57aa869b176fda71e682cd2d830c",
        "a2674a8543b5887d7629fe294a0e2879de7a4e23e82655827aa2126ca98bb12e",
        "0cff91e9f3721f9fe29782d0547f81a3d7b7c3a51aa4c22056a4c4dc253787a7",
        "05ab9ee051812fffdf532cb225eadd5cc6c2c5c5ad6ebf8ddee022e48942e7c4",
        "1fffcc4cf60f90975cc3e8107c18c0487d501b7d4aa98db19ad5a608a52aab45",
        "d1646d76106082006921c226a91516a8a9a4877435f46d3d6aa7f84e0452552e",
        "877bdaa4c3df0a3c25412c9dd34c50978085ea7108453858dc3dd184fd85a8ef",
        "a50c15ea0bd86329633d8a99636887b32794ee356ba4253464626379d9309a23",
        "c607ba8fca726b49434fdad679e805d88c513a8f1f7ddc8e5c91b3a09a37aed0",
        "0dc33cb6e85443961f75ca250ee82f0b7066c9f500ceca73cf746c0e41e866e1",
        "42b19dd2d0f58dbbf22cb9cd36980a2ee3765fe1c8a7bad2614f6a9c24eeb7bc",
        "dcbc5daa475b02e2065724ad5f371c062fe7dcb2f537e774d883a4093610090d",
        "4c7b585ce4edda954401e5b31517e9871a39aef9707d65ba5d4d78145ac9b41b",
        "ab9114a6452ef5e9cacea7ab3fa6de030a139599eb9337653d4985aac74409a3",
        "4e25614e6676748f2687f10a56e80a869edb69acdaab9f014fe63b5c5a45f688",
        "fe6ca0bd656019afd8704e44e3aae07cca6bdf87a64083c15083fcf7f4a7ecb4",
        "8ab9ee29893cc0e423a418fda9370bfbfdeb3f6105854985cb61ba9f22372166",
        "63e53d2ccd3fafb0a758b4fe6a0c64a4d44652ead196f48536e814646d667400",
        "ffbda69a55b45739e0ccfb9b3d620b6d9245a6534c587a3439515976b8d27265",
        "52947eb4a6046bd22056ac146990d85b292ec2b52dbd630fba82ffbb6fa45b61",
        "35a327707b5961cf138305b96b96885a0c79c8b58cd3657204eb5daca1c7372f",
        "0a6b49c9c8b8084a273d48d24a6254ee465d546b9115ed21099b563192433aa3",
        "d4c9469eb8bb5b2a7f864e9f3cb30418a9fb45c083a78b095bbdad49bbf57bbf",
        "f621ad44b6068898e85d79c30cd9e93bab429adc066c1c23070feae03ef87b10",
        "143214be4950a5d7c313ece19f4daa6986045131814be83504398931130ba92b",
        "cc0cb62806fb67758a7115b4bf177bb0973e9dccdc75b44e1916d0dba05f0340",
        "1686a8cdf6eda5a8f4ce3a067e592d5144feb29aee3661f95514f81d0e8cf995",
        "b90cb30b21a469f6bee88047ff5db63c5dc07cd44e66965e6e1e9854fd349980",
        "ec4e542b487eebe4e2eea643c89cbff2198e4d9c6c17af7c783e7e6c47423187",
        "777b9fbad39d5ca79e415d74f07352e9790a4309c268aceea58d64b80203457b",
        "093d297472d195722193ecbe0ba8b5265a9e55513aa84708e8e02e6744e45e52",
        "24851dacff60dbdbd6f2def9fe2f2f33a405ccbd2563c778a1ac12dbb0089f64",
        "00dd7ad838b87a3472cd2d312a4ea3dc394e7efc81993f99f1793c89a20cd8ba",
        "c3728b56345a35f785c0f5415b59e52a1178754b049f96a73b75aaf4d057aae6",
        "0c02adb8754ebea20feffc40a043a9105dcd31b20f3d49dcc11ceefe3388391d",
        "a363f2d3c5bdc8ec1857dff7355ea152760ded2396333a4189145649e38046f5",
        "43adeeb41960f31a120afaae6e3252592ed4b440cd21c1ed5c45cddd24b0a09b",
        "6e0f3d4e8fbce3aa26d5f0b9245d0597a97f91259a52c8ecc20a5c4908d9c4e5",
        "d058a993fbcbae1caebf4920f5b92a29e41676e33af06aff2c55732e03bc95e6",
        "8fe524627b8e1790f3c68f2edf107745e6efd309dd2c9b84069ae308bbcbc09d",
        "0a416fe1bb0e26724373609263c45b4819e643c51219755a1834b3715094f557",
        "b579cb91f33b1e942995971e697753661929073780d946e478111cff785ae5a1",
        "e751a34f3b6823249f9cbd51070a78ba70c0ffec8820f4938027153d04fe1a27",
    ]

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
        case "promo": guard promoHashes.contains(ref) else { throw KeyError.invalid }
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
