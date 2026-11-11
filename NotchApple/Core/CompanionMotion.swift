//
//  CompanionMotion.swift
//  Notch Apple
//
//  The maths behind NotchAI's green dot, kept free of AppKit views so it is unit tested: where the dot heads,
//  how it eases there, when it has settled (so its timer can stop) and how strong the motion trail is.
//

import CoreGraphics
import Foundation

enum CompanionMotion {
    /// Where the dot is heading. It only moves when the pointer is further than `followDistance`, and then stops
    /// that far short of it, so it trails the pointer and never backs away from it.
    static func goal(pointer: CGPoint, dot: CGPoint, followDistance: CGFloat) -> CGPoint {
        let dx = pointer.x - dot.x, dy = pointer.y - dot.y
        let d = hypot(dx, dy)
        guard d > followDistance, d > 0.0001 else { return dot }
        let k = (d - followDistance) / d
        return CGPoint(x: dot.x + dx * k, y: dot.y + dy * k)
    }

    /// Frame-rate independent exponential smoothing. `speed` 0.1 (lazy) ... 1 (nearly instant).
    static func step(from: CGPoint, to: CGPoint, speed: Double, dt: Double) -> CGPoint {
        let rate = 3 + 22 * min(max(speed, 0.05), 1)            // per second
        let a = CGFloat(1 - exp(-rate * dt))
        return CGPoint(x: from.x + (to.x - from.x) * a, y: from.y + (to.y - from.y) * a)
    }

    static func isSettled(pos: CGPoint, goal: CGPoint) -> Bool { hypot(goal.x - pos.x, goal.y - pos.y) < 0.15 }

    static func isOver(pointer: CGPoint, dot: CGPoint, radius: CGFloat) -> Bool { hypot(pointer.x - dot.x, pointer.y - dot.y) <= radius }

    /// 0 below ~350 pt/s, ramping to 1 at ~1600 pt/s: the trail only shows on fast movement.
    static func trailStrength(velocity: CGFloat) -> CGFloat {
        min(max((velocity - 350) / 1250, 0), 1)
    }
}

