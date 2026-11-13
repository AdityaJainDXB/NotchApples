//
//  NotchAIDrawingAndDiagramTests.swift
//  Notch Apple tests
//
//  Drawing on the screen (your own lines, the hand-drawn style), diagrams (validation and layout) and 3D files.
//

import CoreGraphics
import XCTest

final class NotchAIDrawingAndDiagramTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_000)

    // MARK: Your own drawing

    func testDrawingNeedsExactlyControlAndOption() {
        XCTAssertTrue(DrawingLogic.shouldDraw(control: true, option: true, command: false, shift: false))
        XCTAssertFalse(DrawingLogic.shouldDraw(control: true, option: false, command: false, shift: false))
        XCTAssertFalse(DrawingLogic.shouldDraw(control: true, option: true, command: true, shift: false))
        XCTAssertFalse(DrawingLogic.shouldDraw(control: true, option: true, command: false, shift: true))
    }

    func testAScreenPointBecomesATopLeftFraction() {
        let frame = CGRect(x: 100, y: 50, width: 1000, height: 500)
        let p = DrawingLogic.fraction(of: CGPoint(x: 350, y: 500), in: frame)!
        XCTAssertEqual(p.x, 0.25, accuracy: 0.0001)
        XCTAssertEqual(p.y, 0.1, accuracy: 0.0001)          // near the top
        XCTAssertNil(DrawingLogic.fraction(of: CGPoint(x: 50, y: 60), in: frame))
    }

    func testALineStartsGrowsAndEnds() {
        var s: [DrawnStroke] = []
        s = DrawingLogic.extend(s, with: CGPoint(x: 0.1, y: 0.1), drawing: true, now: t0)
        s = DrawingLogic.extend(s, with: CGPoint(x: 0.2, y: 0.1), drawing: true, now: t0)
        s = DrawingLogic.extend(s, with: CGPoint(x: 0.2001, y: 0.1), drawing: true, now: t0)     // too close: skipped
        XCTAssertEqual(s.count, 1)
        XCTAssertEqual(s[0].points.count, 2)
        XCTAssertNil(s[0].finishedAt)
        s = DrawingLogic.extend(s, with: CGPoint(x: 0.3, y: 0.3), drawing: false, now: t0)
        XCTAssertEqual(s[0].finishedAt, t0)
        s = DrawingLogic.extend(s, with: CGPoint(x: 0.5, y: 0.5), drawing: true, now: t0)
        XCTAssertEqual(s.count, 2, "a new line after the keys were released")
    }

    func testADotIsNotALineAndMovingWithoutKeysDrawsNothing() {
        var s = DrawingLogic.extend([], with: CGPoint(x: 0.1, y: 0.1), drawing: true, now: t0)
        s = DrawingLogic.extend(s, with: CGPoint(x: 0.1, y: 0.1), drawing: false, now: t0)
        XCTAssertTrue(s.isEmpty)
        XCTAssertTrue(DrawingLogic.extend([], with: CGPoint(x: 0.4, y: 0.4), drawing: false, now: t0).isEmpty)
    }

    func testLeavingTheScreenEndsTheLine() {
        var s = DrawingLogic.extend([], with: CGPoint(x: 0.1, y: 0.1), drawing: true, now: t0)
        s = DrawingLogic.extend(s, with: CGPoint(x: 0.3, y: 0.1), drawing: true, now: t0)
        s = DrawingLogic.extend(s, with: nil, drawing: true, now: t0)
        XCTAssertEqual(s.first?.finishedAt, t0)
    }

    func testLimitsOnPointsAndLines() {
        var s: [DrawnStroke] = []
        for i in 0..<(DrawingLogic.maxPoints + 200) {
            s = DrawingLogic.extend(s, with: CGPoint(x: CGFloat(i) * 0.002, y: 0.5), drawing: true, now: t0)
        }
        XCTAssertEqual(s[0].points.count, DrawingLogic.maxPoints)
        var many: [DrawnStroke] = []
        for i in 0..<(DrawingLogic.maxStrokes + 5) {
            many = DrawingLogic.extend(many, with: CGPoint(x: 0.1, y: CGFloat(i) * 0.01), drawing: true, now: t0)
            many = DrawingLogic.extend(many, with: CGPoint(x: 0.2, y: CGFloat(i) * 0.01), drawing: true, now: t0)
            many = DrawingLogic.extend(many, with: nil, drawing: false, now: t0)
        }
        XCTAssertEqual(many.count, DrawingLogic.maxStrokes)
    }

    func testFinishedLinesFadeButALineBeingDrawnStays() {
        let old = DrawnStroke(points: [.zero, CGPoint(x: 0.1, y: 0.1)], finishedAt: t0)
        let open = DrawnStroke(points: [.zero, CGPoint(x: 0.1, y: 0.1)], finishedAt: nil)
        XCTAssertEqual(DrawingLogic.visible([old, open], now: t0.addingTimeInterval(DrawingLogic.lifetime - 1)).count, 2)
        XCTAssertEqual(DrawingLogic.visible([old, open], now: t0.addingTimeInterval(DrawingLogic.lifetime + 1)), [open])
    }

    func testTheAreaDrawnAroundIsPaddedAndStaysOnTheScreen() {
        let strokes = [DrawnStroke(points: [CGPoint(x: 0.2, y: 0.2), CGPoint(x: 0.4, y: 0.3)], finishedAt: t0),
                       DrawnStroke(points: [CGPoint(x: 0.3, y: 0.5)], finishedAt: t0)]
        let b = DrawingLogic.bounds(of: strokes)!
        XCTAssertEqual(b.minX, 0.2, accuracy: 1e-9); XCTAssertEqual(b.maxX, 0.4, accuracy: 1e-9)
        XCTAssertEqual(b.minY, 0.2, accuracy: 1e-9); XCTAssertEqual(b.maxY, 0.5, accuracy: 1e-9)
        let frame = CGRect(x: 0, y: 0, width: 1000, height: 1000)
        let r = DrawingLogic.screenRect(b, in: frame, padding: 20)
        XCTAssertEqual(r.minX, 180, accuracy: 0.001); XCTAssertEqual(r.maxX, 420, accuracy: 0.001)
        XCTAssertEqual(r.minY, 480, accuracy: 0.001, "AppKit's y runs up, so the bottom of the drawing is y = 1000 - 500 - 20")
        XCTAssertEqual(r.maxY, 820, accuracy: 0.001)
        let edge = DrawingLogic.screenRect(CGRect(x: 0, y: 0, width: 1, height: 1), in: frame, padding: 50)
        XCTAssertEqual(edge, frame)
        XCTAssertNil(DrawingLogic.bounds(of: []))
        XCTAssertEqual(DrawingLogic.shapes(strokes).count, 1, "a single point is not drawn")
    }

    // MARK: Hand-drawn style

    func testTheSameShapeIsAlwaysDrawnTheSameWay() {
        let a = HandDrawn.line(from: .zero, to: CGPoint(x: 200, y: 50), seed: 7)
        XCTAssertEqual(a, HandDrawn.line(from: .zero, to: CGPoint(x: 200, y: 50), seed: 7))
        XCTAssertNotEqual(a, HandDrawn.line(from: .zero, to: CGPoint(x: 200, y: 50), seed: 8))
        XCTAssertEqual(HandDrawn.seed(1, 2, 3), HandDrawn.seed(1, 2, 3))
        XCTAssertNotEqual(HandDrawn.seed(1, 2, 3), HandDrawn.seed(3, 2, 1))
    }

    func testAWobblyLineStaysCloseToTheRealLine() {
        let a = CGPoint(x: 10, y: 10), b = CGPoint(x: 310, y: 10), amp: CGFloat = 2.2
        let pts = HandDrawn.line(from: a, to: b, seed: 99, amplitude: amp)
        XCTAssertGreaterThan(pts.count, 10)
        for p in pts { XCTAssertLessThanOrEqual(abs(p.y - 10), amp + 0.0001) }
        XCTAssertEqual(pts.first!.x, 10, accuracy: 0.001)
        XCTAssertEqual(pts.last!.x, 310, accuracy: 0.001)
        XCTAssertTrue(pts.contains { abs($0.y - 10) > 0.05 }, "it does wobble")
        XCTAssertEqual(HandDrawn.line(from: a, to: a, seed: 1), [a, a])
    }

    func testAWobblyBoxAndCircleStayNearTheirShape() {
        let r = CGRect(x: 100, y: 100, width: 200, height: 80), amp: CGFloat = 2.2
        for p in HandDrawn.rect(r, seed: 5, amplitude: amp) {
            XCTAssertTrue(r.insetBy(dx: -amp - 0.001, dy: -amp - 0.001).contains(p))
            XCTAssertFalse(r.insetBy(dx: amp + 0.001, dy: amp + 0.001).contains(p), "points sit on the outline, not inside")
        }
        let c = CGRect(x: 0, y: 0, width: 100, height: 100)
        let ring = HandDrawn.ellipse(in: c, seed: 3, amplitude: amp)
        for p in ring { XCTAssertEqual(hypot(p.x - 50, p.y - 50), 50, accuracy: amp + 0.001) }
        XCTAssertGreaterThanOrEqual(ring.count, 24)
    }

    func testRenderingAStrokeAndHandDrawnShapesPutsInkOnThePage() {
        let w = 200, h = 120
        func ink(_ shapes: [AnnotationShape], hand: Bool) -> Int {
            let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            AnnotationRenderer.draw(shapes, in: ctx, size: CGSize(width: w, height: h), handDrawn: hand)
            let data = ctx.data!.bindMemory(to: UInt8.self, capacity: w * h * 4)
            return (0..<(w * h)).filter { data[$0 * 4 + 3] > 0 }.count
        }
        XCTAssertGreaterThan(ink([.stroke([CGPoint(x: 0.1, y: 0.1), CGPoint(x: 0.5, y: 0.6), CGPoint(x: 0.9, y: 0.2)])], hand: false), 300)
        XCTAssertEqual(ink([.stroke([CGPoint(x: 0.1, y: 0.1)])], hand: false), 0)
        let shapes: [AnnotationShape] = [.box(CGRect(x: 0.1, y: 0.1, width: 0.5, height: 0.5)), .circle(center: CGPoint(x: 0.7, y: 0.5), radius: 0.1),
                                         .arrow(from: CGPoint(x: 0.1, y: 0.9), to: CGPoint(x: 0.9, y: 0.9)), .ring(center: CGPoint(x: 0.3, y: 0.3))]
        let plain = ink(shapes, hand: false), hand = ink(shapes, hand: true)
        XCTAssertGreaterThan(hand, 500)
        XCTAssertNotEqual(plain, hand, "the hand-drawn version is a different drawing")
    }

    // MARK: Diagrams

    private let good = """
    Here you go: {"title":"Water cycle","explanation":"Water moves around.","nodes":[
      {"id":"sea","label":"Sea","kind":"start","info":"Most water is here."},
      {"id":"vapour","label":"Water vapour","kind":"step"},
      {"id":"cloud","label":"Clouds","kind":"step"},
      {"id":"rain","label":"Rain","kind":"step"},
      {"id":"river","label":"Rivers","kind":"end"}],
     "edges":[{"from":"sea","to":"vapour","label":"evaporation"},{"from":"vapour","to":"cloud"},{"from":"cloud","to":"rain"},
              {"from":"rain","to":"river"},{"from":"river","to":"sea","label":"flows back"},{"from":"rain","to":"sea"}]}
    """

    private func spec(_ s: String) -> DiagramSpec? { if case .success(let d) = DiagramLogic.parse(s) { return d }; return nil }

    func testAGoodDiagramIsRead() {
        let d = spec(good)!
        XCTAssertEqual(d.title, "Water cycle")
        XCTAssertEqual(d.nodes.map(\.id), ["sea", "vapour", "cloud", "rain", "river"])
        XCTAssertEqual(d.nodes[0].kind, .start)
        XCTAssertEqual(d.edges.count, 6)
        XCTAssertEqual(d.edges[0].label, "evaporation")
    }

    func testBadDiagramsAreRefusedWithReasons() {
        XCTAssertEqual(DiagramLogic.parse("no json here"), .failure(.noJSON))
        guard case .failure(.invalid(let p)) = DiagramLogic.parse(#"{"nodes":[{"id":"a","label":"A"},{"id":"A","label":"Again"},{"id":"b","label":""}],"edges":[{"from":"a","to":"zzz"}]}"#) else { return XCTFail() }
        XCTAssertTrue(p.contains { $0.contains("used twice") })
        XCTAssertTrue(p.contains { $0.contains("no label") })
        XCTAssertTrue(p.contains { $0.contains("does not exist") })
        guard case .failure(.invalid(let none)) = DiagramLogic.parse(#"{"nodes":[]}"#) else { return XCTFail() }
        XCTAssertTrue(none.contains { $0.contains("no boxes") })
        let many = (0..<30).map { #"{"id":"n\#($0)","label":"N"}"# }.joined(separator: ",")
        guard case .failure(.invalid(let big)) = DiagramLogic.parse("{\"nodes\":[\(many)]}") else { return XCTFail() }
        XCTAssertTrue(big.contains { $0.contains("Too many boxes") })
    }

    func testSelfArrowsAndRepeatsAreDroppedAndUnknownKindsBecomeSteps() {
        let d = spec(#"{"nodes":[{"id":"a","label":"A","kind":"banana"},{"id":"b","label":"B"}],"edges":[{"from":"a","to":"a"},{"from":"a","to":"b"},{"from":"A","to":"B"}]}"#)!
        XCTAssertEqual(d.edges, [DiagramEdge(from: "a", to: "b", label: "")])
        XCTAssertEqual(d.nodes[0].kind, .step)
        XCTAssertEqual(d.title, "Diagram")
    }

    func testBoxesAreLaidOutInRowsBelowWhatPointsAtThem() {
        let d = spec(good)!
        let l = DiagramLogic.layout(d)
        XCTAssertEqual(l.rows, 5)
        XCTAssertEqual(["sea", "vapour", "cloud", "rain", "river"].map { l.places[$0]!.row }, [0, 1, 2, 3, 4])
        XCTAssertEqual(l.widest, 1)
        XCTAssertEqual(DiagramLogic.backEdges(d).map { d.edges[$0].from }.sorted(), ["rain", "river"], "the arrows back to the sea close loops")
        let c = l.centre("sea")!
        XCTAssertEqual(c.x, 0.5, accuracy: 1e-9); XCTAssertEqual(c.y, 0.1, accuracy: 1e-9)
    }

    func testABranchSharesARowAndKeepsItsParentsOrder() {
        let d = spec(#"{"nodes":[{"id":"q","label":"Q","kind":"decision"},{"id":"x","label":"X"},{"id":"no","label":"No"},{"id":"yes","label":"Yes"},{"id":"z","label":"Z"}],"edges":[{"from":"q","to":"yes"},{"from":"q","to":"no"},{"from":"x","to":"z"},{"from":"yes","to":"z"}]}"#)!
        let l = DiagramLogic.layout(d)
        XCTAssertEqual(l.places["q"]!.row, 0); XCTAssertEqual(l.places["x"]!.row, 0)
        XCTAssertEqual(l.places["yes"]!.row, 1); XCTAssertEqual(l.places["no"]!.row, 1)
        XCTAssertEqual(l.places["z"]!.row, 2, "below the lowest box that points at it")
        XCTAssertEqual(l.widest, 2)
        XCTAssertEqual(l.places["no"]!.slot, 0, "ties keep the order the boxes were given in")
        XCTAssertEqual(l.places["yes"]!.inRow, 2)
    }

    func testALoopOfTwoStillLaysOut() {
        let d = spec(#"{"nodes":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"edges":[{"from":"a","to":"b"},{"from":"b","to":"a"}]}"#)!
        let l = DiagramLogic.layout(d)
        XCTAssertEqual(l.rows, 2)
        XCTAssertEqual(l.places["a"]!.row, 0); XCTAssertEqual(l.places["b"]!.row, 1)
        XCTAssertTrue(DiagramLogic.nodeQuestion(d.nodes[0], in: d).contains("“A”"))
    }

    // MARK: 3D files

    func testWhich3DFilesOpen() {
        XCTAssertTrue(ModelFileLogic.canOpen(fileName: "Chair.USDZ"))
        XCTAssertTrue(ModelFileLogic.canOpen(fileName: "part.v2.stl"))
        XCTAssertFalse(ModelFileLogic.canOpen(fileName: "photo.png"))
        XCTAssertFalse(ModelFileLogic.canOpen(fileName: "usdz"))
        XCTAssertNil(ModelFileLogic.problem(fileName: "a.obj", bytes: 1_000))
        XCTAssertNotNil(ModelFileLogic.problem(fileName: "a.obj", bytes: 0))
        XCTAssertNotNil(ModelFileLogic.problem(fileName: "a.obj", bytes: ModelFileLogic.maxBytes + 1))
        XCTAssertTrue(ModelFileLogic.problem(fileName: "a.blend", bytes: 10)!.contains(".usdz"))
    }

    func testPartNamesAreMadeReadable() {
        XCTAssertEqual(ModelFileLogic.displayName("Wheel_Front.L_001"), "Wheel Front L")
        XCTAssertEqual(ModelFileLogic.displayName("engineBlock"), "engine Block")
        XCTAssertEqual(ModelFileLogic.displayName("Mesh_012"), "")
        XCTAssertEqual(ModelFileLogic.displayName("Object.003"), "")
        XCTAssertEqual(ModelFileLogic.partNames(["Mesh", "Door_L", "door l", "Roof", "node_4"]), ["Door L", "Roof"])
        XCTAssertEqual(ModelFileLogic.partNames((0..<100).map { "Part\(Character(UnicodeScalar(65 + $0 % 26)!))x\($0 / 26)y" }, limit: 5).count, 5)
        XCTAssertTrue(ModelFileLogic.partQuestion(part: "Roof", fileName: "car.usdz").contains("car.usdz"))
    }
}
