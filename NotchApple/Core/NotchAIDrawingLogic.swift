//
//  NotchAIDrawingLogic.swift
//  Notch Apple
//
//  Drawing on the screen, as pure rules (CoreGraphics only, unit tested):
//   • Your own drawing: while Control and Option are held, the pointer leaves a line on the screen. This file decides
//     when a line starts and ends, keeps it within limits, lets old lines fade, and works out the area you drew
//     around so NotchAI can be asked about just that.
//   • Hand-drawn style: boxes, circles and arrows drawn as slightly wobbly lines, the way a person would sketch them.
//     The wobble comes from the shape's own geometry, so the same shape is drawn the same way every time (no shimmer).
//  Stroke points are fractions of the screen (0...1) with the origin at the TOP left, like the other annotations.
//

import CoreGraphics
import Foundation

struct DrawnStroke: Equatable {
    var points: [CGPoint]
    /// nil while the line is still being drawn.
    var finishedAt: Date?
}

enum DrawingLogic {
    static let maxStrokes = 40
    static let maxPoints = 1_500
    /// A new point is kept only if it is at least this far (as a fraction of the screen) from the last one.
    static let minStep: CGFloat = 0.0015
    /// A finished line fades away after this long.
    static let lifetime: TimeInterval = 20

    /// Drawing needs exactly Control and Option, so ordinary shortcuts never leave a line.
    static func shouldDraw(control: Bool, option: Bool, command: Bool, shift: Bool) -> Bool {
        control && option && !command && !shift
    }

    /// A point in AppKit screen coordinates (origin bottom-left) as a fraction of `frame`, origin top-left. nil outside.
    static func fraction(of point: CGPoint, in frame: CGRect) -> CGPoint? {
        guard frame.width > 0, frame.height > 0, frame.contains(point) else { return nil }
        return CGPoint(x: (point.x - frame.minX) / frame.width, y: (frame.maxY - point.y) / frame.height)
    }

    /// The strokes after the pointer moved to `point` (a fraction; nil = off this screen). `drawing`: the keys are held.
    static func extend(_ strokes: [DrawnStroke], with point: CGPoint?, drawing: Bool, now: Date) -> [DrawnStroke] {
        var out = strokes
        let open = out.last.map { $0.finishedAt == nil } ?? false
        guard drawing, let point else {
            if open {
                if out[out.count - 1].points.count < 2 { out.removeLast() }      // a dot is not a line
                else { out[out.count - 1].finishedAt = now }
            }
            return out
        }
        if open {
            let last = out[out.count - 1].points.last ?? point
            let far = hypot(point.x - last.x, point.y - last.y) >= minStep
            if far, out[out.count - 1].points.count < maxPoints { out[out.count - 1].points.append(point) }
        } else {
            out.append(DrawnStroke(points: [point], finishedAt: nil))
            if out.count > maxStrokes { out.removeFirst(out.count - maxStrokes) }
        }
        return out
    }

    /// Finished lines older than `lifetime` are dropped; a line still being drawn always stays.
    static func visible(_ strokes: [DrawnStroke], now: Date) -> [DrawnStroke] {
        strokes.filter { s in s.finishedAt.map { now.timeIntervalSince($0) < lifetime } ?? true }
    }

    /// The smallest rectangle (fractions, top-left origin) around everything drawn. nil when nothing is drawn.
    static func bounds(of strokes: [DrawnStroke]) -> CGRect? {
        let pts = strokes.flatMap(\.points)
        guard let first = pts.first else { return nil }
        var minX = first.x, maxX = first.x, minY = first.y, maxY = first.y
        for p in pts { minX = min(minX, p.x); maxX = max(maxX, p.x); minY = min(minY, p.y); maxY = max(maxY, p.y) }
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }

