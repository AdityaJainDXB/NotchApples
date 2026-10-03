//
//  CaptureManager.swift
//  Notch apple
//
//  Universal capture: grab part of the screen and hand it to the AI tab.
//
//   • Region (default): freezes the display the pointer is on and lets you drag
//     a box. Esc or right-click cancels; a click without dragging takes the
//     whole display. The crop is cut from the full-resolution capture, so a
//     Retina selection keeps every pixel.
//   • Display: the whole display under the pointer.
//   • All displays: every display, side by side as they're arranged.
//
//  The display is always the one under the pointer, never NSScreen.main (the
//  screen with the key window), so a capture on display 2 never grabs display 1.
//  Notch apple's own windows are left out of every capture.
//

import AppKit
import ScreenCaptureKit
import SwiftUI

/// Something captured or pasted, ready to send to the AI.
struct CapturedInput {
    let image: CGImage
    /// Where it came from, e.g. "Region 640 × 412 on Studio Display".
    let source: String
    enum Kind: String, Codable { case region, display, allDisplays, clipboard, file }
    let kind: Kind

    var pixelSize: String { "\(image.width) × \(image.height)" }
}

@MainActor
final class CaptureManager {
    static let shared = CaptureManager()

    enum Mode: String, CaseIterable, Identifiable {
        case region, display, allDisplays
        var id: String { rawValue }
        var title: String {
            switch self {
            case .region: "Selected region"
            case .display: "Display under the pointer"
            case .allDisplays: "All displays"
            }
        }
    }

    /// Settings → AI → Capture.
    @AppStorage("capture.defaultMode") var defaultModeRaw = Mode.region.rawValue
    var defaultMode: Mode { Mode(rawValue: defaultModeRaw) ?? .region }

    enum CaptureError: LocalizedError {
        case noPermission, noDisplay, failed(String)
        var errorDescription: String? {
            switch self {
            case .noPermission: "Notch apple needs Screen Recording permission to capture your screen. Turn it on in System Settings → Privacy & Security → Screen & System Audio Recording, then relaunch Notch apple."
            case .noDisplay: "Couldn't find the display under the pointer."
            case .failed(let why): "The capture didn't work: \(why)"
            }
        }
    }

    private var overlay: RegionOverlayWindow?
    private(set) var isCapturing = false

    // MARK: Entry point

    /// Captures with `mode` (or the default) and opens the AI tab with the result.
    /// Returns quietly if the user cancels.
    func captureToAI(_ mode: Mode? = nil) {
        guard !isCapturing else { return }
        Task {
            do {
                guard let input = try await capture(mode ?? defaultMode) else { return }
                ClaudeChatModel.shared.setInput(input)
                AppDelegate.showNotch(tab: .claude)
            } catch {
                ClaudeChatModel.shared.error = error.localizedDescription
                AppDelegate.showNotch(tab: .claude)
            }
        }
    }

    func capture(_ mode: Mode) async throws -> CapturedInput? {
        guard ScreenPermission.isGranted else {
            ScreenPermission.request()
            throw CaptureError.noPermission
        }
        isCapturing = true
        defer { isCapturing = false }
        // Get the notch out of the way first.
        AppDelegate.current?.notch?.closeNotch()

        switch mode {
        case .allDisplays:
            return try await captureAllDisplays()
        case .display, .region:
            guard let screen = Self.screenUnderPointer else { throw CaptureError.noDisplay }
            let image = try await Self.captureDisplay(screen)
            let name = screen.localizedName
            if mode == .display {
                return CapturedInput(image: image, source: "Whole display · \(name)", kind: .display)
            }
            guard let crop = await selectRegion(on: screen, frozen: image) else { return nil }
            let isWhole = crop.width == image.width && crop.height == image.height
            return CapturedInput(image: crop, source: isWhole ? "Whole display · \(name)" : "Region \(crop.width) × \(crop.height) · \(name)",
                                 kind: isWhole ? .display : .region)
        }
    }

    // MARK: Displays

    static var screenUnderPointer: NSScreen? {
        let p = NSEvent.mouseLocation
        return NSScreen.screens.first { NSMouseInRect(p, $0.frame, false) } ?? NSScreen.main
    }

