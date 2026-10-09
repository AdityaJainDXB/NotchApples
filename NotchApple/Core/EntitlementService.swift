//
//  EntitlementService.swift
//  Notch apple
//
//  Fetches and keeps the licence server's tokens for this Mac (see EntitlementLogic), so paid content that lives only on
//  the server (the premium Klick sounds) and the Clipboard Link relay can be handed to a real key and to nothing else.
//  A copy of the app modified to say "yes" to every local licence check still gets no token, so it gets nothing from the
//  server. It asks at most about twice a day, only while a signed key is active, sends the key and this Mac's one-way
//  hash (the same as activating), and stores the tokens in this app's settings. Offline, the last tokens keep working
//  until they expire (72 hours), then the server content waits for the next check.
//

import Foundation

@MainActor
final class EntitlementService {
    static let shared = EntitlementService()
    private let defaults = UserDefaults.standard
    private var inFlight: Task<Void, Never>?

    private var expires: Date? { (defaults.object(forKey: "entitle.exp") as? Double).map { Date(timeIntervalSince1970: $0) } }

    /// A valid full token, renewing it first if it is missing or close to expiry. Nil if there is no signed key or the server can't be reached.
    func token() async -> String? { await current(kind: "ent1", store: "entitle.token") }

    /// A valid anonymous pass for the relay, the same way.
    func pass() async -> String? { await current(kind: "pass1", store: "entitle.pass") }

    private func current(kind: String, store: String) async -> String? {
        if EntitlementLogic.needsRenewal(expires: expires) { await refresh() }
        guard let t = defaults.string(forKey: store),
              EntitlementLogic.verify(t, kind: kind, publicKey: LicenseKey.productionPublicKey) != nil else { return nil }
        return t
    }

    /// Asks the server for fresh tokens (one request at a time).
    func refresh() async {
        if let inFlight { await inFlight.value; return }
        let task = Task<Void, Never> { [weak self] in if let self { await self.fetch() } }
        inFlight = task
        await task.value
        inFlight = nil
    }

    private func fetch() async {
        guard let key = Entitlements.shared.key, let server = await LicenseServer.url(),
              let r = await LicenseServer.post(server, "entitle", ["key": key.text, "device": Entitlements.deviceHash(for: key), "name": Entitlements.deviceLabel]),
              r["ok"] as? Bool == true, let token = r["token"] as? String, let pass = r["pass"] as? String,
              let payload = EntitlementLogic.verify(token, kind: "ent1", publicKey: LicenseKey.productionPublicKey),
              EntitlementLogic.verify(pass, kind: "pass1", publicKey: LicenseKey.productionPublicKey) != nil else { return }
        defaults.set(token, forKey: "entitle.token")
        defaults.set(pass, forKey: "entitle.pass")
        defaults.set(payload.expires.timeIntervalSince1970, forKey: "entitle.exp")
    }

    /// Downloads one piece of server-held content with the current token. Returns the bytes, or a reason.
    func download(_ id: String) async -> Result<Data, DownloadError> {
        guard Entitlements.shared.key != nil else { return .failure(.noKey) }
        guard let token = await token() else { return .failure(.offline) }
        guard let server = await LicenseServer.url() else { return .failure(.offline) }
        var req = URLRequest(url: server.appendingPathComponent("asset/\(id)"), timeoutInterval: 30)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: req), let http = response as? HTTPURLResponse else { return .failure(.offline) }
        switch http.statusCode {
        case 200: return .success(data)
        case 401: await refresh(); return .failure(.notAllowed)
        case 403: return .failure(.notAllowed)
        case 404: return .failure(.missing)
        default: return .failure(.offline)
        }
    }

    enum DownloadError: Error, Equatable {
        case noKey, offline, notAllowed, missing
        var message: String {
            switch self {
            case .noKey: "Needs a Pro key."
            case .offline: "Couldn't reach the server. Try again when you're online."
            case .notAllowed: "Your key doesn't include this."
            case .missing: "Not available yet."
            }
        }
    }
}
