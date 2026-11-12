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

final class ScreenRegionAndSelectionTests: XCTestCase {
    private typealias L = ScreenContextLogic

    func testADragWorksInEveryDirection() {
        let want = CGRect(x: 10, y: 20, width: 100, height: 50)
        XCTAssertEqual(L.dragRect(from: CGPoint(x: 10, y: 20), to: CGPoint(x: 110, y: 70)), want)
        XCTAssertEqual(L.dragRect(from: CGPoint(x: 110, y: 70), to: CGPoint(x: 10, y: 20)), want)
        XCTAssertEqual(L.dragRect(from: CGPoint(x: 110, y: 20), to: CGPoint(x: 10, y: 70)), want)
        XCTAssertEqual(L.dragRect(from: CGPoint(x: 5, y: 5), to: CGPoint(x: 5, y: 5)).size, .zero)
    }

    func testASelectionIsFlippedToTopLeftOriginOnItsDisplay() {
        let screen = CGRect(x: 0, y: 0, width: 1440, height: 900)
        // 100 wide, 50 tall, its bottom-left 200 from the left and 300 up from the bottom: its top is 550 up, so 350 down from the top.
        let r = L.regionOnDisplay(selection: CGRect(x: 200, y: 300, width: 100, height: 50), screenFrame: screen)
        XCTAssertEqual(r, CGRect(x: 200, y: 550, width: 100, height: 50))
    }

    func testASecondDisplayAbovePrimaryAndLeftOfIt() {
        let left = CGRect(x: -1920, y: 0, width: 1920, height: 1080)
        XCTAssertEqual(L.regionOnDisplay(selection: CGRect(x: -1900, y: 1000, width: 40, height: 60), screenFrame: left), CGRect(x: 20, y: 20, width: 40, height: 60))
        let above = CGRect(x: 0, y: 900, width: 1440, height: 900)
        XCTAssertEqual(L.regionOnDisplay(selection: CGRect(x: 10, y: 1700, width: 50, height: 100), screenFrame: above), CGRect(x: 10, y: 0, width: 50, height: 100))
    }

    func testASelectionPastTheEdgeIsClippedAndATinyOneIsRefused() {
        let screen = CGRect(x: 0, y: 0, width: 1000, height: 800)
        XCTAssertEqual(L.regionOnDisplay(selection: CGRect(x: 900, y: 700, width: 300, height: 300), screenFrame: screen), CGRect(x: 900, y: 0, width: 100, height: 100))
        XCTAssertNil(L.regionOnDisplay(selection: CGRect(x: 10, y: 10, width: 5, height: 200), screenFrame: screen))
        XCTAssertNil(L.regionOnDisplay(selection: CGRect(x: 2000, y: 2000, width: 100, height: 100), screenFrame: screen))   // another display
        XCTAssertNil(L.regionOnDisplay(selection: .zero, screenFrame: screen))
    }

    func testPixelSizeFollowsTheScaleAndIsCapped() {
        XCTAssertEqual(L.pixelSize(of: CGRect(x: 0, y: 0, width: 300, height: 200), scale: 2).width, 600)
        XCTAssertEqual(L.pixelSize(of: CGRect(x: 0, y: 0, width: 300, height: 200), scale: 2).height, 400)
        let big = L.pixelSize(of: CGRect(x: 0, y: 0, width: 6000, height: 3000), scale: 2)
        XCTAssertEqual(big.width, 4096)
        XCTAssertEqual(big.height, 2048)                      // same shape
        XCTAssertGreaterThanOrEqual(L.pixelSize(of: CGRect(x: 0, y: 0, width: 0.2, height: 0.2), scale: 1).width, 1)
    }

    func testTheDrawnAreaIsNotAPreset() {
        XCTAssertFalse(ScreenScope.presets.contains(.region))
        XCTAssertTrue(ScreenScope.presets.contains(.window))
        XCTAssertNil(ScreenScope.region.crop)
        XCTAssertEqual(ScreenScope.region.title, "A chosen area")
    }

    func testSelectedTextBlankIsRefusedAndLongIsCutWithANote() {
        XCTAssertNil(L.usableSelection(nil))
        XCTAssertNil(L.usableSelection("  \n\t "))
        XCTAssertEqual(L.usableSelection("  hello \n")?.text, "hello")
        XCTAssertEqual(L.usableSelection("hello")?.wasCut, false)
        let long = L.usableSelection(String(repeating: "a", count: 20_000))
        XCTAssertEqual(long?.text.count, L.maxSelection)
        XCTAssertEqual(long?.wasCut, true)
    }

    func testSelectionPromptNamesTheAppAndQuotesTheText() {
        let p = L.selectionPrompt(question: "Explain", appName: "Safari", text: "Na+ is a cation", wasCut: false)
        XCTAssertTrue(p.hasPrefix("Explain\n"))
        XCTAssertTrue(p.contains("selected in Safari"))
        XCTAssertTrue(p.contains("\"\"\"\nNa+ is a cation\n\"\"\""))
        XCTAssertFalse(p.contains("very long"))
        XCTAssertTrue(L.selectionPrompt(question: "q", appName: "A", text: "t", wasCut: true).contains("very long"))
        XCTAssertEqual(L.selectionBubble(question: "Explain", appName: "Safari", characters: 1500), "Explain  ·  selected text in Safari, 1,500 characters")
    }
}
