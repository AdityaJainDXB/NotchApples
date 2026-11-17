//
//  FullscreenLogic.swift
//  Notch Apple
//
//  Pure check behind FullscreenWatcher (issue #102). A window the size of the whole screen is not
//  enough: on a Space whose menu bar auto-hides, a merely maximized (zoomed) window covers the
//  menu bar area too. A native full-screen Space has no desktop/wallpaper window on it, so the
//  window must fill the screen AND the screen must show no desktop window.
//

import CoreGraphics

enum FullscreenLogic {
    /// One on-screen window from CGWindowListCopyWindowInfo, in CG (top-left) coordinates.
    struct Window: Equatable {
        var pid: Int32
        var layer: Int
        var bounds: CGRect
    }

    /// Lowest CG window levels used by the wallpaper and Finder's desktop icons.
    /// Anything below the normal level (0) by this much is a desktop element.
    static let desktopLayerCeiling = -2_147_483_000

    static func fills(_ r: CGRect, _ screen: CGRect, tolerance: CGFloat = 2) -> Bool {
        abs(r.minX - screen.minX) < tolerance && abs(r.minY - screen.minY) < tolerance
            && abs(r.width - screen.width) < tolerance && abs(r.height - screen.height) < tolerance
    }

    /// True when the app `pid` has a normal-level window covering `screen` and the Space on that
    /// screen shows no desktop element (wallpaper / desktop icons), i.e. it is a native full-screen Space.
    static func isFullscreen(appPID: Int32, screen: CGRect, windows: [Window]) -> Bool {
        let covers = windows.contains { $0.pid == appPID && $0.layer == 0 && fills($0.bounds, screen) }
        guard covers else { return false }
        let desktopShown = windows.contains { $0.layer < desktopLayerCeiling && $0.bounds.intersects(screen) }
        return !desktopShown
    }
}
