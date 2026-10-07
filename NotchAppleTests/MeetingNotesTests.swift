import XCTest

final class MeetingNotesTests: XCTestCase {
    func testHeadingIsOneCleanLine() {
        XCTAssertEqual(MeetingNotesLogic.heading(title: "  Standup ", day: "Wed 7 Oct"), "Standup · Wed 7 Oct")
        XCTAssertEqual(MeetingNotesLogic.heading(title: "## Sync\nsecond line", day: "Wed 7 Oct"), "Sync · Wed 7 Oct")
        XCTAssertEqual(MeetingNotesLogic.heading(title: "", day: "Wed 7 Oct"), "Meeting · Wed 7 Oct")
        XCTAssertEqual(MeetingNotesLogic.heading(title: String(repeating: "a", count: 90), day: "d").count, 60 + 4)
    }

    func testTemplateHasTheSections() {
        let t = MeetingNotesLogic.template(title: "Standup", day: "Wed 7 Oct", time: "10:00 – 10:30")
        XCTAssertTrue(t.hasPrefix("# Standup · Wed 7 Oct\n10:00 – 10:30\n"))
        for part in ["## Agenda", "## Notes", "## Actions", "- [ ] "] { XCTAssertTrue(t.contains(part), part) }
    }

    func testFindsTheNoteAlreadyMade() {
        let made = MeetingNotesLogic.template(title: "Standup", day: "Wed 7 Oct", time: "x")
        let notes = ["Shopping list", made, "# Standup · Thu 8 Oct\n"]
        XCTAssertEqual(MeetingNotesLogic.existing(in: notes, title: "Standup", day: "Wed 7 Oct"), 1)
        XCTAssertEqual(MeetingNotesLogic.existing(in: notes, title: "Standup", day: "Thu 8 Oct"), 2)
        XCTAssertNil(MeetingNotesLogic.existing(in: notes, title: "Retro", day: "Wed 7 Oct"))
    }
}
