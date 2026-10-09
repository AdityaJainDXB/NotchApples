//
//  CompanionClient.swift
//  Notch apple companion (iPhone)
//
//  Finds Macs running Notch apple on the same Wi-Fi (Bonjour), pairs with the
//  12-character code the Mac shows, and sends sealed requests (CompanionKit).
//  The pairing token is kept in this iPhone's Keychain.
//

import CryptoKit
import Foundation
import Network
import Security

@MainActor
final class CompanionClient: ObservableObject {
    static let shared = CompanionClient()

    struct Pairing: Codable { var macName: String; var service: String; var device: String; var token: String }

    @Published private(set) var found: [String] = []          // Bonjour service names
    @Published private(set) var pairing: Pairing?
    @Published var status: Companion.Status?
    @Published var message: String?
    @Published var busy = false
    private var browser: NWBrowser?

    init() { pairing = Keychain.load() }

    // MARK: Discovery

    func browse() {
        browser?.cancel()
        let b = NWBrowser(for: .bonjour(type: Companion.serviceType, domain: nil), using: .tcp)
        b.browseResultsChangedHandler = { results, _ in
            let names = results.compactMap { r -> String? in
                if case .service(let name, _, _, _) = r.endpoint { return name }
                return nil
            }
            let sorted = Array(Set(names)).sorted()
            Task { @MainActor in if self.found != sorted { self.found = sorted } }
        }
        b.stateUpdateHandler = { state in
            if case .failed = state { Task { @MainActor in self.message = "Allow Local Network for Notch apple in iOS Settings → Privacy & Security." } }
        }
        b.start(queue: .main)
        browser = b
    }

    // MARK: Pairing

    func pair(with service: String, code: String) async {
        busy = true; defer { busy = false }
        guard let code = Companion.normalizedCode(code) else { message = "A pairing code has 12 letters and numbers."; return }
        let codeKey = Companion.pairingKey(code: code)
        // A fresh key pair for this pairing only. The Mac's reply is sealed with a key that needs it and the code, so a
        // recording of this exchange can't be opened later, even by someone who learns the code.
        let mine = Curve25519.KeyAgreement.PrivateKey()
        let phonePublic = mine.publicKey.rawRepresentation
        do {
            let reply = try await Self.send(Companion.Message(type: .pair, name: deviceName, epk: phonePublic.base64EncodedString()),
                                            device: Companion.pairDevice, key: codeKey, service: service) { env in
                guard let macPublic = env.e.flatMap({ Data(base64Encoded: $0) }) else { return nil }
                return try? Companion.pairingSessionKey(code: codeKey, mine: mine, theirs: macPublic, phonePublic: phonePublic, macPublic: macPublic)
            }
            guard reply.type == .paired, let device = reply.device, let token = reply.token else { message = "The Mac didn't accept that code."; return }
            let p = Pairing(macName: reply.name ?? service, service: service, device: device, token: token)
            Keychain.save(p)
            pairing = p
            message = nil
            await refresh()
        } catch {
            message = "Couldn't pair: check the code (it works once, for 2 minutes, and stops after 5 wrong tries) and that both are on the same Wi-Fi."
        }
    }

    func unpair() { Keychain.delete(); pairing = nil; status = nil }

    // MARK: Requests

    @discardableResult
    func request(_ msg: Companion.Message) async -> Companion.Message? {
        guard let p = pairing, let token = Data(base64Encoded: p.token) else { message = "Pair with your Mac first."; return nil }
        busy = true; defer { busy = false }
        // A rising counter, so the Mac can tell a fresh request from a recording of an old one.
        var msg = msg
        msg.seq = nextSequence()
        do {
            let reply = try await Self.send(msg, device: p.device, key: Companion.key(token: token), service: p.service)
            if let s = reply.status { status = s }
            if reply.type == .error { message = reply.text } else { message = reply.text }
            return reply
        } catch {
            message = "Can't reach \(p.macName). Is it on the same Wi-Fi, with the iPhone companion turned on in Settings → iPhone?"
            return nil
        }
    }

