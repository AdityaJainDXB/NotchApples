//
//  NotchAITeachingTests.swift
//  Notch Apple tests
//
//  Teaching plans, finding the thing to point at, step completion, and the drawing itself (rendered to a bitmap and
//  checked pixel by pixel: nothing is drawn on a real screen).
//

import CoreGraphics
import XCTest

final class NotchAITeachingTests: XCTestCase {
    typealias L = TeachingLogic

    func testPlanIsReadFromFencedOrChattyJSON() {
        let reply = "Sure!\n```json\n{\"steps\":[{\"instruction\":\"Open the File menu\",\"target\":\"File\",\"expected\":[\"New\"]},{\"instruction\":\"Save it\",\"target\":\"\",\"expected\":\"Saved\"}]}\n```"
        let p = L.parse(reply, goal: "save")!
        XCTAssertEqual(p.steps.count, 2)
        XCTAssertEqual(p.steps[0], TeachingStep(instruction: "Open the File menu", target: "File", expected: ["New"]))
        XCTAssertNil(p.steps[1].target)
        XCTAssertEqual(p.steps[1].expected, ["Saved"])
        XCTAssertNil(L.parse("no json here", goal: "x"))
        XCTAssertNil(L.parse("{\"steps\":[{\"instruction\":\"  \"}]}", goal: "x"))
    }

    func testPlansAreLimitedToFifteenSteps() {
        let steps = (1...30).map { "{\"instruction\":\"s\($0)\"}" }.joined(separator: ",")
        XCTAssertEqual(L.parse("{\"steps\":[\(steps)]}", goal: "x")?.steps.count, 15)
    }

    // MARK: Pointing

    private let boxes = [OCRBox(text: "File", box: CGRect(x: 0.1, y: 0.9, width: 0.05, height: 0.04)),
                         OCRBox(text: "File Transfer Settings", box: CGRect(x: 0.4, y: 0.5, width: 0.3, height: 0.04)),
                         OCRBox(text: "Save As…", box: CGRect(x: 0.2, y: 0.3, width: 0.1, height: 0.03))]

    func testExactMatchWinsAndCoordinatesFlipToTopLeft() {
        let r = L.locate("file", in: boxes)!
        XCTAssertEqual(r.minX, 0.1, accuracy: 0.0001)
        XCTAssertEqual(r.minY, 1 - 0.94, accuracy: 0.0001)       // bottom-left 0.9..0.94 -> top-left 0.06
    }

    func testAPartialMatchPrefersTheShortestLine() {
        XCTAssertEqual(L.locate("save", in: boxes)?.minX ?? 0, 0.2, accuracy: 0.0001)
        XCTAssertNotNil(L.locate("transfer", in: boxes))
    }

    func testAMissingTargetIsNilNeverGuessed() {
        XCTAssertNil(L.locate("Export", in: boxes))
        XCTAssertNil(L.locate("  ", in: boxes))
        XCTAssertNil(L.locate("File", in: []))
    }

    func testWithoutATargetOnlyTheInstructionIsShown() {
        let a = L.annotations(step: TeachingStep(instruction: "Find the Export button"), number: 2, target: nil)
        XCTAssertEqual(a.count, 2)
        XCTAssertTrue(a.contains { if case .badge(_, 2) = $0 { true } else { false } })
        XCTAssertFalse(a.contains { if case .ring = $0 { true } else { false } })
    }

    func testWithATargetThereIsARingAnArrowABoxABadgeAndALabel() {
        let a = L.annotations(step: TeachingStep(instruction: "Click Save"), number: 1, target: CGRect(x: 0.4, y: 0.5, width: 0.1, height: 0.04))
        func has(_ f: (AnnotationShape) -> Bool) -> Bool { a.contains(where: f) }
        XCTAssertTrue(has { if case .ring = $0 { true } else { false } })
        XCTAssertTrue(has { if case .arrow = $0 { true } else { false } })
        XCTAssertTrue(has { if case .box = $0 { true } else { false } })
        XCTAssertTrue(has { if case .badge(_, 1) = $0 { true } else { false } })
        XCTAssertTrue(has { if case .label(_, "Click Save") = $0 { true } else { false } })
    }

    // MARK: Progress

