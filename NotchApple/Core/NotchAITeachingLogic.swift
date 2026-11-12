//
//  NotchAITeachingLogic.swift
//  Notch Apple
//
//  Teaching mode and screen annotations, as pure rules and drawing (CoreGraphics only, unit tested):
//   • A teaching plan is a short list of steps; each has an instruction, what to point at (the text of a button or label
//     the model names, or a position), and the text that should appear on screen once the step is done.
//   • Pointing: the app finds the named label in the text Apple Vision read from the screen and draws on it. A label
//     that cannot be found is reported, never guessed at.
//   • Progress: a step is done when its expected text is visible; the plan then moves on, re-reading the screen first.
//   • Drawing: arrows, circles, boxes, target rings and numbered badges with a label, drawn into any CGContext (the
//     overlay window uses it, and tests render it to a bitmap).
//  Coordinates are fractions of the screen (0...1) with the origin at the TOP left.
//

import CoreGraphics
import CoreText
import Foundation

enum AnnotationShape: Equatable {
    case arrow(from: CGPoint, to: CGPoint)
    case circle(center: CGPoint, radius: CGFloat)         // radius as a fraction of the screen width
    case box(CGRect)
    case ring(center: CGPoint)                            // a target ring: concentric circles
    case badge(center: CGPoint, number: Int)
    case label(origin: CGPoint, text: String)
}

struct TeachingStep: Equatable {
    var instruction: String
    /// The text of the on-screen element to point at ("Save", "File"), found with OCR. Nil if the step has no target.
    var target: String?
    /// Text that appears when the step is done ("Saved", "Untitled 2"). Empty: the user presses Next.
    var expected: [String] = []
}

struct TeachingPlan: Equatable {
    var goal: String
    var steps: [TeachingStep]
}

struct OCRBox: Equatable {
    var text: String
    /// Normalised, origin BOTTOM-left (Vision's convention).
    var box: CGRect
}

enum TeachingLogic {
    static let maxSteps = 15

    // MARK: Plan from the model's JSON

    /// Reads {"steps":[{"instruction":"…","target":"Save","expected":["Saved"]}]} from a model reply (fenced or chatty).
    static func parse(_ reply: String, goal: String) -> TeachingPlan? {
        guard let s = reply.firstIndex(of: "{"), let e = reply.lastIndex(of: "}"), s < e,
              let obj = (try? JSONSerialization.jsonObject(with: Data(reply[s...e].utf8))) as? [String: Any],
              let raw = obj["steps"] as? [[String: Any]] else { return nil }
        let steps = raw.prefix(maxSteps).compactMap { d -> TeachingStep? in
            guard let ins = (d["instruction"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !ins.isEmpty else { return nil }
            let target = (d["target"] as? String).flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0.trimmingCharacters(in: .whitespaces) }
            let expected = ((d["expected"] as? [String]) ?? ((d["expected"] as? String).map { [$0] } ?? [])).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            return TeachingStep(instruction: ins, target: target, expected: expected)
        }
        return steps.isEmpty ? nil : TeachingPlan(goal: goal, steps: Array(steps))
    }

    static func planPrompt(goal: String, appName: String, screenText: String) -> String {
        """
        The user wants to: \(goal)
        They are in the app: \(appName)
        Text currently visible on their screen:
        \(String(screenText.prefix(3_000)))

        Write a step-by-step walkthrough of at most \(maxSteps) short steps using ONLY menus, buttons and labels that appear in the text above or are standard for this app.
        Reply with ONLY JSON: {"steps":[{"instruction":"<one short sentence>","target":"<exact text of the button or label to point at, or empty>","expected":["<text that appears when the step is done, or empty list>"]}]}
        """
    }

    // MARK: Pointing

    /// The on-screen box (top-left origin, 0...1) of the text that best matches `target`, or nil if it is not there.
    /// Exact (case-insensitive) match wins over a line that contains it; the shortest containing line is preferred.
    static func locate(_ target: String, in boxes: [OCRBox]) -> CGRect? {
        let t = target.lowercased().trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return nil }
        func topLeft(_ b: CGRect) -> CGRect { CGRect(x: b.minX, y: 1 - b.maxY, width: b.width, height: b.height) }
        if let exact = boxes.first(where: { $0.text.lowercased().trimmingCharacters(in: .whitespaces) == t }) { return topLeft(exact.box) }
        let containing = boxes.filter { $0.text.lowercased().contains(t) }.sorted { $0.text.count < $1.text.count }
        return containing.first.map { topLeft($0.box) }
    }

    /// The drawing for a step: a ring and an arrow at the target and a numbered badge with the instruction; or only the
    /// badge and instruction at the top if the target was not found (`found` false), so nothing is drawn in a wrong place.
    static func annotations(step: TeachingStep, number: Int, target: CGRect?) -> [AnnotationShape] {
        guard let r = target else { return [.badge(center: CGPoint(x: 0.05, y: 0.08), number: number), .label(origin: CGPoint(x: 0.08, y: 0.07), text: step.instruction)] }
        let c = CGPoint(x: r.midX, y: r.midY)
        let from = CGPoint(x: min(max(c.x + 0.12, 0.05), 0.95), y: min(max(c.y + 0.1, 0.05), 0.95))
        return [.box(r.insetBy(dx: -0.008, dy: -0.01)), .ring(center: c), .arrow(from: from, to: CGPoint(x: c.x + (r.width / 2) * 0.9, y: c.y + r.height * 0.7)),
                .badge(center: CGPoint(x: r.minX - 0.02, y: r.minY - 0.02), number: number),
                .label(origin: CGPoint(x: min(r.minX + 0.01, 0.6), y: max(r.minY - 0.095, 0.02)), text: step.instruction)]
    }

