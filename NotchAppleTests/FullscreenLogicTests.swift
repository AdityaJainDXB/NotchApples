//
//  FullscreenLogicTests.swift
//  Notch Apple tests
//
//  Issue #102: a maximized window on a Space with an auto-hidden menu bar is not full screen.
//

import XCTest

final class FullscreenLogicTests: XCTestCase {
    private let screen = CGRect(x: 0, y: 0, width: 1512, height: 982)
    private let app: Int32 = 42
    private let wallpaper = FullscreenLogic.Window(pid: 1, layer: -2_147_483_628, bounds: CGRect(x: 0, y: 0, width: 1512, height: 982))
    private let icons = FullscreenLogic.Window(pid: 2, layer: -2_147_483_603, bounds: CGRect(x: 0, y: 0, width: 1512, height: 982))

    func testNativeFullscreenSpaceHasNoDesktop() {
        let w = FullscreenLogic.Window(pid: app, layer: 0, bounds: screen)
        XCTAssertTrue(FullscreenLogic.isFullscreen(appPID: app, screen: screen, windows: [w]))
    }

    func testMaximizedWindowWithAutoHiddenMenuBarIsNotFullscreen() {
        // Same size as the screen, but the wallpaper is on this Space: a normal desktop Space.
        let w = FullscreenLogic.Window(pid: app, layer: 0, bounds: screen)
        XCTAssertFalse(FullscreenLogic.isFullscreen(appPID: app, screen: screen, windows: [wallpaper, w]))
        XCTAssertFalse(FullscreenLogic.isFullscreen(appPID: app, screen: screen, windows: [icons, w]))
    }

    func testMaximizedBelowVisibleMenuBarIsNotFullscreen() {
        let w = FullscreenLogic.Window(pid: app, layer: 0, bounds: CGRect(x: 0, y: 37, width: 1512, height: 945))
        XCTAssertFalse(FullscreenLogic.isFullscreen(appPID: app, screen: screen, windows: [w]))
    }

    func testOtherAppsOrLayersDoNotCount() {
        XCTAssertFalse(FullscreenLogic.isFullscreen(appPID: app, screen: screen, windows: [.init(pid: 7, layer: 0, bounds: screen)]))
        XCTAssertFalse(FullscreenLogic.isFullscreen(appPID: app, screen: screen, windows: [.init(pid: app, layer: 25, bounds: screen)]))
    }

    func testDesktopOnAnotherDisplayIsIgnored() {
        let other = FullscreenLogic.Window(pid: 1, layer: -2_147_483_628, bounds: CGRect(x: 1512, y: 0, width: 1920, height: 1080))
        let w = FullscreenLogic.Window(pid: app, layer: 0, bounds: screen)
        XCTAssertTrue(FullscreenLogic.isFullscreen(appPID: app, screen: screen, windows: [other, w]))
    }
}
