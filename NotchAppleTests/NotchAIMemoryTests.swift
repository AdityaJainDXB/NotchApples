//
//  NotchAIMemoryTests.swift
//  Notch Apple tests
//
//  What memory accepts (no secrets, no duplicates, bounded) and how it reaches the model.
//

import XCTest

final class NotchAIMemoryTests: XCTestCase {
    typealias L = NotchAIMemoryLogic
    private func item(_ t: String, _ k: MemoryItem.Kind = .preference, on: Bool = true) -> MemoryItem { MemoryItem(kind: k, text: t, enabled: on) }

    func testNormalTextIsAccepted() {
        XCTAssertEqual(try? L.validate("  I prefer short answers  ", existing: []).get(), "I prefer short answers")
    }

    func testEmptyTooLongDuplicateAndFull() {
        XCTAssertEqual(L.validate("   ", existing: []), .failure(.empty))
        XCTAssertEqual(L.validate(String(repeating: "a", count: 300), existing: []), .failure(.tooLong))
        XCTAssertEqual(L.validate("USE swift", existing: [item("use Swift")]), .failure(.duplicate))
        XCTAssertEqual(L.validate("new", existing: (0..<100).map { item("x\($0)") }), .failure(.tooMany))
    }

    func testSecretsAreRefused() {
        for secret in ["my key is sk-abcdefghijklmnopqrstuvwx", "AIzaSyA1234567890abcdefghijklmnop", "ghp_abcdefghijklmnopqrstuvwxyz0123",
                       "card 4111 1111 1111 1111", "my password is hunter2", "token: abc123", "api_key = zzz",
                       "0123456789abcdef0123456789abcdef", "-----BEGIN RSA PRIVATE KEY-----"] {
            XCTAssertEqual(L.validate(secret, existing: []), .failure(.sensitive), secret)
        }
    }

    func testOrdinaryTextWithNumbersIsNotMistakenForASecret() {
        for ok in ["I live in Dubai and was born in 2009", "Call me Aditya", "My project is called Notch Apple 2.2.60", "pin the notch to the top"] {
            XCTAssertNotNil(try? L.validate(ok, existing: []).get(), ok)
        }
    }

    func testPromptIsJustTheBaseWhenMemoryIsOffOrEmpty() {
        XCTAssertEqual(L.systemPrompt(base: "BASE", items: [item("a")], style: .concise, useMemory: false), "BASE")
        XCTAssertEqual(L.systemPrompt(base: "BASE", items: [], style: .none, useMemory: true), "BASE")
    }

    func testPromptIncludesStyleAndOnlyEnabledItems() {
        let p = L.systemPrompt(base: "BASE", items: [item("likes Swift", .fact), item("hidden", on: false), item("short answers")], style: .concise, useMemory: true)
        XCTAssertTrue(p.hasPrefix("BASE"))
        XCTAssertTrue(p.contains("Keep answers short"))
        XCTAssertTrue(p.contains("- [About me] likes Swift"))
        XCTAssertTrue(p.contains("- [Preference] short answers"))
        XCTAssertFalse(p.contains("hidden"))
    }

    func testStyleNoneAddsNothing() {
        XCTAssertNil(ResponseStyle.none.instruction)
        for s in ResponseStyle.allCases where s != .none { XCTAssertNotNil(s.instruction) }
    }

    func testItemsSurviveEncoding() throws {
        let a = [item("one", .project), item("two", on: false)]
        let back = try JSONDecoder().decode([MemoryItem].self, from: JSONEncoder().encode(a))
        XCTAssertEqual(back, a)
    }
}
