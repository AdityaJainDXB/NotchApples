//
//  ReleaseNotesLogicTests.swift
//  Notch apple tests
//
//  What the update screen shows of the release notes.
//

import XCTest

final class ReleaseNotesLogicTests: XCTestCase {
    func testTheChangesStayAndTheBoilerplateGoes() {
        let notes = """
        **Fixed**
        - 🔑 Connect works.

        **Updates**
        Notch apple tells you when a release like this one is out.

        Install: download the DMG below.
        """
        XCTAssertEqual(ReleaseNotesLogic.whatsInside(notes), "**Fixed**\n- 🔑 Connect works.")
    }

    func testMarkersAreNeverShown() {
        let notes = "[required-update]\n[security] Fixes a flaw.\n\n**New**\n- A thing."
        XCTAssertEqual(ReleaseNotesLogic.whatsInside(notes), "**New**\n- A thing.")
    }

    func testBlankRunsAreTidied() {
        XCTAssertEqual(ReleaseNotesLogic.whatsInside("\n\n- a\n\n\n\n- b\n\n"), "- a\n\n- b")
        XCTAssertEqual(ReleaseNotesLogic.whatsInside(""), "")
    }
}
