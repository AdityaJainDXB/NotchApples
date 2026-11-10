//
//  LockCodeLogic.swift
//  Notch Apple
//
//  A short code (4 to 8 digits) that unlocks Notch Apple's locked tabs, as an alternative to Touch ID or the Mac password.
//  Only a salted hash is kept, on this Mac. It is a convenience lock for the notch, not a vault. Pure logic: no UI.
//

import Foundation
import CryptoKit

enum LockCode {
    static let minLength = 4
    static let maxLength = 8
    /// Wrong tries allowed before the code field waits.
    static let freeTries = 5

    /// Digits only, 4 to 8 of them.
    static func isValid(_ code: String) -> Bool {
        (minLength...maxLength).contains(code.count) && code.allSatisfy { $0.isASCII && $0.isNumber }
    }

    /// What the field keeps while you type: digits only, no more than 8.
    static func cleaned(_ typed: String) -> String {
        String(typed.filter { $0.isASCII && $0.isNumber }.prefix(maxLength))
    }

    static func makeSalt() -> String {
        (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    static func hash(_ code: String, salt: String) -> String {
        SHA256.hash(data: Data((salt + ":" + code).utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func matches(_ code: String, salt: String, hash expected: String) -> Bool {
        hash(code, salt: salt) == expected
    }

    /// Seconds to wait after this many wrong tries in a row: none for the first five, then 30, 60, 120 … up to 15 minutes.
    static func lockoutSeconds(failures: Int) -> Int {
        guard failures >= freeTries else { return 0 }
        return min(900, 30 << min(failures - freeTries, 5))
    }
}

/// Where the code lives: a salt and a hash in this app's preferences.
enum LockCodeStore {
    private static let saltKey = "security.code.salt"
    private static let hashKey = "security.code.hash"
    private static let failKey = "security.code.failures"
    private static let untilKey = "security.code.waitUntil"

    static var isSet: Bool { UserDefaults.standard.string(forKey: hashKey) != nil }

    /// False when the code isn't valid (see `LockCode.isValid`).
    @discardableResult
    static func set(_ code: String) -> Bool {
        guard LockCode.isValid(code) else { return false }
        let salt = LockCode.makeSalt()
        let d = UserDefaults.standard
        d.set(salt, forKey: saltKey); d.set(LockCode.hash(code, salt: salt), forKey: hashKey)
        d.removeObject(forKey: failKey); d.removeObject(forKey: untilKey)
        return true
    }

    static func clear() {
        let d = UserDefaults.standard
        for k in [saltKey, hashKey, failKey, untilKey] { d.removeObject(forKey: k) }
    }

    /// Seconds still to wait before another try (0 when you can type now).
    static func waitRemaining(now: Date = Date()) -> Int {
        let until = UserDefaults.standard.double(forKey: untilKey)
        return until > now.timeIntervalSince1970 ? Int((until - now.timeIntervalSince1970).rounded(.up)) : 0
    }

    /// True when this is the right code. Counts nothing either way: used while typing, so a half-typed code is not a wrong try.
    static func isRight(_ code: String, now: Date = Date()) -> Bool {
        let d = UserDefaults.standard
        guard waitRemaining(now: now) == 0, let salt = d.string(forKey: saltKey), let stored = d.string(forKey: hashKey) else { return false }
        return LockCode.matches(code, salt: salt, hash: stored)
    }

    /// Checks a typed code. A wrong one counts toward the wait; a right one resets it. Nothing is checked while waiting.
    static func check(_ code: String, now: Date = Date()) -> Bool {
        let d = UserDefaults.standard
        guard waitRemaining(now: now) == 0, let salt = d.string(forKey: saltKey), let stored = d.string(forKey: hashKey) else { return false }
        if LockCode.matches(code, salt: salt, hash: stored) {
            d.removeObject(forKey: failKey); d.removeObject(forKey: untilKey)
            return true
        }
        let failures = d.integer(forKey: failKey) + 1
        d.set(failures, forKey: failKey)
        let wait = LockCode.lockoutSeconds(failures: failures)
        if wait > 0 { d.set(now.timeIntervalSince1970 + Double(wait), forKey: untilKey) }
        return false
    }
}
