//
//  TabChoicesTests.swift
//  Notch Apple tests
//
//  The update choice screen: the owner's labels, the starting state of each row, grouping, and writing only real changes.
//

import XCTest

final class TabChoicesTests: XCTestCase {
    private typealias L = TabChoicesLogic

    func testTheOwnersLabelsAreAllThere() {
        XCTAssertEqual(L.labels.values.filter { $0 == .recommended }.count, 18)
        XCTAssertEqual(L.labels.values.filter { $0 == .notRecommended }.count, 2)
        XCTAssertEqual(L.labels.values.filter { $0 == .fewUse }.count, 9)
        XCTAssertEqual(L.labels["doIt"], .recommended)
        XCTAssertEqual(L.labels["share"], .notRecommended)
        XCTAssertEqual(L.labels["bambu"], .fewUse)
        XCTAssertNil(L.labels["clipboard"])            // lives on Home: never listed
        XCTAssertNil(L.labels["stats"])                // lives inside Utilities
        XCTAssertNil(L.labels["focus"])                // lives inside Non-Necessities
    }

    func testRowsStartAsTheLabelSays() {
        XCTAssertTrue(L.startsOn(pick: .recommended, currentlyOn: false, entitled: true))
        XCTAssertFalse(L.startsOn(pick: .notRecommended, currentlyOn: true, entitled: true))
        XCTAssertTrue(L.startsOn(pick: .fewUse, currentlyOn: true, entitled: true))     // kept as it is
        XCTAssertFalse(L.startsOn(pick: .fewUse, currentlyOn: false, entitled: true))
    }

    func testARecommendedTabTheirPlanLacksIsLeftAsItIs() {
        XCTAssertFalse(L.startsOn(pick: .recommended, currentlyOn: false, entitled: false))    // no locked upgrade tab appears
        XCTAssertTrue(L.startsOn(pick: .recommended, currentlyOn: true, entitled: false))
    }

    func testGroupsComeInOrderAndSkipUnlabelledModules() {
        let g = L.groups(available: ["share", "clipboard", "today", "bambu", "tools", "focus", "windows"])
        XCTAssertEqual(g.map(\.pick), [.recommended, .notRecommended, .fewUse])
        XCTAssertEqual(g[0].modules, ["today", "tools"])
        XCTAssertEqual(g[1].modules, ["share"])
        XCTAssertEqual(g[2].modules, ["bambu", "windows"])
        XCTAssertTrue(L.groups(available: ["clipboard", "focus"]).isEmpty)
    }

    func testOnlyRealChangesAreWrittenAndUnlabelledOnesNever() {
        let selection = ["today": true, "share": false, "windows": true, "clipboard": false, "nonNecessities": false, "games": true]
        let current = ["today": true, "share": true, "windows": true, "clipboard": true, "nonNecessities": true, "games": false]
        XCTAssertEqual(L.changes(selection: selection, current: current), ["share": false, "games": true])
    }

    func testTheSummaryCountsWhatWillChange() {
        XCTAssertEqual(L.summary(selection: ["share": false], current: ["share": false]), "Nothing will change.")
        XCTAssertEqual(L.summary(selection: ["share": false, "games": true, "mirror": true], current: ["share": true, "games": false, "mirror": false]), "2 will be switched on, 1 will be switched off.")
        XCTAssertEqual(L.summary(selection: ["games": true], current: ["games": false]), "1 will be switched on.")
    }

    func testEveryPickHasWords() {
        for p in TabPick.allCases { XCTAssertFalse(p.title.isEmpty); XCTAssertFalse(p.detail.isEmpty) }
    }
}
