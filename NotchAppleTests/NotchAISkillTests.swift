//
//  NotchAISkillTests.swift
//  Notch Apple tests
//
//  Skill files: parsing the header, matching the app in front, and how matching skills reach the model.
//

import XCTest

final class NotchAISkillTests: XCTestCase {
    typealias L = NotchAISkillLogic
    private let xcodeSkill = """
    ---
    name: Xcode helper
    description: Swift errors my way
    apps: com.apple.dt.Xcode, COM.apple.dt.Xcode.preview
    ---
    Explain compiler errors step by step.

    Show the smallest fix.
    """

    func testHeaderAndBodyAreParsed() {
        let s = L.parse(xcodeSkill, fileName: "xcode.md")!
        XCTAssertEqual(s.name, "Xcode helper")
        XCTAssertEqual(s.description, "Swift errors my way")
        XCTAssertEqual(s.apps, ["com.apple.dt.xcode", "com.apple.dt.xcode.preview"])
        XCTAssertTrue(s.instructions.hasPrefix("Explain compiler errors"))
        XCTAssertTrue(s.instructions.contains("smallest fix"))
        XCTAssertFalse(s.instructions.contains("---"))
    }

    func testAFileWithoutAHeaderIsAnEverywhereSkillNamedAfterTheFile() {
        let s = L.parse("Always answer in British English.", fileName: "english.md")!
        XCTAssertEqual(s.name, "english")
        XCTAssertTrue(s.apps.isEmpty)
        XCTAssertTrue(L.applies(s, bundleID: "any.app"))
        XCTAssertTrue(L.applies(s, bundleID: nil))
    }

    func testEmptyInstructionsAreNotASkill() {
        XCTAssertNil(L.parse("---\nname: Empty\n---\n   \n", fileName: "e.md"))
        XCTAssertNil(L.parse("", fileName: "e.md"))
    }

    func testMatchingIsByAppAndCaseInsensitive() {
        let s = L.parse(xcodeSkill, fileName: "x.md")!
        XCTAssertTrue(L.applies(s, bundleID: "com.apple.dt.Xcode"))
        XCTAssertFalse(L.applies(s, bundleID: "com.apple.Safari"))
        XCTAssertFalse(L.applies(s, bundleID: nil))
    }

    func testADisabledSkillNeverApplies() {
        var s = L.parse("Always be brief.", fileName: "b.md")!
        s.enabled = false
        XCTAssertFalse(L.applies(s, bundleID: "x"))
    }

    func testPromptOnlyChangesWhenASkillApplies() {
        let s = L.parse(xcodeSkill, fileName: "x.md")!
        XCTAssertEqual(L.systemPrompt(base: "BASE", skills: [s], bundleID: "com.apple.Safari"), "BASE")
        let p = L.systemPrompt(base: "BASE", skills: [s], bundleID: "com.apple.dt.Xcode")
        XCTAssertTrue(p.hasPrefix("BASE"))
        XCTAssertTrue(p.contains("## Xcode helper"))
        XCTAssertTrue(p.contains("smallest fix"))
    }

    func testVeryLongInstructionsAreCapped() {
        let s = L.parse(String(repeating: "x", count: 10_000), fileName: "big.md")!
        XCTAssertEqual(s.instructions.count, L.maxInstructionLength)
    }
}
