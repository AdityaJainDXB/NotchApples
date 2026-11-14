//
//  LiquidGlass.swift
//  Notch Apple
//
//  Liquid glass buttons (opt-in, Settings → Appearance): every button in the notch and in Settings becomes a pane of glass that
//  brightens when the pointer is on it and dips when clicked. On macOS 26 and later it uses the system's Liquid Glass; on older
//  macOS it draws the same idea with a translucent fill and a soft light edge. Nothing is loaded or sent anywhere, and it is off
//  by default. It works alone or together with liquid metal (glass wins on buttons, metal stays on the tab and the closed notch).
//

import SwiftUI

enum LiquidGlassSetting {
    static let key = "appearance.liquidGlass"
    static var isOn: Bool { UserDefaults.standard.bool(forKey: key) }
}

/// A pane of frosted glass in `shape`: a faint milky body, a bright top edge that fades down the sides, and a soft glint in the upper
/// half. Drawn by Notch Apple on every macOS (Apple's own glass turns to grey mud on the always-black notch). `lit` is the pointer on it.
struct GlassSurface<S: Shape>: View {
    var shape: S
    var lit: Bool
    var pressed: Bool = false
    var body: some View {
        let body = LinearGradient(colors: [Color.white.opacity(lit ? 0.20 : 0.11), Color.white.opacity(lit ? 0.07 : 0.04)], startPoint: .top, endPoint: .bottom)
        let rim = LinearGradient(colors: [Color.white.opacity(lit ? 0.85 : 0.55), Color.white.opacity(0.10), Color.white.opacity(lit ? 0.40 : 0.22)], startPoint: .top, endPoint: .bottom)
        let glint = LinearGradient(colors: [Color.white.opacity(lit ? 0.30 : 0.16), Color.white.opacity(0)], startPoint: .top, endPoint: .center)
        ZStack {
            shape.fill(body)
            shape.fill(glint).padding(1.5).mask(LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: .bottom))
            shape.stroke(rim, lineWidth: 1)
        }
        .shadow(color: Color.white.opacity(lit ? 0.18 : 0), radius: 5)
        .opacity(pressed ? 0.75 : 1)
        .animation(.easeOut(duration: 0.15), value: lit)
    }
}

/// The glass shown over a button the pointer is on. It follows the button's own shape, like the metal outline does.
struct GlassHoverOverlay: View {
    var body: some View {
        GeometryReader { geo in
            let r = min(14, min(geo.size.width, geo.size.height) / 2)
            GlassSurface(shape: RoundedRectangle(cornerRadius: r, style: .continuous), lit: true)
        }
        .allowsHitTesting(false)
        .transition(.opacity)
    }
}
