//
//  SettingsSearchTests.swift
//  Notch Apple tests
//
//  Issue #100: Settings search found features it then had no enable switch for (Utilities members
//  like World Clock, Stats, Shelf, Cache Cleaner, Convert and Launcher never get their own toggle).
//

import XCTest

final class SettingsSearchTests: XCTestCase {
    func testMatchingExcludesUtilitiesMembers() {
        for module in SettingsManager.utilitiesMembers {
            XCTAssertTrue(Module.matching(module.title).isEmpty, "\(module) has no enable switch of its own and should not surface as a search result")
        }
    }

    func testMatchingStillFindsOrdinaryFeatures() {
        XCTAssertTrue(Module.matching("messenger").contains(.messenger))
        XCTAssertTrue(Module.matching("claude").contains(.claude))
    }

    func testMatchingExcludesTranslatorAndNonNecessities() {
        XCTAssertFalse(Module.matching("translator").contains(.translator))
        XCTAssertFalse(Module.matching(Module.nonNecessities.title).contains(.nonNecessities))
    }
}
