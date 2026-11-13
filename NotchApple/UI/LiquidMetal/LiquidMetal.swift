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
}

/// A capsule filled with flowing metal in the theme colour. `hover` (0 or 1) makes the metal brighter and faster.
struct LiquidMetalCapsule: View {
    var hover: Bool = false
    /// 0: a resting or hovered button, 1: the open tab (filled with the theme colour), 2: only a rim (use it through a mask).
    var mode: Int? = nil
    /// The metal's tint; the current theme's bright accent when nil.
    var tint: Color? = nil
    /// A dark veil keeps white text readable on the metal (tabs). A rim around the notch has no text, so it goes without.
    var veil: Bool = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Settings → Appearance: 0 theme colour, 1 rainbow, 2 gold.
    @AppStorage(LiquidMetalSetting.colourKey) private var colour = 0

    var body: some View {
        GeometryReader { geo in
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { ctx in
                let t = reduceMotion ? 4.0 : ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 3600)
                ZStack {
                    Capsule()
                        .fill(.white)
                        .colorEffect(ShaderLibrary.liquidMetal(.float2(geo.size), .float(t), .float(1), .float(hover ? 1 : 0), .float(Float(mode ?? (hover ? 0 : 1))), .float(Float(colour)), .color(tint ?? Theme.accentBright)))
                    if veil, (mode ?? 0) != 2 { Capsule().fill(Color.black.opacity(hover ? 0.30 : 0.42)) }   // keeps the white tab name readable
                    
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
        @State private var hovering = false
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .overlay {
                    if metal && hovering && isEnabled {
                        LiquidMetalCapsule(hover: true, mode: 2, veil: false)
                            .mask(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(lineWidth: 1.6))
                            .allowsHitTesting(false)
                            .transition(.opacity)
                    }
                }
                .opacity(metal && configuration.isPressed ? 0.8 : 1)
                .scaleEffect(metal && configuration.isPressed ? 0.98 : 1)
                .animation(.easeOut(duration: 0.15), value: hovering)
                .onHover { hovering = $0 }
        }
    }
}
