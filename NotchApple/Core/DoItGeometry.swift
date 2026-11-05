//
//  DoItGeometry.swift
//  Notch Apple
//
//  The geometry behind the Do It agent's pen and magnifier (Ultimate): reading pen strokes the AI asks for, filling them in so a
//  drawing app sees a smooth drag, and mapping a zoomed-in view back onto the whole screen. Positions are on the same 0 to 1000 grid
//  the agent already uses (0,0 top left, 1000,1000 bottom right). No screen and no events here, so it can be tested.
//

import Foundation

struct GridPoint: Equatable {
    var x: Double
    var y: Double
}

/// A rectangle on the 0 to 1000 grid of the whole screen.
struct GridRect: Equatable {
    var x0: Double, y0: Double, x1: Double, y1: Double
    static let full = GridRect(x0: 0, y0: 0, x1: 1000, y1: 1000)
    var width: Double { x1 - x0 }
    var height: Double { y1 - y0 }
}

enum DoItGeometry {
    /// Pen strokes in one action, points in one stroke: enough for a graph or a few handwritten symbols, never a flood of events.
    static let maxStrokes = 12
    static let maxPointsPerStroke = 80
    /// The smallest part of the view a zoom may ask for (grid units), so a mistaken tiny box does not blow the screen up.
    static let minZoomSpan = 40.0

    private static func clamp(_ v: Double) -> Double { min(max(v, 0), 1000) }

    /// A point on a view (0 to 1000 over `view`) as the same place on the whole screen (0 to 1000).
    static func toScreen(_ p: GridPoint, view: GridRect) -> GridPoint {
        GridPoint(x: view.x0 + clamp(p.x) / 1000 * view.width, y: view.y0 + clamp(p.y) / 1000 * view.height)
    }

    /// The part of the whole screen a zoom covers when the AI names two corners on the current view. Nil means "show the whole screen again":
    /// no box, a box that is not really a box, or one smaller than `minZoomSpan` in either direction.
    static func zoomRegion(x0: Double, y0: Double, x1: Double, y1: Double, in view: GridRect) -> GridRect? {
        let lowX = clamp(min(x0, x1)), highX = clamp(max(x0, x1)), lowY = clamp(min(y0, y1)), highY = clamp(max(y0, y1))
        guard highX - lowX >= minZoomSpan, highY - lowY >= minZoomSpan else { return nil }
        let a = toScreen(GridPoint(x: lowX, y: lowY), view: view), b = toScreen(GridPoint(x: highX, y: highY), view: view)
        let r = GridRect(x0: a.x, y0: a.y, x1: b.x, y1: b.y)
        return r == .full ? nil : r
    }

    private static func number(_ any: Any?) -> Double? {
        if let n = any as? NSNumber { return n.doubleValue.isFinite ? n.doubleValue : nil }
        if let s = any as? String, let d = Double(s.trimmingCharacters(in: .whitespaces)), d.isFinite { return d }
        return nil
    }

    private static func point(_ any: Any?) -> GridPoint? {
        if let pair = any as? [Any], pair.count >= 2, let x = number(pair[0]), let y = number(pair[1]) { return GridPoint(x: clamp(x), y: clamp(y)) }
        if let obj = any as? [String: Any], let x = number(obj["x"]), let y = number(obj["y"]) { return GridPoint(x: clamp(x), y: clamp(y)) }
        return nil
    }

    /// Strokes from what the AI sent: a list of strokes `[[[x,y],[x,y]],[[x,y],...]]`, or one stroke `[[x,y],[x,y]]`. Points may be pairs or
    /// `{"x":..,"y":..}`, numbers or numeric strings; all are kept on the grid. Strokes with fewer than two usable points are dropped, and the
    /// counts are capped (`maxStrokes`, `maxPointsPerStroke`) so one reply cannot flood the machine with mouse events.
    static func strokes(from any: Any?) -> [[GridPoint]] {
        guard let list = any as? [Any], !list.isEmpty else { return [] }
        let candidates: [[Any]]
        if point(list[0]) != nil { candidates = [list] }                              // one stroke: a list of points
        else { candidates = list.compactMap { $0 as? [Any] } }
        var out: [[GridPoint]] = []
        for raw in candidates.prefix(maxStrokes) {
            var pts = raw.compactMap(point)
            if pts.count > maxPointsPerStroke {                                         // keep the shape: sample evenly, keep both ends
                let step = Double(pts.count - 1) / Double(maxPointsPerStroke - 1)
                pts = (0..<maxPointsPerStroke).map { pts[Int((Double($0) * step).rounded())] }
            }
            if pts.count >= 2 { out.append(pts) }
        }
        return out
    }

    /// Adds points along each segment so that no step is longer than `maxStep` grid units: a drawing app then gets a smooth drag instead of
    /// a few jumps (a line from corner to corner becomes dozens of small moves).
    static func interpolate(_ pts: [GridPoint], maxStep: Double) -> [GridPoint] {
        guard let first = pts.first, maxStep > 0 else { return pts }
        var out = [first]
        for i in 1..<pts.count {
            let a = pts[i - 1], b = pts[i]
            let dist = hypot(b.x - a.x, b.y - a.y)
            let n = max(1, Int((dist / maxStep).rounded(.up)))
            for k in 1...n { let t = Double(k) / Double(n); out.append(GridPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)) }
        }
        return out
    }
}
