//
//  TodoLogicTests.swift
//  Notch apple tests
//
//  The To-Do list's order and how a typed line becomes a task.
//

import XCTest

final class TodoLogicTests: XCTestCase {
    private func item(_ t: String, _ p: TodoPriority, done: Bool = false, due: Date? = nil, at: TimeInterval = 0) -> TodoItem {
        TodoItem(text: t, done: done, created: Date(timeIntervalSince1970: 1000 + at), priority: p, due: due)
    }

    func testHighPriorityIsPinnedToTheTopByDefault() {
        let list = [item("low", .low, at: 0), item("high", .high, at: 1), item("med", .medium, at: 2), item("high2", .high, at: 3)]
        XCTAssertEqual(TodoLogic.ordered(list, byPriority: true).map(\.text), ["high2", "high", "med", "low"], "newest first within a priority")
    }

    func testWithSortingOffTheListIsNewestFirst() {
        let list = [item("low", .low, at: 0), item("high", .high, at: 1), item("med", .medium, at: 2)]
        XCTAssertEqual(TodoLogic.ordered(list, byPriority: false).map(\.text), ["med", "high", "low"])
    }

    func testDoneTasksSinkToTheBottomWhateverTheirPriority() {
        let list = [item("done high", .high, done: true, at: 0), item("open low", .low, at: 1)]
        XCTAssertEqual(TodoLogic.ordered(list, byPriority: true).map(\.text), ["open low", "done high"])
    }

    func testSoonestDueWinsWithinAPriority() {
        let soon = Date(timeIntervalSince1970: 5000), later = Date(timeIntervalSince1970: 9000)
        let list = [item("none", .high, at: 0), item("later", .high, due: later, at: 1), item("soon", .high, due: soon, at: 2)]
        XCTAssertEqual(TodoLogic.ordered(list, byPriority: true).map(\.text), ["soon", "later", "none"])
    }

    func testOldSavedListsStillLoad() throws {
        let old = Data(#"[{"id":"0E8F6F7A-1B1F-4F6B-9E4C-6C1C3F0B2A11","text":"Call mum","done":false,"created":790000000}]"#.utf8)
        let items = try JSONDecoder().decode([TodoItem].self, from: old)
        XCTAssertEqual(items.first?.text, "Call mum")
        XCTAssertEqual(items.first?.priority, .medium)
        XCTAssertNil(items.first?.due)
        // And a new one survives a round trip.
        let item = TodoItem(text: "x", priority: .high, due: Date(timeIntervalSince1970: 1_800_000_000))
        let back = try JSONDecoder().decode([TodoItem].self, from: JSONEncoder().encode([item]))
        XCTAssertEqual(back.first?.priority, .high)
        XCTAssertEqual(back.first?.due, item.due)
    }

    func testPriorityMarksAreRead() {
        XCTAssertEqual(TodoLogic.parse("Buy milk !!!")?.priority, .high)
        XCTAssertEqual(TodoLogic.parse("Buy milk !!!")?.title, "Buy milk")
        XCTAssertEqual(TodoLogic.parse("!! Email Sam")?.priority, .medium)
        XCTAssertEqual(TodoLogic.parse("Water plants !")?.priority, .low)
        XCTAssertEqual(TodoLogic.parse("high: Pay rent")?.priority, .high)
        XCTAssertEqual(TodoLogic.parse("high: Pay rent")?.title, "Pay rent")
        XCTAssertNil(TodoLogic.parse("Plain task")?.priority)
    }

    func testADateInPlainWordsBecomesTheDueDate() {
        let p = TodoLogic.parse("Call mum tomorrow 3pm !!!")
        XCTAssertEqual(p?.title, "Call mum")
        XCTAssertEqual(p?.priority, .high)
        XCTAssertNotNil(p?.due)
    }

    func testAJustADateIsNotATask() {
        XCTAssertNil(TodoLogic.parse("tomorrow")?.due, "nothing left to be the task, so no due date is taken")
        XCTAssertNil(TodoLogic.parse("   "))
        XCTAssertNil(TodoLogic.parse("!!!"))
    }

    func testLabelsAndOverdue() {
        let now = Date(timeIntervalSince1970: 1_760_000_000)
        let cal = Calendar(identifier: .gregorian)
        XCTAssertTrue(TodoLogic.dueLabel(now, now: now, calendar: cal).hasPrefix("Today"))
        XCTAssertTrue(TodoLogic.dueLabel(now.addingTimeInterval(86_400), now: now, calendar: cal).hasPrefix("Tomorrow"))
        XCTAssertTrue(TodoLogic.isOverdue(item("x", .low, due: now.addingTimeInterval(-60)), now: now))
        XCTAssertFalse(TodoLogic.isOverdue(item("x", .low, done: true, due: now.addingTimeInterval(-60)), now: now))
    }
}
