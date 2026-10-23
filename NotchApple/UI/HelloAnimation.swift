//
//  HelloAnimation.swift
//  Notch Apple
//
//  A hello from the notch: when the app starts and each time the Mac wakes up, the notch grows a little, a Formula One
//  car races across it and leaves "Hello, <name>!" behind, then the notch shrinks back. The name is asked for once
//  (Settings → Notch Extras changes it or turns the hello off). Nothing is sent anywhere; the name stays on this Mac.
//

import AppKit
import SwiftUI

@MainActor
enum HelloAnimation {
    static let nameKey = "hello.name", onKey = "hello.enabled", askedKey = "hello.asked"
    static var name: String { (UserDefaults.standard.string(forKey: nameKey) ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    static var isOn: Bool { UserDefaults.standard.object(forKey: onKey) as? Bool ?? true }

    private static var panel: NSPanel?
    private static var lastShown = Date.distantPast

    /// At launch: ask for the name the first time, then say hello.
    static func start() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            if !UserDefaults.standard.bool(forKey: askedKey) { askName() }
            show()
        }
    }

    /// Asks what the notch should call you (once; Settings can change it).
    static func askName() {
        UserDefaults.standard.set(true, forKey: askedKey)
        let alert = NSAlert()
        alert.messageText = "What's your name?"
        alert.informativeText = "When you open your Mac, the notch says hello with a Formula One car going by. Your name stays on this Mac."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        field.placeholderString = NSFullUserName().components(separatedBy: " ").first ?? "Your name"
        field.stringValue = name
        alert.accessoryView = field
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Not now")
        NSApp.activate(ignoringOtherApps: true)
        alert.window.initialFirstResponder = field
        if alert.runModal() == .alertFirstButtonReturn {
            UserDefaults.standard.set(String(field.stringValue.prefix(24)), forKey: nameKey)
        }
    }

    /// Plays the hello (at most once every 20 seconds, and never while the notch is hidden or the hello is off).
    static func show(force: Bool = false) {
        guard isOn, !SettingsManager.shared.isNotchHidden, force || Date().timeIntervalSince(lastShown) > 20,
              let screen = NSScreen.screens.first(where: { $0.safeAreaInsets.top > 0 }) ?? NSScreen.main else { return }
        lastShown = Date()
        panel?.orderOut(nil)
        let notchH = max(screen.safeAreaInsets.top, screen.frame.maxY - screen.visibleFrame.maxY, 24)
        let size = CGSize(width: 440, height: notchH + 54)
        let p = NSPanel(contentRect: NSRect(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY - size.height, width: size.width, height: size.height),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false
        p.level = .statusBar + 2; p.ignoresMouseEvents = true
        p.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        let greeting = name.isEmpty ? "Hello!" : "Hello, \(name)!"
        p.contentView = NSHostingView(rootView: HelloView(greeting: greeting, notchHeight: notchH) { close(p) })
        p.orderFrontRegardless()
        panel = p
    }

    private static func close(_ p: NSPanel) { p.orderOut(nil); if panel === p { panel = nil } }
}

/// The animation itself: the black notch grows down, the car crosses, the greeting fades in behind it, and it all folds away.
private struct HelloView: View {
    let greeting: String
    let notchHeight: CGFloat
    let done: () -> Void
    @State private var grown = false
    @State private var carX: CGFloat = -0.25
    @State private var textOn = false