    static func displayID(_ screen: NSScreen) -> CGDirectDisplayID? {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
    }

    /// The display at its native pixel size (points × backing scale), without Notch apple's windows.
    static func captureDisplay(_ screen: NSScreen) async throws -> CGImage {
        let content: SCShareableContent
        do { content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) }
        catch { throw CaptureError.noPermission }
        guard let id = displayID(screen), let display = content.displays.first(where: { $0.displayID == id }) else {
            throw CaptureError.noDisplay
        }
        let ownPID = ProcessInfo.processInfo.processIdentifier
        let filter = SCContentFilter(display: display, excludingApplications: content.applications.filter { $0.processID == ownPID },
                                     exceptingWindows: [])
        let config = SCStreamConfiguration()
        let scale = screen.backingScaleFactor
        config.width = Int(CGFloat(display.width) * scale)
        config.height = Int(CGFloat(display.height) * scale)
        config.showsCursor = false
        config.captureResolution = .best
        do { return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) }
        catch { throw CaptureError.failed(error.localizedDescription) }
    }

    /// Every display, placed as arranged in System Settings, at the sharpest display's scale.
    private func captureAllDisplays() async throws -> CapturedInput {
        let screens = NSScreen.screens
        var shots: [(NSScreen, CGImage)] = []
        for s in screens { shots.append((s, try await Self.captureDisplay(s))) }
        let union = screens.reduce(CGRect.null) { $0.union($1.frame) }
        let scale = screens.map(\.backingScaleFactor).max() ?? 2
        let width = Int(union.width * scale), height = Int(union.height * scale)
        guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { throw CaptureError.failed("out of memory") }
        ctx.setFillColor(NSColor.black.cgColor)
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        ctx.interpolationQuality = .high
        for (s, img) in shots {
            let r = CGRect(x: (s.frame.minX - union.minX) * scale, y: (s.frame.minY - union.minY) * scale,
                           width: s.frame.width * scale, height: s.frame.height * scale)
            ctx.draw(img, in: r)
        }
        guard let image = ctx.makeImage() else { throw CaptureError.failed("couldn't combine the displays") }
        return CapturedInput(image: image, source: "All \(screens.count) display\(screens.count == 1 ? "" : "s")", kind: .allDisplays)
    }

    // MARK: Region selection

    private func selectRegion(on screen: NSScreen, frozen: CGImage) async -> CGImage? {
        await withCheckedContinuation { continuation in
            let window = RegionOverlayWindow(screen: screen, image: frozen) { [weak self] crop in
                self?.overlay?.orderOut(nil)
                self?.overlay = nil
                continuation.resume(returning: crop)
            }
            overlay = window
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
        }
    }
}

// MARK: - Overlay

/// A borderless window over one display showing the frozen screenshot; drag to select.
final class RegionOverlayWindow: NSWindow {
    init(screen: NSScreen, image: CGImage, done: @escaping (CGImage?) -> Void) {
        super.init(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        level = .screenSaver
        isOpaque = true
        hasShadow = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        let view = RegionSelectView(frame: NSRect(origin: .zero, size: screen.frame.size), image: image, done: done)
        contentView = view
        setFrame(screen.frame, display: true)
        makeFirstResponder(view)
    }
    override var canBecomeKey: Bool { true }
}

final class RegionSelectView: NSView {
    private let image: CGImage
    private let done: (CGImage?) -> Void
    private var start: NSPoint?
    private var current: NSPoint?
    private var finished = false

    init(frame: NSRect, image: CGImage, done: @escaping (CGImage?) -> Void) {
        self.image = image
        self.done = done
        super.init(frame: frame)
        setAccessibilityLabel("Drag to select part of the screen. Press Escape to cancel.")
    }
    required init?(coder: NSCoder) { fatalError() }

    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }

    private var selection: NSRect? {
        guard let s = start, let c = current else { return nil }
        return NSRect(x: min(s.x, c.x), y: min(s.y, c.y), width: abs(s.x - c.x), height: abs(s.y - c.y))
    }

