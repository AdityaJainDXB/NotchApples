// Renders the Notch apple app icon (purple gradient squircle with a notch pill) to an .iconset.
import AppKit
let out = CommandLine.arguments[1]
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
  for scale in [1, 2] {
    let px = base * scale
    let s = CGFloat(px)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let inset = s * 0.1
    let rect = NSRect(x: inset, y: inset, width: s - 2*inset, height: s - 2*inset)
    let path = NSBezierPath(roundedRect: rect, xRadius: rect.width * 0.225, yRadius: rect.width * 0.225)
    NSGradient(colors: [NSColor(red: 0.78, green: 0.62, blue: 1, alpha: 1), NSColor(red: 0.42, green: 0.18, blue: 0.85, alpha: 1), NSColor(red: 0.12, green: 0.05, blue: 0.24, alpha: 1)])!.draw(in: path, angle: -60)
    // Notch pill
    let pw = rect.width * 0.5, ph = rect.height * 0.14
    let pill = NSBezierPath(roundedRect: NSRect(x: rect.midX - pw/2, y: rect.maxY - ph - rect.height*0.08, width: pw, height: ph), xRadius: ph/2, yRadius: ph/2)
    NSColor.black.withAlphaComponent(0.85).setFill(); pill.fill()
    // Sparkle dot
    let d = rect.width * 0.22
    let dot = NSBezierPath(ovalIn: NSRect(x: rect.midX - d/2, y: rect.midY - d*0.8, width: d, height: d))
    NSColor.white.withAlphaComponent(0.92).setFill(); dot.fill()
    NSGraphicsContext.restoreGraphicsState()
    let name = scale == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png"
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out + "/" + name))
  }
}
