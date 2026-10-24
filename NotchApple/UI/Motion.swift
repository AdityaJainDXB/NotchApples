//
//  Motion.swift
//  Notch Apple
//
//  Small native animations, ported from popular web components (21st.dev) to SwiftUI: a shimmer sweep for "working"
//  labels (Shimmer Text), a light that runs round a border (Border Beam), numbers whose digits roll (Animate Digits),
//  words that blur into focus one by one (Blur Reveal), a confetti burst for finishing something (Confetti), a press
//  that dips with a spring (Press Depth), list rows that slide in one after another (Animated List) and three pulsing
//  dots for "thinking" (Loading Pulse Dots). Each follows the iPhone Duo setting and Reduce Motion: with either off,
//  it shows the finished state straight away.
//

import SwiftUI

// MARK: Shimmer Text

/// A soft highlight that sweeps across the view again and again (text that is loading or working).
struct Shimmer: ViewModifier {
    var active: Bool
    @State private var phase: CGFloat = -0.8

    func body(content: Content) -> some View {
        if active && Duo.active {
            content
                .overlay {
                    GeometryReader { g in
                        LinearGradient(colors: [.clear, .white.opacity(0.6), .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: g.size.width * 0.5)
                            .offset(x: phase * g.size.width)
                    }
                    .mask(content)
                    .allowsHitTesting(false)
                }
                .onAppear { withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) { phase = 1.3 } }
        } else {
            content
        }
    }
}

// MARK: Border Beam

/// A short beam of light that travels round a rounded border, for something that is working (an answer arriving).
struct BorderBeam: ViewModifier {
    var active: Bool
    var cornerRadius: CGFloat = 14
    var colors: [Color] = [Color(red: 0.55, green: 0.45, blue: 1), Color(red: 0.36, green: 0.78, blue: 1)]
    var lineWidth: CGFloat = 1.5

    func body(content: Content) -> some View {
        content.overlay {
            if active {
                TimelineView(.animation(minimumInterval: 1 / 60, paused: !Duo.active)) { tl in
                    let turn = tl.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.6) / 2.6
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .strokeBorder(AngularGradient(gradient: Gradient(stops: [
                            .init(color: .clear, location: 0), .init(color: .clear, location: 0.62),
                            .init(color: colors[0], location: 0.82), .init(color: colors[colors.count - 1], location: 0.95),
                            .init(color: .clear, location: 1),
                        ]), center: .center, angle: .degrees(Duo.active ? turn * 360 : 0)), lineWidth: lineWidth)
                }
                .allowsHitTesting(false)
                .transition(.opacity)
            }
        }
    }
}

// MARK: Animate Digits

/// A number whose changed digits roll into place (the others stay still).
struct RollingNumber: View {
    let value: Double
    var format: FloatingPointFormatStyle<Double> = .number.precision(.fractionLength(0))
    var body: some View {
        Text(value, format: format)
            .monospacedDigit()
            .contentTransition(.numericText(value: value))
            .animation(Duo.active ? .spring(response: 0.35, dampingFraction: 0.8) : nil, value: value)
    }
}

// MARK: Blur Reveal

/// Text whose words come into focus one after another (fonts and colours come from the surrounding view).
struct BlurRevealText: View {
    let text: String
    var delay: Double = 0
    var stagger: Double = 0.07
    @State private var shown = false

    var body: some View {
        let words = text.split(separator: " ").map(String.init)
        HStack(spacing: 0) {
            ForEach(Array(words.enumerated()), id: \.offset) { i, w in
                Text(i < words.count - 1 ? w + " " : w)
                    .blur(radius: shown || !Duo.active ? 0 : 6)
                    .opacity(shown || !Duo.active ? 1 : 0)
                    .offset(y: shown || !Duo.active ? 0 : 5)
                    .animation(.easeOut(duration: 0.45).delay(delay + Double(i) * stagger), value: shown)
            }
        }
        .onAppear { shown = true }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
    }
}

// MARK: Confetti

/// A burst of confetti from the middle of the view each time `trigger` changes (something was finished).
struct ConfettiBurst: View {
    let trigger: Int
    var colors: [Color] = [.pink, .yellow, .mint, .cyan, .purple, .orange]
    @State private var start: Date?
    @State private var pieces: [Piece] = []

    struct Piece { let vx, vy, spin, size: Double; let color: Color }

    var body: some View {
        TimelineView(.animation(paused: start == nil)) { tl in
            Canvas { ctx, size in
                guard let start else { return }
                let t = tl.date.timeIntervalSince(start)
                guard t < 1.3 else { return }
                for p in pieces {
                    var c = ctx
                    c.opacity = max(0, 1 - t / 1.3)
                    c.translateBy(x: size.width / 2 + p.vx * t, y: size.height / 2 + p.vy * t + 260 * t * t)
                    c.rotate(by: .radians(p.spin * t))
                    c.fill(Path(CGRect(x: -p.size / 2, y: -p.size / 4, width: p.size, height: p.size / 2)), with: .color(p.color))
                }
            }
        }
        .allowsHitTesting(false)
        .onChange(of: trigger) { _, _ in
            guard Duo.active else { return }
            pieces = (0..<28).map { _ in
                let a = Double.random(in: 0..<(2 * .pi)), v = Double.random(in: 60...170)
                return Piece(vx: cos(a) * v, vy: sin(a) * v - 90, spin: .random(in: -9...9), size: .random(in: 4...7), color: colors.randomElement() ?? .white)
            }
            start = .now
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { start = nil }
        }
    }
}

// MARK: Press Depth

/// A plain button that dips and springs back when pressed.
struct PressDepthStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && Duo.active ? 0.86 : 1)
            .brightness(configuration.isPressed ? -0.06 : 0)
            .animation(.spring(response: 0.24, dampingFraction: 0.55), value: configuration.isPressed)
    }
}

// MARK: Animated List

/// A row that slides and fades in a moment after the row above it.
struct StaggeredAppear: ViewModifier {
    let index: Int
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 8)
            .blur(radius: shown ? 0 : 2.5)
            .onAppear {
                guard Duo.active else { shown = true; return }
                withAnimation(.spring(response: 0.45, dampingFraction: 0.82).delay(Double(min(index, 10)) * 0.04)) { shown = true }
            }
    }
}

// MARK: Loading Pulse Dots

/// Three dots that pulse one after another ("thinking").
struct PulseDots: View {
    var color: Color = Theme.textSecondary
    var body: some View {
        TimelineView(.animation(paused: !Duo.active)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { i in
                    let k = max(0, sin(t * 6 - Double(i) * 0.8))
                    Circle().fill(color).frame(width: 6, height: 6)
                        .scaleEffect(0.7 + 0.35 * k).opacity(0.45 + 0.55 * k)
                }
            }
        }
        .accessibilityLabel("Thinking")
    }
}

extension View {
    func shimmer(_ active: Bool = true) -> some View { modifier(Shimmer(active: active)) }
    func borderBeam(_ active: Bool, cornerRadius: CGFloat = 14) -> some View { modifier(BorderBeam(active: active, cornerRadius: cornerRadius)) }
    func staggeredAppear(index: Int) -> some View { modifier(StaggeredAppear(index: index)) }
    /// Confetti from this view each time `trigger` changes.
    func confetti(trigger: Int) -> some View { overlay { ConfettiBurst(trigger: trigger).frame(width: 180, height: 180) } }
}
