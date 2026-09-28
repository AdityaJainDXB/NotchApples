// Renders the DMG window background (660 × 420 pt, @1x and @2x) for build_dmg.sh.
// Vibrant purple gradient, soft glows, an arrow from the app icon to Applications.
// Usage: swift scripts/make_dmg_background.swift <output-dir>
import AppKit

let out = CommandLine.arguments[1]
let W: CGFloat = 660, H: CGFloat = 420
// Icon centres (must match build_dmg.sh / dmg_settings.py), in top-left coordinates.
let appCenter = CGPoint(x: 180, y: 200), appsCenter = CGPoint(x: 480, y: 200)

func render(scale: CGFloat) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(W * scale), pixelsHigh: Int(H * scale),
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: W, height: H)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let ctx = NSGraphicsContext.current!.cgContext
    // Flip to top-left origin for easier layout.
    ctx.translateBy(x: 0, y: H); ctx.scaleBy(x: 1, y: -1)

    // Base gradient: deep violet → purple → magenta.
    NSGradient(colors: [NSColor(red: 0.16, green: 0.05, blue: 0.38, alpha: 1),
                        NSColor(red: 0.42, green: 0.17, blue: 0.85, alpha: 1),
                        NSColor(red: 0.85, green: 0.30, blue: 0.75, alpha: 1)])!
        .draw(in: NSRect(x: 0, y: 0, width: W, height: H), angle: -35)

    // Soft glows.
    func glow(_ c: CGPoint, _ r: CGFloat, _ color: NSColor) {
        let g = NSGradient(colors: [color, color.withAlphaComponent(0)])!
        g.draw(fromCenter: c, radius: 0, toCenter: c, radius: r, options: [])
    }
    glow(CGPoint(x: 90, y: 60), 260, NSColor(red: 0.45, green: 0.75, blue: 1, alpha: 0.45))
    glow(CGPoint(x: 600, y: 380), 280, NSColor(red: 1, green: 0.55, blue: 0.85, alpha: 0.45))
    glow(CGPoint(x: 330, y: 200), 220, NSColor.white.withAlphaComponent(0.10))

    // Frosted "drop zones" behind each icon.
    for c in [appCenter, appsCenter] {
        let r = NSRect(x: c.x - 82, y: c.y - 82, width: 164, height: 164)
        NSColor.white.withAlphaComponent(0.12).setFill()
        NSBezierPath(roundedRect: r, xRadius: 34, yRadius: 34).fill()
        NSColor.white.withAlphaComponent(0.25).setStroke()
        let border = NSBezierPath(roundedRect: r.insetBy(dx: 0.5, dy: 0.5), xRadius: 34, yRadius: 34)
        border.lineWidth = 1; border.stroke()
    }

    // Dashed arrow.
    let arrow = NSBezierPath()
    arrow.move(to: CGPoint(x: appCenter.x + 96, y: appCenter.y))
    arrow.line(to: CGPoint(x: appsCenter.x - 104, y: appsCenter.y))
    arrow.lineWidth = 4
    arrow.lineCapStyle = .round
    arrow.setLineDash([10, 9], count: 2, phase: 0)
    NSColor.white.withAlphaComponent(0.9).setStroke()
    arrow.stroke()
    let head = NSBezierPath()
    let tip = CGPoint(x: appsCenter.x - 96, y: appsCenter.y)
    head.move(to: CGPoint(x: tip.x - 16, y: tip.y - 12))
    head.line(to: tip)
    head.line(to: CGPoint(x: tip.x - 16, y: tip.y + 12))
    head.lineWidth = 4; head.lineCapStyle = .round; head.lineJoinStyle = .round
    head.stroke()

    // Text (drawn unflipped).
    func text(_ s: String, _ y: CGFloat, _ size: CGFloat, _ weight: NSFont.Weight, _ alpha: CGFloat) {
        let style = NSMutableParagraphStyle(); style.alignment = .center
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size, weight: weight),
                                                   .foregroundColor: NSColor.white.withAlphaComponent(alpha),
                                                   .paragraphStyle: style]
        ctx.saveGState(); ctx.translateBy(x: 0, y: H); ctx.scaleBy(x: 1, y: -1)
        NSString(string: s).draw(in: NSRect(x: 0, y: H - y - size * 1.4, width: W, height: size * 1.6), withAttributes: attrs)
        ctx.restoreGState()
    }
    text("Install Notch apple", 34, 24, .bold, 1)
    text("Drag the app onto the Applications folder", 68, 14, .medium, 0.85)
    text("Then open it from Applications, or with Spotlight.", 360, 12, .regular, 0.7)

    NSGraphicsContext.restoreGraphicsState()
    return rep
}

let reps = [render(scale: 1), render(scale: 2)]
let tiff = NSBitmapImageRep.tiffRepresentationOfImageReps(in: reps, using: .lzw, factor: 0)!
try! tiff.write(to: URL(fileURLWithPath: out + "/dmg-background.tiff"))
try! reps[1].representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out + "/dmg-background-preview.png"))
print("wrote \(out)/dmg-background.tiff")
