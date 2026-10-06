//
//  SecretLogicTests.swift
//  Notch apple tests
//
//  What counts as "looks like a secret" for the clipboard's Protect secrets option. The Windows app runs the same
//  cases against services/secrets.js. Every key below is made up for the test.
//

import XCTest

final class SecretLogicTests: XCTestCase {
    func testSecretsAreSpotted() {
        let secrets = [
            "sk-proj-abcdefghijklmnopqrstuvwx",
            "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
            "AKIAIOSFODNN7EXAMPLE",
            "xoxb-123456789012-abcdefABCDEF",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
            "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----",
            "483920",
            "4111 1111 1111 1111",
            "4111-1111-1111-1111",
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        ]
        for s in secrets { XCTAssertTrue(SecretLogic.looksSecret(s), s) }
    }

    func testOrdinaryTextIsNotASecret() {
        let plain = [
            "Meeting moved to 3:30, same room.",
            "https://github.com/AdityaJainDXB/NotchApples",
            "brew install --cask notch-apple",
            "12345",                       // too short for a code
            "1234567",                     // not 6, not a card
            "4111 1111 1111 1112",         // fails the Luhn check
            "thisisjustaverylongwordwithnodigitsatallandnothingelse",
            "2026-10-06",
            "",
            "   ",
        ]
        for s in plain { XCTAssertFalse(SecretLogic.looksSecret(s), s) }
    }

    func testSurroundingWhitespaceDoesNotHideASecret() {
        XCTAssertTrue(SecretLogic.looksSecret("  483920\n"))
        XCTAssertTrue(SecretLogic.looksSecret("\tsk-proj-abcdefghijklmnopqrstuvwx "))
    }

    func testCardNumbersNeedLuhn() {
        XCTAssertTrue(SecretLogic.isCardNumber("5500 0000 0000 0004"))
        XCTAssertTrue(SecretLogic.isCardNumber("378282246310005"))
        XCTAssertFalse(SecretLogic.isCardNumber("5500 0000 0000 0005"))
        XCTAssertFalse(SecretLogic.isCardNumber("123"))
    }

    func testHugeTextIsLeftAlone() {
        XCTAssertFalse(SecretLogic.looksSecret(String(repeating: "a1", count: 5_000)))
    }
}
