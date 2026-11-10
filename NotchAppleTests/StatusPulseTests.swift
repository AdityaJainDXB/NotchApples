//
//  StatusPulseTests.swift
//  Notch Apple tests
//
//  What can glow, when each source fires, and how often. Also which tab each kind of app suggests.
//

import XCTest

final class StatusPulseTests: XCTestCase {
    typealias L = StatusPulseLogic

    func testCatalogIsSound() {
        XCTAssertEqual(Set(L.sources.map(\.id)).count, L.sources.count)
        let sections = Set(L.sections.map(\.id))
        for s in L.sources { XCTAssertTrue(sections.contains(s.section), s.id) }
        for sec in L.sections { XCTAssertFalse(L.sources(in: sec.id).isEmpty, sec.id) }
    }

    func testOnlyTheAgreedSourcesStartOn() {
        XCTAssertEqual(Set(L.sources.filter(\.defaultOn).map(\.id)), ["battery", "event", "custom"])
    }

    func testSourcesThatNeedAnOutsideServiceAreMarked() {
        for id in ["rain", "alert", "price", "flight", "score"] { XCTAssertEqual(L.source(id)?.available, false, id) }
        XCTAssertEqual(L.source("battery")?.available, true)
    }

    func testBattery() {
        XCTAssertEqual(L.battery(percent: 20, pluggedIn: false)?.color, .amber)
        XCTAssertEqual(L.battery(percent: 10, pluggedIn: false)?.color, .red)
        XCTAssertNil(L.battery(percent: 21, pluggedIn: false))
        XCTAssertNil(L.battery(percent: 8, pluggedIn: true))
        XCTAssertEqual(L.battery(percent: 100, pluggedIn: true)?.color, .green)
        XCTAssertNil(L.battery(percent: 100, pluggedIn: false))
    }

    func testTriggers() {
        XCTAssertTrue(L.eventSoon(minutesUntil: 5)); XCTAssertFalse(L.eventSoon(minutesUntil: 6)); XCTAssertFalse(L.eventSoon(minutesUntil: 0))
        XCTAssertFalse(L.unlockFailed(wrongInARow: 2)); XCTAssertTrue(L.unlockFailed(wrongInARow: 3))
        XCTAssertFalse(L.breakDue(minutesWorking: 89)); XCTAssertTrue(L.breakDue(minutesWorking: 90))
        XCTAssertFalse(L.shelfIsOld(addedDaysAgo: [1, 6.9])); XCTAssertTrue(L.shelfIsOld(addedDaysAgo: [1, 7]))
    }

    func testWifi() {
        XCTAssertEqual(L.wifi(from: "online", to: "down")?.color, .red)
        XCTAssertEqual(L.wifi(from: "down", to: "online")?.color, .green)
        XCTAssertEqual(L.wifi(from: "online", to: "slow")?.color, .amber)
        XCTAssertEqual(L.wifi(from: "slow", to: "online")?.color, .green)
        XCTAssertNil(L.wifi(from: "online", to: "online"))
    }

    func testColorNames() {
        XCTAssertEqual(L.color(named: "Green"), .green)
        XCTAssertEqual(L.color(named: "orange"), .amber)
        XCTAssertEqual(L.color(named: "RED"), .red)
        XCTAssertNil(L.color(named: "purple")); XCTAssertNil(L.color(named: nil))
    }

    func testDurationAndRate() {
        XCTAssertEqual(L.duration(.green, redStays: true), 10)
        XCTAssertNil(L.duration(.red, redStays: true))
        XCTAssertEqual(L.duration(.red, redStays: false), 10)
        let now = Date()
        XCTAssertTrue(L.allowed(lastFired: nil, now: now))
        XCTAssertFalse(L.allowed(lastFired: now.addingTimeInterval(-60), now: now))
        XCTAssertTrue(L.allowed(lastFired: now.addingTimeInterval(-181), now: now))
    }

    func testQuietHours() {
        XCTAssertTrue(L.isQuiet(hour: 23, from: 22, to: 7)); XCTAssertTrue(L.isQuiet(hour: 3, from: 22, to: 7))
        XCTAssertFalse(L.isQuiet(hour: 12, from: 22, to: 7)); XCTAssertFalse(L.isQuiet(hour: 7, from: 22, to: 7))
        XCTAssertTrue(L.isQuiet(hour: 13, from: 12, to: 14)); XCTAssertFalse(L.isQuiet(hour: 5, from: 8, to: 8))
    }

    // MARK: App suggestions

    func testAppCategories() {
        typealias A = AppContextLogic
        XCTAssertEqual(A.category(forBundleID: "us.zoom.xos")?.id, "meetings")
        XCTAssertEqual(A.category(forBundleID: "com.apple.dt.Xcode")?.id, "coding")
        XCTAssertEqual(A.category(forBundleID: "com.jetbrains.intellij")?.id, "coding")
        XCTAssertEqual(A.category(forBundleID: "com.apple.Music")?.id, "music")
        XCTAssertNil(A.category(forBundleID: "com.example.unknown")); XCTAssertNil(A.category(forBundleID: nil))
        XCTAssertNil(A.category(forBundleID: "us.zoom.xos", disabled: ["meetings"]))
    }

    func testSuggestionPicksTheFirstTabThatIsOnTheBar() throws {
        let coding = try XCTUnwrap(AppContextLogic.category(forBundleID: "com.apple.dt.Xcode"))
        XCTAssertEqual(AppContextLogic.suggestedTab(for: coding, available: ["today", "claude", "claudeUsage"]), "claudeUsage")
        XCTAssertEqual(AppContextLogic.suggestedTab(for: coding, available: ["today", "claude"]), "claude")
        XCTAssertNil(AppContextLogic.suggestedTab(for: coding, available: ["today"]))
    }

    func testCategoriesHaveUniqueIdsAndTabs() {
        XCTAssertEqual(Set(AppContextLogic.categories.map(\.id)).count, AppContextLogic.categories.count)
        for c in AppContextLogic.categories { XCTAssertFalse(c.tabs.isEmpty, c.id); XCTAssertFalse(c.bundles.isEmpty && c.prefixes.isEmpty, c.id) }
    }

    // MARK: Pinned tabs

    func testPinnedTabs() {
        let all = ["home", "claude", "timer", "notes", "tools"]
        XCTAssertEqual(ModuleLayoutLogic.tabBar(all: all, pinned: [], selected: "home").bar, all)
        let split = ModuleLayoutLogic.tabBar(all: all, pinned: ["home", "claude"], selected: "notes")
        XCTAssertEqual(split.bar, ["home", "claude", "notes"])
        XCTAssertEqual(split.more, ["timer", "tools"])
        XCTAssertEqual(ModuleLayoutLogic.tabBar(all: all, pinned: ["gone"], selected: "home").bar, all)
        XCTAssertEqual(ModuleLayoutLogic.toggledPin("timer", in: ["home"]), ["home", "timer"])
        XCTAssertEqual(ModuleLayoutLogic.toggledPin("home", in: ["home", "timer"]), ["timer"])
    }

    func testDraggingATabOntoAnother() {
        let list = ["a", "b", "c", "d"]
        XCTAssertEqual(ModuleLayoutLogic.movedBefore("a", before: "c", in: list), ["b", "c", "a", "d"])
        XCTAssertEqual(ModuleLayoutLogic.movedBefore("d", before: "b", in: list), ["a", "d", "b", "c"])
        XCTAssertEqual(ModuleLayoutLogic.movedBefore("a", before: "a", in: list), list)
        XCTAssertEqual(ModuleLayoutLogic.movedBefore("x", before: "a", in: list), list)
    }
}
