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

    var body: some View {
        GeometryReader { geo in
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { ctx in
                let t = reduceMotion ? 4.0 : ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 3600)
                ZStack {
                    Capsule()
                        .fill(.white)
                        .colorEffect(ShaderLibrary.liquidMetal(.float2(geo.size), .float(t), .float(1), .float(hover ? 1 : 0), .float(Float(mode ?? (hover ? 0 : 1))), .color(tint ?? Theme.accentBright)))
                    
                }
            }
        }
    }
}