    func refresh() async { await request(Companion.Message(type: .status)) }
    func send(text: String) async -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return false }
        let isLink = URL(string: t).map { ["http", "https"].contains($0.scheme?.lowercased() ?? "") } ?? false
        return await request(Companion.Message(type: .push, text: isLink ? nil : t, url: isLink ? t : nil)) != nil
    }
    func control(_ action: String) async { await request(Companion.Message(type: .control, action: action)) }

    private var deviceName: String { "iPhone" }

    /// The clock in milliseconds, kept rising even if the clock goes back. Stored so it survives the app restarting.
    private func nextSequence() -> Int64 {
        let defaults = UserDefaults.standard
        let next = Companion.nextSequence(after: Int64(defaults.integer(forKey: "companion.seq")))
        defaults.set(Int(next), forKey: "companion.seq")
        return next
    }

    /// One request per connection; gives up after 8 seconds. `replyKey` works the key out from the reply when it isn't the
    /// one the request was sealed with (pairing); otherwise the reply is opened with `key`.
    nonisolated static func send(_ msg: Companion.Message, device: String, key: SymmetricKey, service: String,
                                 replyKey: ((Companion.Envelope) -> SymmetricKey?)? = nil) async throws -> Companion.Message {
        let frame = try Companion.seal(msg, from: device, key: key)
        let conn = NWConnection(to: .service(name: service, type: Companion.serviceType, domain: "local.", interface: nil), using: .tcp)
        return try await withCheckedThrowingContinuation { cont in
            let done = Once()
            func finish(_ r: Result<Companion.Message, Error>) {
                guard done.claim() else { return }
                conn.cancel()
                cont.resume(with: r)
            }
            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    conn.send(content: frame, completion: .contentProcessed { error in if let error { finish(.failure(error)) } })
                    receive(conn, Data(), resolve: replyKey ?? { _ in key }, finish: finish)
                case .failed(let e), .waiting(let e): finish(.failure(e))
                default: break
                }
            }
            conn.start(queue: .global())
            DispatchQueue.global().asyncAfter(deadline: .now() + 8) { finish(.failure(URLError(.timedOut))) }
        }
    }

    nonisolated private static func receive(_ conn: NWConnection, _ buf: Data, resolve: @escaping (Companion.Envelope) -> SymmetricKey?,
                                            finish: @escaping (Result<Companion.Message, Error>) -> Void) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { data, _, isDone, error in
            var b = buf
            if let data { b.append(data) }
            if let need = Companion.frameLength(b), b.count >= need {
                if let env = Companion.envelope(from: b), let key = resolve(env), let msg = Companion.open(env, key: key) { finish(.success(msg)) }
                else { finish(.failure(URLError(.cannotDecodeContentData))) }
            } else if error != nil || isDone {
                finish(.failure(error ?? URLError(.networkConnectionLost)))
            } else {
                receive(conn, b, resolve: resolve, finish: finish)
            }
        }
    }
}

/// Makes sure a continuation resumes exactly once.
final class Once: @unchecked Sendable {
    private var used = false
    private let lock = NSLock()
    func claim() -> Bool { lock.lock(); defer { lock.unlock() }; if used { return false }; used = true; return true }
}

enum Keychain {
    private static let account = "notchapple.pairing"
    static func save(_ p: CompanionClient.Pairing) {
        delete()
        guard let data = try? JSONEncoder().encode(p) else { return }
        SecItemAdd([kSecClass: kSecClassGenericPassword, kSecAttrAccount: account, kSecValueData: data,
                    kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlock] as CFDictionary, nil)
    }
    static func load() -> CompanionClient.Pairing? {
        var out: AnyObject?
        guard SecItemCopyMatching([kSecClass: kSecClassGenericPassword, kSecAttrAccount: account, kSecReturnData: true] as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(CompanionClient.Pairing.self, from: data)
    }
    static func delete() { SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrAccount: account] as CFDictionary) }
}