    func testAStepIsDoneOnlyWhenEveryExpectedTextIsVisible() {
        let s = TeachingStep(instruction: "x", target: nil, expected: ["Saved", "Untitled"])
        XCTAssertFalse(L.isDone(s, screenText: "Document Saved"))
        XCTAssertTrue(L.isDone(s, screenText: "untitled - SAVED"))
        XCTAssertFalse(L.isDone(TeachingStep(instruction: "x"), screenText: "anything"))      // nothing expected: the user presses Next
    }

    func testAdvancing() {
        let plan = TeachingPlan(goal: "g", steps: [TeachingStep(instruction: "a"), TeachingStep(instruction: "b")])
        XCTAssertEqual(L.next(after: 0, in: plan), 1)
        XCTAssertNil(L.next(after: 1, in: plan))
    }

    // MARK: Drawing (real pixels)

    private func render(_ shapes: [AnnotationShape], size: CGSize = CGSize(width: 400, height: 300)) -> (CGContext, [UInt8]) {
        let ctx = CGContext(data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8, bytesPerRow: Int(size.width) * 4,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        AnnotationRenderer.draw(shapes, in: ctx, size: size)
        let data = ctx.data!.bindMemory(to: UInt8.self, capacity: Int(size.width * size.height) * 4)
        return (ctx, Array(UnsafeBufferPointer(start: data, count: Int(size.width * size.height) * 4)))
    }

    /// Row y counted from the TOP, as the annotations are.
    private func isGreen(_ px: [UInt8], x: Int, yTop: Int, width: Int = 400, height: Int = 300) -> Bool {
        let row = yTop                                           // memory row 0 is the top of the image
        let i = (row * width + x) * 4
        // premultiplied: a faded green is still green-dominant
        return px[i + 3] > 80 && Int(px[i + 1]) > Int(px[i]) * 2 && Int(px[i + 1]) > Int(px[i + 2])
    }

    private func anyGreen(_ px: [UInt8], around x: Int, _ yTop: Int, radius: Int = 4) -> Bool {
        for dy in -radius...radius { for dx in -radius...radius where isGreen(px, x: x + dx, yTop: yTop + dy) { return true } }
        return false
    }

    func testTheBoxIsDrawnWhereItBelongsAndNotElsewhere() {
        let (_, px) = render([.box(CGRect(x: 0.25, y: 0.2, width: 0.5, height: 0.4))])
        XCTAssertTrue(anyGreen(px, around: 100, 60))             // left edge, 0.25 * 400, top 0.2 * 300
        XCTAssertTrue(anyGreen(px, around: 200, 60))             // top edge middle
        XCTAssertTrue(anyGreen(px, around: 300, 120))            // right edge middle (0.75 * 400, 0.4 * 300)
        XCTAssertFalse(anyGreen(px, around: 200, 90, radius: 3)) // the inside is empty
        XCTAssertFalse(anyGreen(px, around: 20, 20))             // outside is empty
    }

    func testTheArrowRunsFromItsStartToItsTip() {
        let (_, px) = render([.arrow(from: CGPoint(x: 0.2, y: 0.5), to: CGPoint(x: 0.8, y: 0.5))])
        XCTAssertTrue(anyGreen(px, around: 120, 150))
        XCTAssertTrue(anyGreen(px, around: 200, 150))
        XCTAssertTrue(anyGreen(px, around: 316, 150))            // the head near the tip
        XCTAssertFalse(anyGreen(px, around: 40, 150))
    }

    func testTheRingIsConcentric() {
        let (_, px) = render([.ring(center: CGPoint(x: 0.5, y: 0.5))])
        XCTAssertTrue(anyGreen(px, around: 200 + 10, 150, radius: 2))
        XCTAssertTrue(anyGreen(px, around: 200 + 32, 150, radius: 2))
        XCTAssertFalse(anyGreen(px, around: 200, 150, radius: 3))   // the middle stays clear so the target shows through
    }

    func testTheBadgeIsAFilledGreenDisc() {
        let (_, px) = render([.badge(center: CGPoint(x: 0.5, y: 0.5), number: 3)])
        XCTAssertTrue(anyGreen(px, around: 200 + 11, 150 - 9, radius: 2))
        XCTAssertFalse(anyGreen(px, around: 200 + 60, 150, radius: 3))
    }

    func testNothingToDrawLeavesTheBitmapTransparent() {
        let (_, px) = render([])
        XCTAssertTrue(stride(from: 3, to: px.count, by: 4).allSatisfy { px[$0] == 0 })
    }
}
