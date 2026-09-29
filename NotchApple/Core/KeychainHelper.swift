//
//  KeychainHelper.swift
//  Notch apple
//
//  Minimal wrapper over the Security framework for storing secrets (the
//  user's Anthropic API key) in the login Keychain. Secrets never touch
//  UserDefaults or disk in plain text.
//

import Foundation
import Security

enum KeychainHelper {
    private static let service = "com.notchapple.app"

    enum Key: String {
        case anthropicAPIKey = "anthropic.apiKey"
        case geminiAPIKey = "gemini.apiKey"
        case groqAPIKey = "groq.apiKey"
        case openRouterAPIKey = "openrouter.apiKey"
        case openAIAPIKey = "openai.apiKey"
        case deepSeekAPIKey = "deepseek.apiKey"
        case faceTemplate = "faceUnlock.template"
    }

    /// Saves (or replaces) a string value.
    @discardableResult
    static func set(_ value: String, for key: Key) -> Bool {
        setData(Data(value.utf8), for: key)
    }

    /// Saves (or replaces) raw data.
    @discardableResult
    static func setData(_ value: Data, for key: Key) -> Bool {
        delete(key)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecValueData as String: value,
            // Only readable while the Mac is unlocked, never synced to other devices.
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    static func get(_ key: Key) -> String? {
        getData(key).flatMap { String(data: $0, encoding: .utf8) }
    }

    static func getData(_ key: Key) -> Data? {
        // Screenshots: pretend API keys are set, never touch the real Keychain.
        if DemoMode.isOn { return key == .faceTemplate ? nil : Data("demo-key".utf8) }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return data
    }

    @discardableResult
    static func delete(_ key: Key) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
