import XCTest

// The Do It agent's pen and magnifier maths (DoItGeometry.swift): strokes, smooth drags and zoomed views. No screen, no events.
final class DoItGeometryTests: XCTestCase {
    private func json(_ text: String) -> Any? { try? JSONSerialization.jsonObject(with: Data(text.utf8)) }

    func testAZoomedViewMapsBackOntoTheWholeScreen() {
        let view = GridRect(x0: 200, y0: 400, x1: 600, y1: 800)
        let p = DoItGeometry.toScreen(GridPoint(x: 500, y: 250), view: view)
        XCTAssertEqual(p.x, 400, accuracy: 0.001)
        XCTAssertEqual(p.y, 500, accuracy: 0.001)
        let corner = DoItGeometry.toScreen(GridPoint(x: 1000, y: 1000), view: view)
        XCTAssertEqual(corner, GridPoint(x: 600, y: 800))
        XCTAssertEqual(DoItGeometry.toScreen(GridPoint(x: 5000, y: -3), view: .full), GridPoint(x: 1000, y: 0), "out of range stays on the screen")
    }

    func testZoomRegionsComposeAndTinyOrFullBoxesResetTheView() {
        let first = DoItGeometry.zoomRegion(x0: 100, y0: 100, x1: 600, y1: 500, in: .full)
        XCTAssertEqual(first, GridRect(x0: 100, y0: 100, x1: 600, y1: 500))
        // a second zoom is asked for on the zoomed picture, and lands inside the first
        let second = DoItGeometry.zoomRegion(x0: 0, y0: 0, x1: 500, y1: 500, in: first!)
        XCTAssertEqual(second, GridRect(x0: 100, y0: 100, x1: 350, y1: 300))
        XCTAssertEqual(DoItGeometry.zoomRegion(x0: 600, y0: 500, x1: 100, y1: 100, in: .full), first, "corners may come in either order")
        XCTAssertNil(DoItGeometry.zoomRegion(x0: 0, y0: 0, x1: 0, y1: 0, in: .full), "no box means look at everything again")
        XCTAssertNil(DoItGeometry.zoomRegion(x0: 300, y0: 300, x1: 320, y1: 900, in: .full), "a sliver is not a zoom")
        XCTAssertNil(DoItGeometry.zoomRegion(x0: 0, y0: 0, x1: 1000, y1: 1000, in: .full))
    }

    func testStrokesAreReadFromTheShapesAnAIActuallySends() {
        let many = DoItGeometry.strokes(from: json("[[[100,100],[200,200]],[[300,300],[400,300],[500,350]]]"))
        XCTAssertEqual(many.count, 2)
        XCTAssertEqual(many[1].count, 3)
        let one = DoItGeometry.strokes(from: json("[[10,20],[30,40],[50,60]]"))
        XCTAssertEqual(one.count, 1, "a bare list of points is one stroke")
        XCTAssertEqual(one[0][2], GridPoint(x: 50, y: 60))
        let loose = DoItGeometry.strokes(from: json(#"[[{"x":1,"y":2},{"x":"30","y":"40.5"}]]"#))
        XCTAssertEqual(loose, [[GridPoint(x: 1, y: 2), GridPoint(x: 30, y: 40.5)]], "objects and numeric strings work")
    }

    func testCoordinatesZeroAndOneSurviveAndOutOfRangeOnesAreClamped() {
        let s = DoItGeometry.strokes(from: json("[[0,0],[1,1],[1500,-20]]"))
        XCTAssertEqual(s, [[GridPoint(x: 0, y: 0), GridPoint(x: 1, y: 1), GridPoint(x: 1000, y: 0)]])
    }

    func testBadOrHugeInputNeverGetsPast() {
        XCTAssertTrue(DoItGeometry.strokes(from: nil).isEmpty)
        XCTAssertTrue(DoItGeometry.strokes(from: "not a list").isEmpty)
        XCTAssertTrue(DoItGeometry.strokes(from: json("[]")).isEmpty)
        XCTAssertTrue(DoItGeometry.strokes(from: json("[[[5,5]]]")).isEmpty, "one point is not a stroke")
        XCTAssertTrue(DoItGeometry.strokes(from: json(#"[[["a","b"],[null,1]]]"#)).isEmpty)
        let flood = "[" + (0..<40).map { _ in "[[0,0],[10,10]]" }.joined(separator: ",") + "]"
        XCTAssertEqual(DoItGeometry.strokes(from: json(flood)).count, DoItGeometry.maxStrokes)
        let longStroke = "[" + (0..<500).map { "[\($0 % 1000),\($0 % 700)]" }.joined(separator: ",") + "]"
        let capped = DoItGeometry.strokes(from: json(longStroke))
        XCTAssertEqual(capped.count, 1)
        XCTAssertEqual(capped[0].count, DoItGeometry.maxPointsPerStroke)
        XCTAssertEqual(capped[0].first, GridPoint(x: 0, y: 0), "the ends of a long stroke are kept")
        XCTAssertEqual(capped[0].last, GridPoint(x: 499, y: 499))
    }

    func testADragIsFilledInSoNoStepIsLong() {
        let line = DoItGeometry.interpolate([GridPoint(x: 0, y: 0), GridPoint(x: 300, y: 400)], maxStep: 10)
        XCTAssertEqual(line.count, 51, "500 units in steps of 10, plus the start")
        XCTAssertEqual(line.first, GridPoint(x: 0, y: 0))
        XCTAssertEqual(line.last?.x ?? 0, 300, accuracy: 0.0001)
        XCTAssertEqual(line.last?.y ?? 0, 400, accuracy: 0.0001)
        for i in 1..<line.count { XCTAssertLessThan(hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y), 10.0001) }
        let corner = DoItGeometry.interpolate([GridPoint(x: 0, y: 0), GridPoint(x: 100, y: 0), GridPoint(x: 100, y: 100)], maxStep: 25)
        XCTAssertTrue(corner.contains(GridPoint(x: 100, y: 0)), "the corner itself is kept")
        XCTAssertEqual(DoItGeometry.interpolate([GridPoint(x: 5, y: 5)], maxStep: 10), [GridPoint(x: 5, y: 5)])
        XCTAssertEqual(DoItGeometry.interpolate([GridPoint(x: 5, y: 5), GridPoint(x: 5, y: 5)], maxStep: 10).count, 2, "a dot stays a dot")
    }
}
