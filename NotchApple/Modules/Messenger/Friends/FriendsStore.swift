//
//  FriendsStore.swift
//  Notch Apple
//
//  Where Friends keeps things on this Mac. The keys and the friend code are in the secrets store (KeychainHelper); the
//  history, the friend list and the block list are one file, sealed with AES-GCM under a random key kept there too, in
//  Application Support/Notch apple/Friends. Nothing is synced to iCloud or included in the settings export.
//

import CryptoKit
import Foundation

final class FriendsStore {
    static let shared = FriendsStore()

    private let fileURL: URL = {
        let fm = FileManager.default
        let dir = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Notch apple/Friends", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: dir.path)
        return dir.appendingPathComponent("vault.bin")
    }()

    /// This install's identity: made on first use and kept for good.
    func identity() -> FriendIdentity {
        if let text = KeychainHelper.get(.friendsIdentity), let id = try? JSONDecoder().decode(FriendIdentity.self, from: Data(text.utf8)) { return id }
        let id = FriendIdentity.generate()
        if let data = try? JSONEncoder().encode(id) { _ = KeychainHelper.set(String(decoding: data, as: UTF8.self), for: .friendsIdentity) }
        return id
    }

    private func vaultKey() -> SymmetricKey {
        if let text = KeychainHelper.get(.friendsVaultKey), let raw = Friends.unb64u(text), raw.count == 32 { return SymmetricKey(data: raw) }
        let key = SymmetricKey(size: .bits256)
        _ = KeychainHelper.set(Friends.b64u(key.withUnsafeBytes { Data($0) }), for: .friendsVaultKey)
        return key
    }

    func load() -> FriendsVault {
        guard let data = try? Data(contentsOf: fileURL), let box = try? AES.GCM.SealedBox(combined: data),
              let plain = try? AES.GCM.open(box, using: vaultKey()), let vault = try? JSONDecoder().decode(FriendsVault.self, from: plain) else { return FriendsVault() }
        return vault
    }

    func save(_ vault: FriendsVault) {
        guard let plain = try? JSONEncoder().encode(vault), let sealed = try? AES.GCM.seal(plain, using: vaultKey()).combined else { return }
        try? sealed.write(to: fileURL, options: [.atomic, .completeFileProtection])
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }

    /// "Delete all my chat data": the history, friends and block list. The friend code and keys stay (the code is for life).
    func wipe() { try? FileManager.default.removeItem(at: fileURL) }
}
