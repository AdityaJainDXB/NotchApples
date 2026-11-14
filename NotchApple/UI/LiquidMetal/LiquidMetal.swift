//
//  LiquidMetal.swift
//  Notch Apple
//
//  Liquid metal for the notch (opt-in): the highlight behind the open tab, and a brighter flowing metal when the pointer is
//  on a tab. The look is the approved prototype (docs/prototypes/liquid-metal-notch.html, from Jakub Antalik's MIT
//  metal-fx), rewritten as a SwiftUI shader (LiquidMetal.metal / LiquidMetalCore.h). It is off by default
//  (Settings → Appearance), draws at most 30 frames a second, holds still with Reduce Motion, and only runs while the
//  notch is on screen. Nothing is loaded or sent anywhere.
//

import SwiftUI

enum LiquidMetalSetting {
    static let key = "appearance.liquidMetal"
    static let colourKey = "appearance.liquidMetalColour"
    static var isOn: Bool { UserDefaults.standard.bool(forKey: key) }
    /// "Liquid metal outliners": the look of the approved prototype, with one thing lit at a time: the open tab is outlined instead of
    /// filled, whatever the pointer is on gets the flowing outline, and the closed notch keeps its metal rim.
    static let outlinesKey = "appearance.liquidMetalOutlines"
    /// The fixed metal colours (4 and up); nil for the theme colour, rainbow, gold and purple, which the shader makes itself.
    static func fixedTint(_ n: Int) -> Color? {
        switch n {
        case 4: return Color(white: 0.92)
        case 5: return Color(red: 0.35, green: 0.62, blue: 1.0)
        case 6: return Color(red: 0.28, green: 0.85, blue: 0.55)
        case 7: return Color(red: 1.0, green: 0.36, blue: 0.40)
        case 8: return Color(red: 1.0, green: 0.50, blue: 0.80)
        default: return nil
        }
    }
    static var outlinesOn: Bool { UserDefaults.standard.bool(forKey: outlinesKey) }
}

/// A capsule filled with flowing metal in the theme colour. `hover` (0 or 1) makes the metal brighter and faster.
struct LiquidMetalCapsule: View {
    var hover: Bool = false
    /// 0: a resting or hovered button, 1: the open tab (filled with the theme colour), 2: a thin flowing ring (buttons), 3: the chrome outline of the closed notch (use it through a mask).
    var mode: Int? = nil
    /// The metal's tint; the current theme's bright accent when nil.
    var tint: Color? = nil
    /// A dark veil keeps white text readable on the metal (tabs). A rim around the notch has no text, so it goes without.
    var veil: Bool = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Settings → Appearance: 0 theme colour, 1 rainbow, 2 gold, 3 purple, 4 silver, 5 blue, 6 green, 7 red, 8 pink.
    @AppStorage(LiquidMetalSetting.colourKey) private var colour = 0

    var body: some View {
        GeometryReader { geo in
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { ctx in
                let t = reduceMotion ? 4.0 : ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 3600)
                ZStack {
                    // Outlines (modes 2 and 3) are cut out by a mask, so they need the whole rectangle, not just the pill shape.
                    AnyShape(((mode ?? 0) >= 2) ? AnyShape(Rectangle()) : AnyShape(Capsule()))
                        .fill(.white)
                        .colorEffect(ShaderLibrary.liquidMetal(.float2(geo.size), .float(t), .float(1), .float(hover ? 1 : 0), .float(Float(mode ?? (hover ? 0 : 1))), .float(Float(colour >= 4 ? 0 : colour)), .color(LiquidMetalSetting.fixedTint(colour) ?? tint ?? Theme.accentBright)))
                    if veil, (mode ?? 0) < 2 { Capsule().fill(Color.black.opacity(hover ? 0.30 : 0.42)) }   // keeps the white tab name readable
                    
                }
            }
        }
    }
}

/// The notch's plain buttons (the ones that draw their own look: icons, cards, rows). With liquid metal off this is exactly the
/// plain style. With it on, a thin metal ring flows around the button while the pointer is on it, and a click dims it a little.
struct MetalPlainStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { Inner(configuration: configuration) }

    private struct Inner: View {
        let configuration: ButtonStyleConfiguration
        @AppStorage(LiquidMetalSetting.key) private var metal = false
        @AppStorage(LiquidGlassSetting.key) private var glass = false
        @AppStorage(LiquidMetalSetting.outlinesKey) private var outlines = false
        @State private var hovering = false
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .overlay {
                    if glass { if hovering && isEnabled { GlassHoverOverlay() } }
                    else if (metal || outlines) && hovering && isEnabled { MetalHoverOutline() }
                    else if false && hovering && isEnabled { MetalHoverOutline() }
                }
                .opacity((metal || glass || outlines) && configuration.isPressed ? 0.8 : 1)
                .scaleEffect((metal || glass || outlines) && configuration.isPressed ? 0.98 : 1)
                .animation(.easeOut(duration: 0.15), value: hovering)
                .onHover { hovering = $0 }
        }
    }
}

