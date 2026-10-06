//
//  FoldCapture.swift
//  Notch apple, Lid Fold
//
//  Origin:  Still, native/Sources/Still/ScreenCapture.swift
//           (MIT, Copyright (c) 2026 Akshay Sharma and Kavish Shah; LICENSES/Still-MIT.txt)
//  Changes: MODIFIED. Uses the app's existing `ScreenPermission` instead of its own prompt code; takes
//           one still snapshot per display (never video or audio) and excludes this app's own windows,
//           so the notch is never part of the picture; renamed; adds `backdrop`, a generated picture
//           used by Preview when Screen Recording is not granted (limited mode, nothing is captured).
//

import AppKit
import ScreenCaptureKit

enum FoldCaptureIssue: LocalizedError {
    case permission, noDisplay
    var errorDescription: String? {
        switch self {
        case .permission: return "Screen Recording is not allowed for Notch apple."
        case .noDisplay: return "A display is no longer available."
        }
    }
}

/// One captured display, paired with the screen it came from.
struct FoldShot {
    let screen: NSScreen
    let image: CGImage
}

@MainActor
enum FoldCapture {
    private static func displayID(of screen: NSScreen) -> CGDirectDisplayID? {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
    }

    private static func configuration(for display: SCDisplay) -> SCStreamConfiguration {
        let config = SCStreamConfiguration()
        let pixelWidth = Double(CGDisplayPixelsWide(display.displayID))
        let pixelHeight = Double(CGDisplayPixelsHigh(display.displayID))
        // Capped, so a 6K display does not make a huge texture.
        let scale = min(1, 1800 / max(pixelWidth, 1))
        config.width = max(1, Int(pixelWidth * scale))
        config.height = max(1, Int(pixelHeight * scale))
        config.showsCursor = false
        config.capturesAudio = false
        config.pixelFormat = kCVPixelFormatType_32BGRA
        return config
    }

    /// One snapshot of every attached display. Throws if Screen Recording is not granted.
    static func snapshotAll() async throws -> [FoldShot] {
        guard ScreenPermission.isGranted else { throw FoldCaptureIssue.permission }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        try Task.checkCancellation()
        let ownApps = content.applications.filter { $0.bundleIdentifier == Bundle.main.bundleIdentifier }
        var shots: [FoldShot] = []
        for screen in NSScreen.screens {
            guard let wanted = displayID(of: screen),
                  let display = content.displays.first(where: { $0.displayID == wanted }) else { continue }
            let filter = SCContentFilter(display: display, excludingApplications: ownApps, exceptingWindows: [])
            let picture = try await SCScreenshotManager.captureImage(contentFilter: filter,
                                                                    configuration: configuration(for: display))
            try Task.checkCancellation()
            shots.append(FoldShot(screen: screen, image: picture))
        }
        guard !shots.isEmpty else { throw FoldCaptureIssue.noDisplay }
        return shots
    }

    /// A stand-in picture for each display, used when there is no permission to capture.
    static func backdrops() -> [FoldShot] {
        NSScreen.screens.compactMap { screen in
            backdrop(size: screen.frame.size).map { FoldShot(screen: screen, image: $0) }
        }
    }

    private static func backdrop(size: CGSize) -> CGImage? {
        let w = max(2, Int(min(size.width, 1600))), h = max(2, Int(min(size.height, 1600 * size.height / max(size.width, 1))))
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let colors = [CGColor(red: 0.18, green: 0.30, blue: 0.62, alpha: 1), CGColor(red: 0.55, green: 0.28, blue: 0.62, alpha: 1)] as CFArray
        if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
            ctx.drawLinearGradient(g, start: CGPoint(x: 0, y: CGFloat(h)), end: CGPoint(x: CGFloat(w), y: 0), options: [])
        }
        // A few bright shapes so the frost and tilt are easy to see.
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.22))
        for i in 0..<4 {
            ctx.fillEllipse(in: CGRect(x: CGFloat(w) * (0.1 + 0.2 * CGFloat(i)), y: CGFloat(h) * 0.35, width: CGFloat(w) * 0.14, height: CGFloat(w) * 0.14))
        }
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.35))
        ctx.fill(CGRect(x: CGFloat(w) * 0.3, y: CGFloat(h) * 0.72, width: CGFloat(w) * 0.4, height: CGFloat(h) * 0.05))
        return ctx.makeImage()
    }
}