    /// A fraction rectangle back in AppKit screen coordinates (origin bottom-left), grown by `padding` points and
    /// clipped to the screen: the area to capture when you ask about what you drew around.
    static func screenRect(_ fraction: CGRect, in frame: CGRect, padding: CGFloat = 24) -> CGRect {
        let r = CGRect(x: frame.minX + fraction.minX * frame.width, y: frame.maxY - fraction.maxY * frame.height,
                       width: fraction.width * frame.width, height: fraction.height * frame.height)
        return r.insetBy(dx: -padding, dy: -padding).intersection(frame)
    }

    static func shapes(_ strokes: [DrawnStroke]) -> [AnnotationShape] {
        strokes.filter { $0.points.count >= 2 }.map { .stroke($0.points) }
    }
}

enum HandDrawn {
    /// A small repeatable random source (SplitMix64): the same seed always gives the same wobble.
    struct RNG {
        var state: UInt64
        mutating func next() -> Double {            // -1 ... 1
            state &+= 0x9E37_79B9_7F4A_7C15
            var z = state
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            z ^= z >> 31
            return Double(z >> 11) / Double(1 << 53) * 2 - 1
        }
    }

    /// A seed from numbers that describe a shape, so a shape keeps its look between redraws.
    static func seed(_ values: CGFloat...) -> UInt64 {
        values.reduce(UInt64(0xCBF2_9CE4_8422_2325)) { h, v in (h ^ UInt64(bitPattern: Int64((v * 16).rounded()))) &* 0x0000_0100_0000_01B3 }
    }

    /// A straight line from `a` to `b` (in points) as a slightly wobbly polyline. The ends stay within `amplitude` of
    /// `a` and `b`, and every point stays within `amplitude` of the true line.
    static func line(from a: CGPoint, to b: CGPoint, seed: UInt64, amplitude: CGFloat = 2.2, step: CGFloat = 14) -> [CGPoint] {
        let length = hypot(b.x - a.x, b.y - a.y)
        guard length > 0.5 else { return [a, b] }
        var rng = RNG(state: seed)
        let n = max(2, Int((length / step).rounded(.up)))
        let nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length          // unit normal
        var drift: CGFloat = 0
        return (0...n).map { i in
            let t = CGFloat(i) / CGFloat(n)
            // A slow drift plus a little jitter, both bounded, so the line bows gently instead of zig-zagging.
            drift = max(-1, min(1, drift * 0.6 + CGFloat(rng.next()) * 0.6))
            let off = drift * amplitude * 0.9
            return CGPoint(x: a.x + (b.x - a.x) * t + nx * off, y: a.y + (b.y - a.y) * t + ny * off)
        }
    }

    /// A rectangle as four wobbly sides drawn in one go (closed).
    static func rect(_ r: CGRect, seed: UInt64, amplitude: CGFloat = 2.2) -> [CGPoint] {
        let c = [CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.maxX, y: r.minY), CGPoint(x: r.maxX, y: r.maxY), CGPoint(x: r.minX, y: r.maxY)]
        var out: [CGPoint] = []
        for i in 0..<4 {
            let side = line(from: c[i], to: c[(i + 1) % 4], seed: seed &+ UInt64(i) &* 977, amplitude: amplitude)
            out.append(contentsOf: i == 0 ? side : Array(side.dropFirst()))
        }
        return out
    }

    /// An ellipse drawn like a person does: a little more than one full turn, the radius wandering slightly.
    static func ellipse(in r: CGRect, seed: UInt64, amplitude: CGFloat = 2.2) -> [CGPoint] {
        var rng = RNG(state: seed)
        let cx = r.midX, cy = r.midY, rx = r.width / 2, ry = r.height / 2
        let n = max(24, Int((rx + ry) / 4))
        let start = CGFloat(rng.next()) * .pi
        var drift: CGFloat = 0
        let turns: CGFloat = 1.06
        return (0...n).map { i in
            let t = CGFloat(i) / CGFloat(n)
            drift = max(-1, min(1, drift * 0.7 + CGFloat(rng.next()) * 0.5))
            let grow = drift * amplitude
            let angle = start + t * turns * 2 * .pi
            return CGPoint(x: cx + (rx + grow) * cos(angle), y: cy + (ry + grow) * sin(angle))
        }
    }
}
