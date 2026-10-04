//
//  KeychainHelper.swift
//  Notch apple
//
//  Stores secrets (API keys, the face-unlock template) in a private file in
//  Application Support, readable only by the current user (0600, in a 0700
//  folder; FileVault encrypts it at rest).
//
//  Why not the login Keychain: the app is ad-hoc signed, so every build has a
//  new code signature. Keychain items are tied to the signature that created
//  them, so each update made macOS ask for the login password again, over and
//  over. The old Keychain items are deliberately never read (reading them is
//  what triggers the prompt); users re-enter their keys once.
//

import Foundation

enum KeychainHelper {
    enum Key: String {
        case anthropicAPIKey = "anthropic.apiKey"
        case geminiAPIKey = "gemini.apiKey"
        case groqAPIKey = "groq.apiKey"
        case openRouterAPIKey = "openrouter.apiKey"
        case openAIAPIKey = "openai.apiKey"
        case deepSeekAPIKey = "deepseek.apiKey"
        case faceTemplate = "faceUnlock.template"
        case activated = "license.activated"
        case activatedCodeHash = "license.codeHash"
        case activatedCodeMask = "license.codeMask"
        case accountRefreshToken = "account.refreshToken"
        case productKeyHash = "license.productKeyHash"
        case licenseKey = "license.key"
        case todoistToken = "todoist.token"
    }

    private static let lock = NSLock()

    private static let fileURL: URL = {
        let fm = FileManager.default
        let dir = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Notch apple", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: dir.path)
        return dir.appendingPathComponent("secrets.json")
    }()

    /// Saves (or replaces) a string value.
    @discardableResult
    static func set(_ value: String, for key: Key) -> Bool {
        setData(Data(value.utf8), for: key)
    }

    /// Saves (or replaces) raw data.
    @discardableResult
    static func setData(_ value: Data, for key: Key) -> Bool {
        update { $0[key.rawValue] = value }
    }

    static func get(_ key: Key) -> String? {
        getData(key).flatMap { String(data: $0, encoding: .utf8) }
    }

    static func getData(_ key: Key) -> Data? {
        lock.lock(); defer { lock.unlock() }
        return load()[key.rawValue]
    }

    @discardableResult
    static func delete(_ key: Key) -> Bool {
        update { $0[key.rawValue] = nil }
    }

    // MARK: Storage

    private static func load() -> [String: Data] {
        guard let data = try? Data(contentsOf: fileURL),
              let dict = try? JSONDecoder().decode([String: Data].self, from: data) else { return [:] }
        return dict
    }

    private static func update(_ change: (inout [String: Data]) -> Void) -> Bool {
        lock.lock(); defer { lock.unlock() }
        var dict = load()
        change(&dict)
        guard let data = try? JSONEncoder().encode(dict) else { return false }
        // Create the file owner-only before any secret is written to it.
        let fm = FileManager.default
        if !fm.fileExists(atPath: fileURL.path) {
            fm.createFile(atPath: fileURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
        }
        do {
            try data.write(to: fileURL, options: .atomic)
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
            return true
        } catch {
            return false
        }
    }
}
