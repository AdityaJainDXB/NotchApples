//
//  DesktopWidgetTests.swift
//  Notch Apple tests
//

import CoreGraphics
import XCTest

final class DesktopWidgetTests: XCTestCase {
    private let screen = CGRect(x: 0, y: 0, width: 1440, height: 860)

    func testFirstWidgetsStackDownTheRightEdge() {
        let sizes = [CGSize(width: 190, height: 96), CGSize(width: 240, height: 170)]
        let a = DesktopWidgetLogic.defaultOrigin(index: 0, sizes: sizes, in: screen)
        let b = DesktopWidgetLogic.defaultOrigin(index: 1, sizes: sizes, in: screen)
        XCTAssertEqual(a, CGPoint(x: 1440 - 190 - 24, y: 860 - 24 - 96))
        XCTAssertEqual(b.x, 1440 - 240 - 24)
        XCTAssertEqual(b.y, a.y - 14 - 170, "the second sits below the first with a gap")
    }

    func testASavedPositionOnAScreenIsKept() {
        XCTAssertEqual(DesktopWidgetLogic.onScreen(origin: CGPoint(x: 300, y: 300), size: CGSize(width: 200, height: 100), screens: [screen]), CGPoint(x: 300, y: 300))
        XCTAssertEqual(DesktopWidgetLogic.onScreen(origin: CGPoint(x: 5, y: 5), size: CGSize(width: 200, height: 100), screens: []), CGPoint(x: 5, y: 5))
    }

    func testAWidgetOnAnUnpluggedScreenComesBack() {
        let size = CGSize(width: 200, height: 100)
        let p = DesktopWidgetLogic.onScreen(origin: CGPoint(x: 2800, y: 400), size: size, screens: [screen])
        XCTAssertTrue(screen.contains(CGRect(origin: p, size: size)), "pulled onto the remaining screen: \(p)")
        let q = DesktopWidgetLogic.onScreen(origin: CGPoint(x: -900, y: -500), size: size, screens: [screen])
        XCTAssertTrue(screen.contains(CGRect(origin: q, size: size)))
        let two = [screen, CGRect(x: 1440, y: 0, width: 1920, height: 1080)]
        XCTAssertEqual(DesktopWidgetLogic.onScreen(origin: CGPoint(x: 2000, y: 300), size: size, screens: two), CGPoint(x: 2000, y: 300), "a second screen counts")
    }

    func testTodoLinesShowOpenTasksAndCountTheRest() {
        let items = (1...8).map { TodoItem(text: "t\($0)", done: $0 == 2) }
        let r = DesktopWidgetLogic.todoLines(items, limit: 5)
        XCTAssertEqual(r.shown.map(\.text), ["t1", "t3", "t4", "t5", "t6"])
        XCTAssertEqual(r.more, 2)
        XCTAssertTrue(DesktopWidgetLogic.todoLines([TodoItem(text: "x", done: true)]).shown.isEmpty)
    }

    func testNowPlayingWords() {
        XCTAssertEqual(DesktopWidgetLogic.nowPlayingText(title: nil, artist: nil, isPlaying: false).line1, "Nothing playing")
        XCTAssertEqual(DesktopWidgetLogic.nowPlayingText(title: "  ", artist: "A", isPlaying: true).line1, "Nothing playing")
        XCTAssertEqual(DesktopWidgetLogic.nowPlayingText(title: "Song", artist: "Band", isPlaying: true).line2, "Band")
        XCTAssertEqual(DesktopWidgetLogic.nowPlayingText(title: "Song", artist: "Band", isPlaying: false).line2, "Band · paused")
        XCTAssertEqual(DesktopWidgetLogic.nowPlayingText(title: "Song", artist: nil, isPlaying: false).line2, "Paused")
    }

    func testOnlySwitchedOnWidgetsInFixedOrder() {
        XCTAssertEqual(DesktopWidgetLogic.enabled(["nowPlaying", "clock", "bogus"]), [.clock, .nowPlaying])
        XCTAssertTrue(DesktopWidgetLogic.enabled([]).isEmpty)
        XCTAssertEqual(Feature.desktopWidgets.tier, .ultimate)
    }
}