    /// Pixels per point in the frozen image (2 on Retina).
    private var scale: CGFloat { CGFloat(image.width) / bounds.width }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.draw(image, in: bounds)
        ctx.setFillColor(NSColor.black.withAlphaComponent(0.45).cgColor)
        if let sel = selection, sel.width > 1, sel.height > 1 {
            // Dim everything except the selection.
            ctx.addRect(bounds); ctx.addRect(sel)
            ctx.fillPath(using: .evenOdd)
            ctx.setStrokeColor(NSColor.white.cgColor)
            ctx.setLineWidth(1)
            ctx.stroke(sel.insetBy(dx: -0.5, dy: -0.5))
            // Exact size in pixels, like macOS's own screenshot tool.
            let label = "\(Int((sel.width * scale).rounded())) × \(Int((sel.height * scale).rounded()))" as NSString
            let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold),
                                                        .foregroundColor: NSColor.white]
            let size = label.size(withAttributes: attrs)
            var origin = NSPoint(x: sel.maxX - size.width - 8, y: sel.minY - size.height - 10)
            if origin.y < 4 { origin.y = sel.minY + 6 }
            let pill = NSRect(x: origin.x - 6, y: origin.y - 3, width: size.width + 12, height: size.height + 6)
            NSColor.black.withAlphaComponent(0.7).setFill()
            NSBezierPath(roundedRect: pill, xRadius: 6, yRadius: 6).fill()
            label.draw(at: origin, withAttributes: attrs)
        } else {
            ctx.fill(bounds)
            let hint = "Drag to capture · click for the whole display · Esc to cancel" as NSString
            let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 15, weight: .medium), .foregroundColor: NSColor.white]
            let size = hint.size(withAttributes: attrs)
            let pill = NSRect(x: bounds.midX - size.width / 2 - 16, y: bounds.midY - size.height / 2 - 10, width: size.width + 32, height: size.height + 20)
            NSColor.black.withAlphaComponent(0.65).setFill()
            NSBezierPath(roundedRect: pill, xRadius: pill.height / 2, yRadius: pill.height / 2).fill()
            hint.draw(at: NSPoint(x: pill.minX + 16, y: pill.minY + 10), withAttributes: attrs)
        }
    }

    override func mouseDown(with event: NSEvent) {
        start = convert(event.locationInWindow, from: nil)
        current = start
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        current = convert(event.locationInWindow, from: nil)
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        current = convert(event.locationInWindow, from: nil)
        guard let sel = selection, sel.width >= 4, sel.height >= 4 else { return finish(image) }   // a click: whole display
        // View points (origin bottom-left) → image pixels (origin top-left).
        let px = CGRect(x: sel.minX * scale, y: (bounds.height - sel.maxY) * scale,
                        width: sel.width * scale, height: sel.height * scale).integral
        finish(image.cropping(to: px))
    }

    override func rightMouseDown(with event: NSEvent) { finish(nil) }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 53: finish(nil)            // Esc
        case 36, 76: finish(image)      // Return: whole display
        default: super.keyDown(with: event)
        }
    }

    override func cancelOperation(_ sender: Any?) { finish(nil) }

    private func finish(_ result: CGImage?) {
        guard !finished else { return }
        finished = true
        done(result)
    }
}

// MARK: - Encoding for AI providers

enum ImagePrep {
    /// Longest edge sent to providers: large enough for small text, small enough to be fast.
    static let maxEdge: CGFloat = 2048

    /// Downscales only when needed (never upscales) and encodes as JPEG, or PNG for small text-heavy crops.
    static func base64(_ image: CGImage, maxEdge: CGFloat = maxEdge) -> String? {
        let longest = CGFloat(max(image.width, image.height))
        let factor = min(1, maxEdge / longest)
        let w = Int(CGFloat(image.width) * factor), h = Int(CGFloat(image.height) * factor)
        var source = image
        if factor < 1, let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                           space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
            ctx.interpolationQuality = .high
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            if let scaled = ctx.makeImage() { source = scaled }
        }
        let rep = NSBitmapImageRep(cgImage: source)
        guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.85]) else { return nil }
        return data.base64EncodedString()
    }

    static func thumbnail(_ image: CGImage, maxEdge: CGFloat = 320) -> NSImage {
        let factor = min(1, maxEdge / CGFloat(max(image.width, image.height)))
        return NSImage(cgImage: image, size: NSSize(width: CGFloat(image.width) * factor, height: CGFloat(image.height) * factor))
    }
}
