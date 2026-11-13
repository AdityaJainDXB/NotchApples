//
//  ReportLogicTests.swift
//  Notch Apple tests
//
//  The report becomes a GitHub issue that names the platform, the version and the plan.
//

import XCTest

final class ReportLogicTests: XCTestCase {
    private typealias L = ReportLogic

    func testTitleNamesPlatformPlanAndKind() {
        XCTAssertEqual(L.title(kind: .bug, platform: "Mac", tier: "Pro", text: "Notch closes when I click\nmore lines"), "[Mac][Pro] Bug: Notch closes when I click")
        XCTAssertEqual(L.title(kind: .idea, platform: "Windows", tier: "Free", text: ""), "[Windows][Free] Idea: (no summary)")
        let long = L.title(kind: .question, platform: "Mac", tier: "Ultimate", text: String(repeating: "x", count: 200))
        XCTAssertTrue(long.hasSuffix("…"))
        XCTAssertLessThan(long.count, 110)
    }

    func testLabelsMapToTheRepositorysOwn() {
        XCTAssertEqual(L.labels(kind: .bug, platform: "Mac"), "bug,mac")
        XCTAssertEqual(L.labels(kind: .idea, platform: "Windows"), "enhancement,windows")
        XCTAssertEqual(L.labels(kind: .question, platform: "Mac"), "question,mac")
    }

    func testTheBodyCarriesTheInstallInfoAndNothingPersonal() {
        let b = L.body(description: "It crashed", environment: L.environment(platform: "Windows", version: "2.2.61", tier: "Ultimate", system: "Windows 11"))
        XCTAssertTrue(b.contains("**Details**\nIt crashed"))
        XCTAssertTrue(b.contains("- Platform: Windows"))
        XCTAssertTrue(b.contains("- Notch Apple version: 2.2.61"))
        XCTAssertTrue(b.contains("- Plan: Ultimate"))
        XCTAssertTrue(b.contains("- System: Windows 11"))
        XCTAssertTrue(L.body(description: "  ", environment: []).contains("(nothing written)"))
    }

    func testVeryLongTextIsCutSoTheAddressStaysUsable() {
        let url = L.issueURL(kind: .bug, platform: "Mac", version: "2.2.61", tier: "Pro", system: "macOS 15", description: String(repeating: "word ", count: 5_000))!
        XCTAssertLessThan(url.absoluteString.count, 12_000)
        XCTAssertTrue(L.body(description: String(repeating: "a", count: 9_000), environment: []).contains("(cut: it was very long)"))
    }

    func testTheIssueAddressIsTheProjectsAndEncodesTheText() throws {
        let url = L.issueURL(kind: .bug, platform: "Mac", version: "2.2.61", tier: "Free", system: "macOS 15", description: "a & b? #1")!
        XCTAssertEqual(url.host, "github.com")
        XCTAssertEqual(url.path, "/AdityaJainDXB/NotchApples/issues/new")
        let q = Dictionary(uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(q["labels"], "bug,mac")
        XCTAssertTrue(q["body"]!.contains("a & b? #1"))
        XCTAssertTrue(q["title"]!.hasPrefix("[Mac][Free] Bug:"))
    }

    func testReadyNeedsAFewWords() {
        XCTAssertFalse(L.isReady("   short "))
        XCTAssertTrue(L.isReady("The notch closes when I click"))
    }
}
