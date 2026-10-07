//
//  ModuleLayoutTests.swift
//  Notch apple tests
//
//  Where the reorganised features go, and what the choices allow.
//

import XCTest

final class ModuleLayoutTests: XCTestCase {
    func testEveryNonNecessityIsManagedAndHasNoHomeOption() {
        for m in ["focus", "worldClock", "audio", "snippets", "shortcuts", "timer", "plugins", "voiceNotes", "screenTime", "smartHome"] {
            XCTAssertTrue(ModuleLayoutLogic.isManaged(m), m)
            XCTAssertEqual(ModuleLayoutLogic.allowed(m), [.standalone, .nonNecessities, .disabled], m)
        }
    }

    func testHomeFeaturesOfferAllFiveChoices() {
        for m in ["clipboard", "nowPlaying", "notes", "devices", "alerts", "quickAdd", "claudeUsage"] {
            XCTAssertEqual(ModuleLayoutLogic.allowed(m).count, 5, m)
            XCTAssertTrue(ModuleLayoutLogic.allowed(m).contains(.homeHidden), m)
        }
    }

    func testDefaults() {
        XCTAssertEqual(ModuleLayoutLogic.defaultChoice("clipboard", wasOn: true), .homeHidden)
        XCTAssertEqual(ModuleLayoutLogic.defaultChoice("clipboard", wasOn: false), .disabled)
        XCTAssertEqual(ModuleLayoutLogic.defaultChoice("timer", wasOn: true), .nonNecessities)
        XCTAssertEqual(ModuleLayoutLogic.defaultChoice("timer", wasOn: false), .disabled)
        XCTAssertEqual(ModuleLayoutLogic.defaultChoice("devices", wasOn: false), .homeExpanded)
        XCTAssertEqual(ModuleLayoutLogic.defaultChoice("claudeUsage", wasOn: false), .disabled)
    }

    func testTheSavedChoiceWinsWhileTheModuleIsOn() {
        XCTAssertEqual(ModuleLayoutLogic.effective("timer", saved: .standalone, isOn: true), .standalone)
        XCTAssertEqual(ModuleLayoutLogic.effective("clipboard", saved: .homeExpanded, isOn: true), .homeExpanded)
    }

    func testSwitchedOffAlwaysMeansDisabled() {
        XCTAssertEqual(ModuleLayoutLogic.effective("timer", saved: .standalone, isOn: false), .disabled)
    }

    func testSwitchingAnOldToggleOnPutsItInItsDefaultPlace() {
        XCTAssertEqual(ModuleLayoutLogic.effective("timer", saved: .disabled, isOn: true), .nonNecessities)
        XCTAssertEqual(ModuleLayoutLogic.effective("notes", saved: nil, isOn: true), .homeHidden)
    }

    func testNativeHomeCardsStayEvenIfTheirOwnSwitchWasNeverOn() {
        XCTAssertEqual(ModuleLayoutLogic.effective("devices", saved: .homeExpanded, isOn: false), .homeExpanded)
        XCTAssertEqual(ModuleLayoutLogic.effective("devices", saved: nil, isOn: false), .homeExpanded)
        XCTAssertEqual(ModuleLayoutLogic.effective("devices", saved: .disabled, isOn: false), .disabled)
        // Claude usage is opt-in.
        XCTAssertEqual(ModuleLayoutLogic.effective("claudeUsage", saved: .homeExpanded, isOn: false), .disabled)
    }

    func testAChoiceTheModuleCannotHaveFallsBack() {
        // Timer has no Home widget.
        XCTAssertEqual(ModuleLayoutLogic.effective("timer", saved: .homeExpanded, isOn: true), .nonNecessities)
    }

    func testOtherModulesAreUnaffected() {
        XCTAssertEqual(ModuleLayoutLogic.effective("claude", saved: nil, isOn: true), .standalone)
        XCTAssertEqual(ModuleLayoutLogic.effective("claude", saved: nil, isOn: false), .disabled)
    }

    func testOnlyStandaloneShowsATab() {
        for c in LayoutChoice.allCases { XCTAssertEqual(ModuleLayoutLogic.showsAsTab(c), c == .standalone) }
        XCTAssertTrue(ModuleLayoutLogic.nonNecessitiesTabNeeded(["timer": .nonNecessities, "notes": .homeHidden]))
        XCTAssertFalse(ModuleLayoutLogic.nonNecessitiesTabNeeded(["timer": .standalone]))
    }

    func testHomeStyleDefaultsToClassicAndFallsBackWhenEmpty() {
        typealias L = ModuleLayoutLogic
        XCTAssertEqual(L.effectiveStyle(saved: nil, onHomeCount: 5), .classic)
        XCTAssertEqual(L.effectiveStyle(saved: .classic, onHomeCount: 5), .classic)
        XCTAssertEqual(L.effectiveStyle(saved: .widgets, onHomeCount: 3), .widgets)
        XCTAssertEqual(L.effectiveStyle(saved: .widgets, onHomeCount: 0), .classic)
        XCTAssertEqual(L.effectiveStyle(saved: nil, fallback: .widgets, onHomeCount: 4), .widgets)
        XCTAssertEqual(L.effectiveStyle(saved: .classic, fallback: .widgets, onHomeCount: 4), .classic)
    }

    func testHomeOrderKeepsSavedOrderThenDefaults() {
        let names = ["devices", "alerts", "quickAdd", "claudeUsage"]
        XCTAssertEqual(ModuleLayoutLogic.ordered(names, by: []), names)
        XCTAssertEqual(ModuleLayoutLogic.ordered(names, by: ["quickAdd", "devices"]), ["quickAdd", "devices", "alerts", "claudeUsage"])
        // Unknown names in the saved order are ignored.
        XCTAssertEqual(ModuleLayoutLogic.ordered(names, by: ["gone", "alerts"]), ["alerts", "devices", "quickAdd", "claudeUsage"])
    }

    func testMovingWithinHomeStopsAtTheEnds() {
        let cur = ["a", "b", "c"]
        XCTAssertEqual(ModuleLayoutLogic.moved("b", by: -1, in: cur), ["b", "a", "c"])
        XCTAssertEqual(ModuleLayoutLogic.moved("c", by: 1, in: cur), cur)
        XCTAssertEqual(ModuleLayoutLogic.moved("a", by: -1, in: cur), cur)
        XCTAssertEqual(ModuleLayoutLogic.moved("zzz", by: 1, in: cur), cur)
    }
}
