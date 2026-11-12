//
//  ScreenContextTests.swift
//  Notch Apple tests
//
//  Screen awareness rules (exclusions, the prompt built from screen text, region crops) and real Vision OCR on an
//  image the test draws itself (no screen is captured).
//

import AppKit
import XCTest

final class ScreenContextTests: XCTestCase {
    typealias L = ScreenContextLogic
    private let snap = ScreenSnapshot(appName: "Safari", bundleID: "com.apple.Safari", windowTitle: "Docs", ocrText: "Error: file not found", scope: .window)

    func testPasswordManagersAreExcludedByDefault() {
        XCTAssertTrue(L.isExcluded(bundleID: "com.1Password.1password", exclusions: L.defaultExclusions))   // case-insensitive
        XCTAssertTrue(L.isExcluded(bundleID: "com.apple.keychainaccess", exclusions: L.defaultExclusions))
        XCTAssertFalse(L.isExcluded(bundleID: "com.apple.Safari", exclusions: L.defaultExclusions))
        XCTAssertFalse(L.isExcluded(bundleID: "com.apple.Safari", exclusions: []))
    }

    func testPromptCarriesQuestionAppWindowAndText() {
        let p = L.prompt(question: "What is this?", snapshot: snap)
        XCTAssertTrue(p.hasPrefix("What is this?"))
        XCTAssertTrue(p.contains("App: Safari"))
        XCTAssertTrue(p.contains("Window: Docs"))
        XCTAssertTrue(p.contains("Error: file not found"))
        XCTAssertTrue(p.contains("read on my Mac, not an image"))
    }

    func testPromptSaysWhenNothingWasRead() {
        var s = snap; s.ocrText = ""; s.windowTitle = nil
        let p = L.prompt(question: "Q", snapshot: s)
        XCTAssertTrue(p.contains("No text could be read"))
        XCTAssertFalse(p.contains("Window:"))
    }

    func testLongTextKeepsHeadAndTailAndSaysSo() {
        let text = (1...2000).map { "line\($0)" }.joined(separator: "\n")
        var s = snap; s.ocrText = text
        let p = L.prompt(question: "Q", snapshot: s, maxCharacters: 600)
        XCTAssertTrue(p.contains("line1\n"))
        XCTAssertTrue(p.contains("line2000"))
        XCTAssertTrue(p.contains("left out"))
        XCTAssertLessThan(p.count, 1200)
    }

    func testBubbleIsShortAndCountsCharacters() {
        let b = L.bubble(question: "Explain my screen", snapshot: snap)
        XCTAssertTrue(b.contains("Explain my screen"))
        XCTAssertTrue(b.contains("Safari"))
        XCTAssertTrue(b.contains("21 characters"))
        XCTAssertFalse(b.contains("Error:"))
    }

    func testRegionCrops() {
        XCTAssertNil(L.cropRect(ScreenScope.window.crop, width: 1000, height: 800))
        XCTAssertEqual(L.cropRect(ScreenScope.top.crop, width: 1000, height: 800), CGRect(x: 0, y: 0, width: 1000, height: 400))
        XCTAssertEqual(L.cropRect(ScreenScope.right.crop, width: 1000, height: 800), CGRect(x: 500, y: 0, width: 500, height: 800))
        XCTAssertEqual(L.cropRect(ScreenScope.center.crop, width: 1000, height: 800), CGRect(x: 250, y: 200, width: 500, height: 400))
    }

    // MARK: Real OCR on a drawn image

    private func image(_ lines: [String]) -> CGImage {
        let w = 900, h = 120 * lines.count + 40
        let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setFillColor(CGColor(gray: 1, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
        for (i, line) in lines.enumerated() {
            let y = CGFloat(h - 120 * (i + 1))
            (line as NSString).draw(at: CGPoint(x: 30, y: y), withAttributes: [.font: NSFont.systemFont(ofSize: 64), .foregroundColor: NSColor.black])
        }
        NSGraphicsContext.restoreGraphicsState()
        return ctx.makeImage()!
    }

    func testVisionReadsDrawnTextInOrder() async throws {
        let lines = try await ScreenOCR.recognize(image(["Build failed", "Error 404 not found"]))
        let text = ScreenOCR.text(lines).lowercased()
        XCTAssertTrue(text.contains("build failed"), text)
        XCTAssertTrue(text.contains("404"), text)
        XCTAssertLessThan(text.range(of: "build")!.lowerBound, text.range(of: "404")!.lowerBound)   // top line first
    }

    func testVisionOnABlankImageFindsNothing() async throws {
        let lines = try await ScreenOCR.recognize(image([]))
        XCTAssertTrue(lines.isEmpty)
    }
}
