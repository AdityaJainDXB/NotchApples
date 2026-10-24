//
//  HelloAnimation.swift
//  Notch Apple
//
//  A hello from the notch, in the style of the Mac's own: when the app starts and each time the Mac wakes up, the notch
//  grows, "hello" is written out in the Mac's own flowing lettering, your name appears under it, then the notch shrinks back. The name is asked for once
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
        alert.informativeText = "When you open your Mac, the notch writes you a hello. Your name stays on this Mac."
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
        guard isOn, !SettingsManager.shared.isNotchHidden, !MeetingMode.shared.active, force || Date().timeIntervalSince(lastShown) > 20,
              let screen = NSScreen.screens.first(where: { $0.safeAreaInsets.top > 0 }) ?? NSScreen.main else { return }
        lastShown = Date()
        panel?.orderOut(nil)
        let notchH = max(screen.safeAreaInsets.top, screen.frame.maxY - screen.visibleFrame.maxY, 24)
        let size = CGSize(width: 420, height: notchH + (name.isEmpty ? 92 : 112))
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

/// The animation itself, in the style of the Mac's own "hello": the black notch grows down, "hello" is written out in a
/// flowing script stroke by stroke in shifting colours, fills in, your name appears under it, and the notch folds away.
private struct HelloView: View {
    let greeting: String
    let notchHeight: CGFloat
    let done: () -> Void
    @State private var grown = false
    @State private var stroke1: CGFloat = 0
    @State private var stroke2: CGFloat = 0
    @State private var nameOn = false

    private var name: String { HelloAnimation.name }

    var body: some View {
        GeometryReader { g in
            let w = g.size.width, h = g.size.height
            ZStack(alignment: .top) {
                UnevenRoundedRectangle(bottomLeadingRadius: 26, bottomTrailingRadius: 26, style: .continuous)
                    .fill(Color.black)
                    .frame(width: grown ? w : 180, height: grown ? h : notchHeight)
                    .frame(maxWidth: .infinity)
                let ink = LinearGradient(colors: [Color(red: 0.36, green: 0.78, blue: 1), Color(red: 0.75, green: 0.5, blue: 1), Color(red: 1, green: 0.45, blue: 0.62), Color(red: 1, green: 0.74, blue: 0.3)], startPoint: .leading, endPoint: .trailing)
                let line = StrokeStyle(lineWidth: w * 0.58 * 14.89 / 638, lineCap: .round, lineJoin: .round)   // as thick as the original lettering
                ZStack {
                    HelloStroke(d: HelloStroke.h1).trim(from: 0, to: stroke1).stroke(ink, style: line).opacity(stroke1 > 0 ? 1 : 0)
                    HelloStroke(d: HelloStroke.h2).trim(from: 0, to: stroke2).stroke(ink, style: line).opacity(stroke2 > 0 ? 1 : 0)
                }
                .frame(width: w * 0.58, height: (w * 0.58) * 200 / 638)
                .offset(y: notchHeight + 6)
                .opacity(grown ? 1 : 0)
                if !name.isEmpty && nameOn {
                    // The name comes into focus word by word.
                    BlurRevealText(text: name, stagger: 0.09)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.92))
                        .offset(y: h - 26)
                        .transition(.opacity)
                }
            }
            .frame(width: w, height: h, alignment: .top)
            .clipped()
        }
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.82)) { grown = true }
            // The Mac's own hello timing: the first stroke of the h, then the rest of "hello" in one flowing line.
            withAnimation(.easeInOut(duration: 0.8).delay(0.3)) { stroke1 = 1 }
            withAnimation(.easeInOut(duration: 2.8).delay(1.0)) { stroke2 = 1 }
            withAnimation(.easeOut(duration: 0.5).delay(3.6)) { nameOn = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 5.2) { withAnimation(.easeInOut(duration: 0.45)) { grown = false; nameOn = false } }
            DispatchQueue.main.asyncAfter(deadline: .now() + 5.75) { done() }
        }
    }
}

