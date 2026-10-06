//
//  ClaudeCodeStatusTests.swift
//  Notch apple tests
//
//  The Claude Code status dot: which words give green and which give yellow, and the safe merge of the two hooks
//  into Claude Code's settings.json.
//

import XCTest

final class ClaudeCodeStatusTests: XCTestCase {
    func testDoneWordsAreGreen() {
        for w in ["done", "DONE", " success ", "ok", "complete", "completed", "finished", "passed"] {
            XCTAssertEqual(ClaudeCodeStatusLogic.dot(for: w), .green, w)
        }
    }

    func testNeedsYouOrProblemsAreYellow() {
        for w in ["attention", "input", "approval", "permission", "waiting", "warning", "error", "failed", "Fail"] {
            XCTAssertEqual(ClaudeCodeStatusLogic.dot(for: w), .yellow, w)
        }
    }

    func testUnknownOrMissingShowsNothing() {
        XCTAssertNil(ClaudeCodeStatusLogic.dot(for: nil))
        XCTAssertNil(ClaudeCodeStatusLogic.dot(for: ""))
        XCTAssertNil(ClaudeCodeStatusLogic.dot(for: "banana"))
    }

    func testTheDotShowsForFourSeconds() {
        XCTAssertEqual(ClaudeCodeStatusLogic.seconds, 4)
    }

    func testMergingAddsBothHooksToAnEmptyFile() {
        let merged = ClaudeCodeStatusLogic.merging(into: [:])
        XCTAssertTrue(ClaudeCodeStatusLogic.isInstalled(in: merged))
        let hooks = merged["hooks"] as? [String: Any]
        XCTAssertNotNil(hooks?["Stop"])
        XCTAssertNotNil(hooks?["Notification"])
    }

    func testMergingKeepsEverythingElse() {
        let existing: [String: Any] = [
            "model": "opus",
            "permissions": ["allow": ["Bash(ls)"]],
            "hooks": ["Stop": [["hooks": [["type": "command", "command": "echo mine"]]]],
                      "PreToolUse": [["matcher": "Bash", "hooks": [["type": "command", "command": "echo pre"]]]]],
        ]
        let merged = ClaudeCodeStatusLogic.merging(into: existing)
        XCTAssertEqual(merged["model"] as? String, "opus")
        XCTAssertNotNil(merged["permissions"])
        let hooks = merged["hooks"] as? [String: Any]
        XCTAssertNotNil(hooks?["PreToolUse"], "other hooks stay")
        let stop = hooks?["Stop"] as? [[String: Any]]
        XCTAssertEqual(stop?.count, 2, "the user's own Stop hook stays and ours is added beside it")
    }

    func testMergingTwiceChangesNothing() {
        let once = ClaudeCodeStatusLogic.merging(into: [:])
        let twice = ClaudeCodeStatusLogic.merging(into: once)
        let a = try? JSONSerialization.data(withJSONObject: once, options: .sortedKeys)
        let b = try? JSONSerialization.data(withJSONObject: twice, options: .sortedKeys)
        XCTAssertEqual(a, b)
    }

    func testTheSnippetIsValidJSONWithBothHooks() throws {
        let data = Data(ClaudeCodeStatusLogic.snippet().utf8)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertTrue(ClaudeCodeStatusLogic.isInstalled(in: json))
    }
}
