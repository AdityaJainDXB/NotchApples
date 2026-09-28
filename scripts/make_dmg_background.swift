// Renders the DMG window background (660 × 420 pt, @1x and @2x) for build_dmg.sh.
// Vibrant purple gradient, soft glows, frosted tiles, white rounded type.
// Usage: swift scripts/make_dmg_background.swift <output-dir>
//
// Finder draws the item names ("Notch apple", "Applications") itself and
// always in dark text on a custom background — it can't be recoloured — so
// each name sits on a light frosted pill that's part of this image.
import AppKit

let out = CommandLine.arguments[1]
let W: CGFloat = 660, H: CGFloat = 420
// Icon centres — must match scripts/dmg/dmg_settings.py (top-left coordinates).
let iconY: CGFloat = 186
let appX: CGFloat = 180, appsX: CGFloat = 480
// Finder puts a 13 pt name ~83 pt below a 128 pt icon's centre.
let labelY = iconY + 83

func rounded(_ size: CGFloat, _ weight: NSFont.Weight) -> NSFont {
    let base = NSFont.systemFont(ofSize: size, weight: weight)
    return NSFont(descriptor: base.fontDescriptor.withDesign(.rounded) ?? base.fontDescriptor, size: size) ?? base
}

func render(scale: CGFloat) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(W * scale), pixelsHigh: Int(H * scale),
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: W, height: H)
    NSGraphicsContext.saveGraphicsState()
    let gctx = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = gctx
    // Use a flipped context so y grows downwards, like Finder's icon positions.
    let flipped = NSGraphicsContext(cgContext: gctx.cgContext, flipped: true)
    NSGraphicsContext.current = flipped
    let ctx = flipped.cgContext
    ctx.translateBy(x: 0, y: H); ctx.scaleBy(x: 1, y: -1)

    // Base gradient: deep violet → purple → magenta.
    NSGradient(colors: [NSColor(red: 0.13, green: 0.04, blue: 0.33, alpha: 1),
                        NSColor(red: 0.40, green: 0.16, blue: 0.84, alpha: 1),
                        NSColor(red: 0.86, green: 0.30, blue: 0.74, alpha: 1)])!
        .draw(in: NSRect(x: 0, y: 0, width: W, height: H), angle: -35)

    func glow(_ c: CGPoint, _ r: CGFloat, _ color: NSColor) {
        NSGradient(colors: [color, color.withAlphaComponent(0)])!
            .draw(fromCenter: c, radius: 0, toCenter: c, radius: r, options: [])
    }
    glow(CGPoint(x: 70, y: 40), 280, NSColor(red: 0.45, green: 0.78, blue: 1, alpha: 0.42))
    glow(CGPoint(x: 620, y: 400), 300, NSColor(red: 1, green: 0.55, blue: 0.85, alpha: 0.42))
    glow(CGPoint(x: W / 2, y: iconY), 240, NSColor.white.withAlphaComponent(0.08))

    // Frosted tiles, each holding an icon and its name pill.
    for x in [appX, appsX] {
        let tile = NSRect(x: x - 92, y: iconY - 84, width: 184, height: 204)
        NSColor.white.withAlphaComponent(0.11).setFill()
        NSBezierPath(roundedRect: tile, xRadius: 36, yRadius: 36).fill()
        NSColor.white.withAlphaComponent(0.24).setStroke()
        let border = NSBezierPath(roundedRect: tile.insetBy(dx: 0.5, dy: 0.5), xRadius: 36, yRadius: 36)
        border.lineWidth = 1; border.stroke()
        // Light pill behind Finder's (dark) item name.
        let pill = NSRect(x: x - 68, y: labelY - 12, width: 136, height: 24)
        NSColor.white.withAlphaComponent(0.82).setFill()
        NSBezierPath(roundedRect: pill, xRadius: 12, yRadius: 12).fill()
    }

    // Arrow, vertically centred on the icons.
    NSColor.white.withAlphaComponent(0.92).setStroke()
    let arrow = NSBezierPath()
    arrow.move(to: CGPoint(x: appX + 104, y: iconY))
    arrow.line(to: CGPoint(x: appsX - 110, y: iconY))
    arrow.lineWidth = 4; arrow.lineCapStyle = .round
    arrow.setLineDash([10, 9], count: 2, phase: 0)
    arrow.stroke()
    let tip = CGPoint(x: appsX - 102, y: iconY)
    let head = NSBezierPath()
    head.move(to: CGPoint(x: tip.x - 15, y: tip.y - 12)); head.line(to: tip); head.line(to: CGPoint(x: tip.x - 15, y: tip.y + 12))
    head.lineWidth = 4; head.lineCapStyle = .round; head.lineJoinStyle = .round
    head.stroke()

    // White, centred text with a soft shadow for legibility.
    func text(_ s: String, centerY: CGFloat, font: NSFont, alpha: CGFloat) {
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.28)
        shadow.shadowBlurRadius = 6
        shadow.shadowOffset = NSSize(width: 0, height: -1)
        let style = NSMutableParagraphStyle(); style.alignment = .center
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.white.withAlphaComponent(alpha),
                                                   .paragraphStyle: style, .shadow: shadow]
        let str = NSAttributedString(string: s, attributes: attrs)
        let h = str.size().height
        str.draw(in: NSRect(x: 0, y: centerY - h / 2, width: W, height: h))
    }
    text("Notch apple", centerY: 44, font: rounded(28, .bold), alpha: 1)
    text("Drag the app onto Applications to install", centerY: 76, font: rounded(14, .medium), alpha: 0.88)
    text("Then open it from Applications or Spotlight", centerY: 356, font: rounded(12.5, .regular), alpha: 0.78)

    NSGraphicsContext.restoreGraphicsState()
    return rep
}

let reps = [render(scale: 1), render(scale: 2)]
let tiff = NSBitmapImageRep.tiffRepresentationOfImageReps(in: reps, using: .lzw, factor: 0)!
try! tiff.write(to: URL(fileURLWithPath: out + "/dmg-background.tiff"))
try! reps[1].representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out + "/dmg-background-preview.png"))
print("wrote \(out)/dmg-background.tiff")