/// One stroke of the Mac's handwritten "hello" (its SVG path, 638 x 200), scaled to fit. Drawn bit by bit with `trim`.
private struct HelloStroke: Shape {
    let d: String
    static let h1 = "M8.69214 166.553C36.2393 151.239 61.3409 131.548 89.8191 98.0295C109.203 75.1488 119.625 49.0228 120.122 31.0026C120.37 17.6036 113.836 7.43883 101.759 7.43883C88.3598 7.43883 79.9231 17.6036 74.7122 40.9363C69.005 66.5793 64.7866 96.0036 54.1166 190.356"
    static let h2 = "M55.1624 181.135C60.6251 133.114 81.4118 98.0479 107.963 98.0479C123.844 98.0479 133.937 110.703 131.071 128.817C129.457 139.487 127.587 150.405 125.408 163.06C122.869 178.941 130.128 191.348 152.122 191.348C184.197 191.348 219.189 173.523 237.097 145.915C243.198 136.509 245.68 128.073 245.928 119.884C246.176 104.996 237.739 93.8296 222.851 93.8296C203.992 93.8296 189.6 115.17 189.6 142.465C189.6 171.745 205.481 192.341 239.208 192.341C285.066 192.341 335.86 137.292 359.199 75.8585C365.788 58.513 368.26 42.4065 368.26 31.1512C368.26 17.8057 364.042 7.55823 352.131 7.55823C340.469 7.55823 332.777 16.6141 325.829 30.9129C317.688 47.4967 311.667 71.4162 309.203 98.4549C303 166.301 316.896 191.348 349.936 191.348C390 191.348 434.542 135.534 457.286 75.6686C463.803 58.513 466.275 42.4065 466.275 31.1512C466.275 17.8057 462.057 7.55823 450.146 7.55823C438.484 7.55823 430.792 16.6141 423.844 30.9129C415.703 47.4967 409.682 71.4162 407.218 98.4549C401.015 166.301 414.911 191.348 444.416 191.348C473.874 191.348 489.877 165.67 499.471 138.402C508.955 111.447 520.618 94.8221 544.935 94.8221C565.035 94.8221 580.916 109.71 580.916 137.75C580.916 168.768 560.792 192.093 535.362 192.341C512.984 192.589 498.285 174.475 499.774 147.179C501.511 116.907 519.873 94.8221 543.943 94.8221C557.839 94.8221 569.51 100.999 578.682 107.725C603.549 125.866 622.709 114.656 630.047 96.7186"
    func path(in rect: CGRect) -> Path {
        var p = Path(), nums: [CGFloat] = [], cmd: Character = "M"
        func flush() {
            switch cmd {
            case "M": if nums.count >= 2 { p.move(to: CGPoint(x: nums[0], y: nums[1])) }
            case "L": if nums.count >= 2 { p.addLine(to: CGPoint(x: nums[0], y: nums[1])) }
            case "C": var i = 0; while i + 5 < nums.count { p.addCurve(to: CGPoint(x: nums[i + 4], y: nums[i + 5]), control1: CGPoint(x: nums[i], y: nums[i + 1]), control2: CGPoint(x: nums[i + 2], y: nums[i + 3])); i += 6 }
            default: break
            }
            nums = []
        }
        var token = ""
        for ch in d + " " {
            if "MLC".contains(ch) { if !token.isEmpty { nums.append(CGFloat(Double(token) ?? 0)); token = "" }; flush(); cmd = ch }
            else if ch == " " || ch == "," { if !token.isEmpty { nums.append(CGFloat(Double(token) ?? 0)); token = "" } }
            else { token.append(ch) }
        }
        flush()
        let k = min(rect.width / 638, rect.height / 200)
        return p.applying(CGAffineTransform(translationX: rect.midX - 319 * k, y: rect.midY - 100 * k).scaledBy(x: k, y: k))
    }
}
