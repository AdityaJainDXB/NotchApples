//
//  Theme.swift
//  Notch apple
//
//  Design tokens: a vibrant-but-readable purple accent, deep purple gradients,
//  and reusable glass card / button styles used across every module.
//

import SwiftUI

enum Theme {
    /// Primary accent — vivid violet that keeps AA contrast against the dark notch.
    static let accent = Color(red: 0.62, green: 0.42, blue: 1.0)
    static let accentBright = Color(red: 0.78, green: 0.62, blue: 1.0)
    static let deep = Color(red: 0.12, green: 0.05, blue: 0.24)
    static let deeper = Color(red: 0.05, green: 0.02, blue: 0.10)

    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.68)

    /// Background gradient behind the expanded notch.
    static let backdrop = LinearGradient(
        colors: [deeper, deep, Color(red: 0.22, green: 0.09, blue: 0.42)],
        startPoint: .top, endPoint: .bottomTrailing)

    static let accentGradient = LinearGradient(
        colors: [accentBright, accent], startPoint: .topLeading, endPoint: .bottomTrailing)

    static let spring = Animation.spring(response: 0.42, dampingFraction: 0.82)
    static let corner: CGFloat = 14
}

/// A frosted card used to group content inside modules.
struct GlassCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.ultraThinMaterial.opacity(0.55), in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.corner, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08)))
    }
}

/// Filled purple pill button.
struct PurpleButtonStyle: ButtonStyle {
    var prominent = true
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(
                Capsule().fill(prominent ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Color.white.opacity(0.10)))
            )
            .opacity(configuration.isPressed ? 0.75 : 1)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

extension View {
    /// Section header text used inside modules.
    func sectionTitle() -> some View {
        font(.system(size: 11, weight: .semibold)).textCase(.uppercase)
            .foregroundStyle(Theme.textSecondary).tracking(0.6)
    }
}