    var body: some View {
        GeometryReader { g in
            let w = g.size.width, h = g.size.height
            ZStack(alignment: .top) {
                UnevenRoundedRectangle(bottomLeadingRadius: 22, bottomTrailingRadius: 22, style: .continuous)
                    .fill(Color.black)
                    .frame(width: grown ? w : 180, height: grown ? h : notchHeight)
                    .frame(maxWidth: .infinity)
                Text(greeting)
                    .font(.system(size: 17, weight: .heavy, design: .rounded))
                    .foregroundStyle(LinearGradient(colors: [.white, Color(red: 1, green: 0.85, blue: 0.4)], startPoint: .leading, endPoint: .trailing))
                    .opacity(textOn ? 1 : 0)
                    .mask(alignment: .leading) { Rectangle().frame(width: max(0, min(w, (carX - 0.05) * w))) }
                    .frame(width: w)
                    .offset(y: notchHeight + 8)
                F1CarShape()
                    .frame(width: 92, height: 26)
                    .offset(x: carX * w - w / 2, y: notchHeight + 12)
                    .opacity(grown ? 1 : 0)
                SpeedLines().stroke(Color.white.opacity(0.35), lineWidth: 1.2)
                    .frame(width: 70, height: 20)
                    .offset(x: carX * w - w / 2 - 80, y: notchHeight + 16)
                    .opacity(grown && carX > 0 && carX < 1.1 ? 1 : 0)
            }
            .frame(width: w, height: h, alignment: .top)
            .clipped()
        }
        .onAppear {
            withAnimation(.spring(response: 0.45, dampingFraction: 0.8)) { grown = true }
            textOn = true
            withAnimation(.easeIn(duration: 1.6).delay(0.35)) { carX = 1.3 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.4) { withAnimation(.easeInOut(duration: 0.4)) { grown = false; textOn = false } }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.9) { done() }
        }
    }
}

/// A Formula One car from the side: nose and front wing, the cockpit with halo and helmet, the engine cover, the rear wing,
/// and two big wheels.
private struct F1CarShape: View {
    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            let red = Color(red: 0.88, green: 0.1, blue: 0.14), dark = Color(white: 0.1)
            var body = Path()
            body.move(to: CGPoint(x: w * 0.02, y: h * 0.72)); body.addLine(to: CGPoint(x: w * 0.3, y: h * 0.56)); body.addLine(to: CGPoint(x: w * 0.52, y: h * 0.42))
            body.addLine(to: CGPoint(x: w * 0.72, y: h * 0.3)); body.addLine(to: CGPoint(x: w * 0.86, y: h * 0.36)); body.addLine(to: CGPoint(x: w * 0.9, y: h * 0.74)); body.closeSubpath()
            ctx.fill(body, with: .color(red))
            ctx.fill(Path(CGRect(x: w * 0.0, y: h * 0.7, width: w * 0.14, height: h * 0.08)), with: .color(dark))            // front wing
            ctx.fill(Path(CGRect(x: w * 0.86, y: h * 0.12, width: w * 0.12, height: h * 0.12)), with: .color(dark))          // rear wing
            ctx.fill(Path(CGRect(x: w * 0.93, y: h * 0.12, width: w * 0.03, height: h * 0.5)), with: .color(dark))
            ctx.fill(Path(ellipseIn: CGRect(x: w * 0.5, y: h * 0.24, width: w * 0.08, height: h * 0.22)), with: .color(.yellow)) // helmet
            var halo = Path(); halo.move(to: CGPoint(x: w * 0.46, y: h * 0.42)); halo.addQuadCurve(to: CGPoint(x: w * 0.64, y: h * 0.28), control: CGPoint(x: w * 0.5, y: h * 0.18))
            ctx.stroke(halo, with: .color(dark), lineWidth: 1.6)
            for x in [0.2, 0.78] {
                let r = CGRect(x: w * x - h * 0.3, y: h * 0.42, width: h * 0.6, height: h * 0.6)
                ctx.fill(Path(ellipseIn: r), with: .color(dark))
                ctx.fill(Path(ellipseIn: r.insetBy(dx: h * 0.16, dy: h * 0.16)), with: .color(Color(white: 0.55)))
            }
        }
    }
}

private struct SpeedLines: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        for (i, y) in [0.2, 0.5, 0.8].enumerated() { p.move(to: CGPoint(x: r.minX + CGFloat(i) * 8, y: r.height * y)); p.addLine(to: CGPoint(x: r.maxX, y: r.height * y)) }
        return p
    }
}
