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

/// A pane of glass in `shape`. `lit` is the pointer being on it.
struct GlassSurface<S: Shape>: View {
    var shape: S
    var lit: Bool
    var pressed: Bool = false
    var body: some View {
        if #available(macOS 26.0, *) { systemGlass } else { drawnGlass }
    }

    @available(macOS 26.0, *)
    private var systemGlass: some View {
        let glass: Glass = lit ? Glass.regular.tint(Color.white.opacity(0.14)).interactive() : Glass.regular
        return Color.clear.glassEffect(glass, in: shape).opacity(pressed ? 0.8 : 1)
    }

    private var drawnGlass: some View {
        let top: Double = lit ? 0.26 : 0.12
        let bottom: Double = lit ? 0.08 : 0.03
        let rimA: Double = lit ? 0.75 : 0.45
        let rimB: Double = lit ? 0.35 : 0.18
        let sheen = LinearGradient(colors: [Color.white.opacity(top), Color.white.opacity(bottom)], startPoint: .top, endPoint: .bottom)
        let rim = LinearGradient(colors: [Color.white.opacity(rimA), Color.white.opacity(0.08), Color.white.opacity(rimB)], startPoint: .topLeading, endPoint: .bottomTrailing)
        return ZStack {
            shape.fill(.ultraThinMaterial)
            shape.fill(sheen)
            shape.stroke(rim, lineWidth: 1)
        }
        .shadow(color: Color.black.opacity(0.25), radius: lit ? 4 : 2, y: 1)
        .opacity(pressed ? 0.8 : 1)
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