    // MARK: Progress

    /// Done when every expected text is visible. A step with nothing expected is never auto-completed.
    static func isDone(_ step: TeachingStep, screenText: String) -> Bool {
        guard !step.expected.isEmpty else { return false }
        let t = screenText.lowercased()
        return step.expected.allSatisfy { t.contains($0.lowercased()) }
    }

    /// The step to show after this one, or nil at the end.
    static func next(after index: Int, in plan: TeachingPlan) -> Int? { index + 1 < plan.steps.count ? index + 1 : nil }
}

// MARK: - Drawing

enum AnnotationRenderer {
    static let green = CGColor(red: 0x22 / 255.0, green: 0xC5 / 255.0, blue: 0x5E / 255.0, alpha: 1)

    /// Draws into `ctx`, whose size is `size` points. `flipped`: true when the context's origin is already top-left.
    static func draw(_ shapes: [AnnotationShape], in ctx: CGContext, size: CGSize, flipped: Bool = false) {
        ctx.saveGState()
        if !flipped { ctx.translateBy(x: 0, y: size.height); ctx.scaleBy(x: 1, y: -1) }      // work top-left
        func p(_ pt: CGPoint) -> CGPoint { CGPoint(x: pt.x * size.width, y: pt.y * size.height) }
        ctx.setLineCap(.round); ctx.setLineJoin(.round)
        for s in shapes {
            switch s {
            case .box(let r):
                ctx.setStrokeColor(green); ctx.setLineWidth(3)
                ctx.addPath(CGPath(roundedRect: CGRect(x: r.minX * size.width, y: r.minY * size.height, width: r.width * size.width, height: r.height * size.height),
                                   cornerWidth: 6, cornerHeight: 6, transform: nil)); ctx.strokePath()
            case .circle(let c, let radius):
                ctx.setStrokeColor(green); ctx.setLineWidth(4)
                let rr = radius * size.width, cc = p(c)
                ctx.strokeEllipse(in: CGRect(x: cc.x - rr, y: cc.y - rr, width: rr * 2, height: rr * 2))
            case .ring(let c):
                let cc = p(c)
                for (i, r) in [10.0, 20.0, 32.0].enumerated() {
                    ctx.setStrokeColor(CGColor(red: 0x22 / 255.0, green: 0xC5 / 255.0, blue: 0x5E / 255.0, alpha: 1 - Double(i) * 0.3))
                    ctx.setLineWidth(3)
                    ctx.strokeEllipse(in: CGRect(x: cc.x - r, y: cc.y - r, width: r * 2, height: r * 2))
                }
            case .arrow(let from, let to):
                let a = p(from), b = p(to)
                ctx.setStrokeColor(green); ctx.setLineWidth(5)
                ctx.move(to: a); ctx.addLine(to: b); ctx.strokePath()
                let angle = atan2(b.y - a.y, b.x - a.x), head: CGFloat = 18
                ctx.setFillColor(green)
                ctx.move(to: b)
                ctx.addLine(to: CGPoint(x: b.x - head * cos(angle - .pi / 7), y: b.y - head * sin(angle - .pi / 7)))
                ctx.addLine(to: CGPoint(x: b.x - head * cos(angle + .pi / 7), y: b.y - head * sin(angle + .pi / 7)))
                ctx.closePath(); ctx.fillPath()
            case .badge(let c, let n):
                let cc = p(c), r: CGFloat = 15
                ctx.setFillColor(green); ctx.fillEllipse(in: CGRect(x: cc.x - r, y: cc.y - r, width: r * 2, height: r * 2))
                text("\(n)", at: CGPoint(x: cc.x, y: cc.y), size: 17, color: CGColor(gray: 0, alpha: 1), centered: true, in: ctx, height: size.height)
            case .label(let o, let t):
                let origin = p(o)
                let w = min(CGFloat(t.count) * 8.5 + 24, size.width * 0.5)
                ctx.setFillColor(CGColor(gray: 0, alpha: 0.82))
                ctx.addPath(CGPath(roundedRect: CGRect(x: origin.x, y: origin.y, width: w, height: 34), cornerWidth: 9, cornerHeight: 9, transform: nil)); ctx.fillPath()
                text(t, at: CGPoint(x: origin.x + 12, y: origin.y + 17), size: 14, color: CGColor(gray: 1, alpha: 1), centered: false, in: ctx, height: size.height)
            }
        }
        ctx.restoreGState()
    }

    /// Text drawn upright in a top-left-origin context.
    private static func text(_ s: String, at pt: CGPoint, size: CGFloat, color: CGColor, centered: Bool, in ctx: CGContext, height: CGFloat) {
        let font = CTFontCreateWithName("Helvetica-Bold" as CFString, size, nil)
        let attrs: [NSAttributedString.Key: Any] = [NSAttributedString.Key(rawValue: kCTFontAttributeName as String): font,
                                                    NSAttributedString.Key(rawValue: kCTForegroundColorAttributeName as String): color]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attrs))
        let w = CTLineGetTypographicBounds(line, nil, nil, nil)
        ctx.saveGState()
        ctx.translateBy(x: pt.x - (centered ? CGFloat(w) / 2 : 0), y: pt.y + size * 0.35)
        ctx.scaleBy(x: 1, y: -1)                      // undo the top-left flip for glyphs
        ctx.textPosition = .zero
        CTLineDraw(line, ctx)
        ctx.restoreGState()
    }
}
