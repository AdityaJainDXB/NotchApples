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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { ctx in
                let t = reduceMotion ? 4.0 : ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 3600)
                ZStack {
                    Capsule()
                        .fill(.white)
                        .colorEffect(ShaderLibrary.liquidMetal(.float2(geo.size), .float(t), .float(1), .float(hover ? 1 : 0), .color(Theme.accentBright)))
                    // A soft dark veil keeps the white tab name readable on the brightest part of the metal.
                    Capsule().fill(Color.black.opacity(hover ? 0.30 : 0.42))
                }
            }
        }
    }
}
