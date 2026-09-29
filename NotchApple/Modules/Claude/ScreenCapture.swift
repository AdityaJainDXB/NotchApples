//
//  ScreenCapture.swift
//  Notch apple
//
//  Captures the current display with ScreenCaptureKit (macOS 14+), excluding
//  Notch apple's own windows, and returns a size-capped base64 JPEG ready for
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
            case .noPermission: "Notch apple needs Screen Recording to see your screen. Turn it on in System Settings → Privacy & Security → Screen & System Audio Recording, then press Relaunch (macOS only applies it after a restart)."

            case .noDisplay: "No display available. Grant Screen Recording in System Settings → Privacy & Security."
            case .encode: "Couldn't encode the screenshot."
            }
        }
    }

    /// Longest edge sent to Claude. Keeps requests small and fast.
    private static let maxEdge: CGFloat = 1568

    static func captureBase64JPEG() async throws -> String {
        // Ask first: without permission ScreenCaptureKit fails with a vague error.
        if !ScreenPermission.isGranted {
            await MainActor.run { _ = ScreenPermission.request() }
            if !ScreenPermission.isGranted { throw CaptureError.noPermission }
        }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let screenID = (NSScreen.main?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
        guard let display = content.displays.first(where: { $0.displayID == screenID }) ?? content.displays.first else {
            throw CaptureError.noDisplay
        }

        // Hide our own notch panel from the capture.
        let ownPID = ProcessInfo.processInfo.processIdentifier
        let ownApps = content.applications.filter { $0.processID == ownPID }
        let filter = SCContentFilter(display: display, excludingApplications: ownApps, exceptingWindows: [])

        let scale = min(1, maxEdge / CGFloat(max(display.width, display.height)))
        let config = SCStreamConfiguration()
        config.width = Int(CGFloat(display.width) * scale * 2)   // *2 for Retina, then downscaled below
        config.height = Int(CGFloat(display.height) * scale * 2)
        config.showsCursor = false

        let cgImage = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        return try encode(cgImage)
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