/// The metal ring on hover, for buttons that keep a system style (bordered, borderless, link). Does nothing while liquid metal is off.
struct MetalHoverRing: ViewModifier {
    @AppStorage(LiquidMetalSetting.key) private var metal = false
    @AppStorage(LiquidGlassSetting.key) private var glass = false
    @AppStorage(LiquidMetalSetting.outlinesKey) private var outlines = false
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    func body(content: Content) -> some View {
        content
            .overlay {
                if glass { if hovering && isEnabled { GlassHoverOverlay() } }
                else if (metal || outlines) && hovering && isEnabled { MetalHoverOutline() }
                else if false && hovering && isEnabled { MetalHoverOutline() }
            }
            .onHover { hovering = $0 }
    }
}

/// What a button without any style of its own looks like while liquid metal is on: a quiet dark capsule that turns to metal under the
/// pointer and dims when clicked. Set once on a whole screen with `.metalButtons()`; a button that names its own style keeps it.
struct MetalDefaultStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { Inner(configuration: configuration) }

    private struct Inner: View {
        let configuration: ButtonStyleConfiguration
        @AppStorage(LiquidGlassSetting.key) private var glass = false
        @AppStorage(LiquidMetalSetting.outlinesKey) private var outlines = false
        @State private var hovering = false
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background {
                    if outlines && !glass { Capsule().fill(Color(red: 0.082, green: 0.075, blue: 0.11)) }
                    else if glass { GlassSurface(shape: Capsule(), lit: hovering && isEnabled, pressed: configuration.isPressed) }
                    else if hovering && isEnabled { LiquidMetalCapsule(hover: configuration.isPressed || hovering) }
                    else { Capsule().fill(Color.white.opacity(0.08)) }
                }
                .overlay { if outlines && !glass && isEnabled && hovering { MetalHoverOutline() } }
                .contentShape(Capsule())
                .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.4)
                .scaleEffect(configuration.isPressed ? 0.98 : 1)
                .onHover { hovering = $0 }
        }
    }
}

private struct MetalButtonsModifier: ViewModifier {
    @AppStorage(LiquidMetalSetting.key) private var metal = false
    @AppStorage(LiquidGlassSetting.key) private var glass = false
    @AppStorage(LiquidMetalSetting.outlinesKey) private var outlines = false
    @ViewBuilder func body(content: Content) -> some View {
        if metal || glass || outlines { content.buttonStyle(MetalDefaultStyle()) } else { content }
    }
}

extension View {
    /// Liquid-metal hover on a button that keeps a system style.
    func metalHover() -> some View { modifier(MetalHoverRing()) }
    /// With liquid metal on, every button below that has no style of its own gets the metal look.
    func metalButtons() -> some View { modifier(MetalButtonsModifier()) }
}


/// The chrome outline shown around a hovered button. It follows the button's own shape: round for a small pill, softly rounded for a
/// card, and it is thick enough to see (2.5 points) with a soft glow outside it.
struct MetalHoverOutline: View {
    /// The pointer is on it: brighter and faster. Outliners keep every button outlined, so a resting one is calmer.
    var hover: Bool = true
    var body: some View {
        GeometryReader { geo in
            let r = min(14, min(geo.size.width, geo.size.height) / 2)
            ZStack {
                LiquidMetalCapsule(hover: hover, mode: 3, veil: false)
                    .mask(RoundedRectangle(cornerRadius: r, style: .continuous).strokeBorder(lineWidth: hover ? 2.5 : 1.6))
                if hover { RoundedRectangle(cornerRadius: r, style: .continuous).strokeBorder(Theme.accentBright.opacity(0.35), lineWidth: 1).blur(radius: 3) }
            }
        }
        .allowsHitTesting(false)
        .transition(.opacity)
    }
}

/// The background of a choice pill (a filter chip, a segment): metal when it is the selected one and liquid metal is on, otherwise the usual.
struct ChoiceCapsule: View {
    var on: Bool
    var off: Color = Color.white.opacity(0.07)
    @AppStorage(LiquidMetalSetting.key) private var metal = false
    var body: some View {
        if metal && on { LiquidMetalCapsule(hover: false, mode: 1).shadow(color: Theme.accent.opacity(0.45), radius: 6) }
        else { Capsule().fill(on ? Color.white : off) }
    }
}

extension LiquidMetalSetting {
    /// The text colour on a selected choice pill: white on metal, the dark ink on the usual white pill.
    static var selectedText: Color { isOn ? .white : Color(hex: "#14121c") }
}
