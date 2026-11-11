//
//  ScreenCapture.swift
//  Notch Apple
//
//  Captures the current display with ScreenCaptureKit (macOS 14+), excluding
//  Notch Apple's own windows, and returns a size-capped base64 JPEG ready for
//  Claude's vision input. The first use triggers the system Screen Recording
//  permission prompt.
//

import AppKit
import ScreenCaptureKit

enum ScreenCapture {
    enum CaptureError: LocalizedError {
        case noDisplay, encode, noPermission
        var errorDescription: String? {
            switch self {
            case .noPermission: "Notch Apple needs Screen Recording to see your screen. Turn it on in System Settings → Privacy & Security → Screen & System Audio Recording, then press Relaunch (macOS only applies it after a restart)."

            case .noDisplay: "No display available. Grant Screen Recording in System Settings → Privacy & Security."
            case .encode: "Couldn't encode the screenshot."
            }
        }
    }

    /// Longest edge sent to Claude. Keeps requests small and fast.
    private static let maxEdge: CGFloat = 1568

    /// `region` (0 to 1000 over the whole screen) captures only that part, at the display's full detail, for the Do It agent's zoom:
    /// small formulas and toolbar buttons become readable. Nil is the whole screen, as before.
    /// `displayID` picks a display (Do It follows the display its target window is on); nil is the main one, as before.
    static func captureBase64JPEG(region: GridRect? = nil, displayID: CGDirectDisplayID? = nil) async throws -> String {
        let (display, filter) = try await displayFilter(displayID)
        _ = display

        let scale = region == nil ? min(1, maxEdge / CGFloat(max(display.width, display.height))) : 1   // a zoom keeps the display's own detail
        let config = SCStreamConfiguration()
        config.width = Int(CGFloat(display.width) * scale * 2)   // *2 for Retina, then downscaled below
        config.height = Int(CGFloat(display.height) * scale * 2)
        config.showsCursor = false

        let cgImage = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        if let r = region {
            let w = CGFloat(cgImage.width), h = CGFloat(cgImage.height)
            let box = CGRect(x: CGFloat(r.x0) / 1000 * w, y: CGFloat(r.y0) / 1000 * h, width: CGFloat(r.width) / 1000 * w, height: CGFloat(r.height) / 1000 * h).integral
            if let cropped = cgImage.cropping(to: box) { return try encode(cropped) }
        }
        return try encode(cgImage)
    }

    /// The chosen display (or the main one) and a filter that hides Notch Apple's own windows.
    private static func displayFilter(_ displayID: CGDirectDisplayID?) async throws -> (SCDisplay, SCContentFilter) {
        // Ask first: without permission ScreenCaptureKit fails with a vague error.
        if !ScreenPermission.isGranted {
            await MainActor.run { _ = ScreenPermission.request() }
            if !ScreenPermission.isGranted { throw CaptureError.noPermission }
        }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let mainID = (NSScreen.main?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
        let wantID = displayID ?? mainID
        guard let display = content.displays.first(where: { $0.displayID == wantID }) ?? content.displays.first else {
            throw CaptureError.noDisplay
        }
        let ownPID = ProcessInfo.processInfo.processIdentifier
        let ownApps = content.applications.filter { $0.processID == ownPID }
        return (display, SCContentFilter(display: display, excludingApplications: ownApps, exceptingWindows: []))
    }

    /// A tiny 32x32 luma signature of the display, for Do It's "did the screen change?" check (see DoItPolicy).
    static func signature(displayID: CGDirectDisplayID? = nil) async throws -> [UInt8] {
        let (_, filter) = try await displayFilter(displayID)
        let config = SCStreamConfiguration()
        config.width = 32
        config.height = 32
        config.showsCursor = false
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        guard let data = image.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { throw CaptureError.encode }
        let bytesPerRow = image.bytesPerRow, bpp = max(image.bitsPerPixel / 8, 1)
        var out = [UInt8]()
        out.reserveCapacity(image.width * image.height)
        for y in 0..<image.height {
            for x in 0..<image.width {
                let p = y * bytesPerRow + x * bpp
                // Average the first three channels; close enough to luma for change detection.
                let luma = (Int(bytes[p]) + Int(bytes[p + min(1, bpp - 1)]) + Int(bytes[p + min(2, bpp - 1)])) / 3
                out.append(UInt8(luma))
            }
        }
        return out
    }

    private static func encode(_ image: CGImage) throws -> String {
        let longest = CGFloat(max(image.width, image.height))
        let factor = min(1, maxEdge / longest)
        let target = NSSize(width: CGFloat(image.width) * factor, height: CGFloat(image.height) * factor)

        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(target.width), pixelsHigh: Int(target.height),
                                   bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                   colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
        guard let rep else { throw CaptureError.encode }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        NSImage(cgImage: image, size: target).draw(in: NSRect(origin: .zero, size: target))
        NSGraphicsContext.restoreGraphicsState()

        guard let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else {
            throw CaptureError.encode
        }
        return jpeg.base64EncodedString()
    }
}
