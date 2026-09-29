//
//  Theme.swift
//  Notch apple
//
//  Design tokens and reusable controls, following Apple's HIG for macOS:
//   • Pointer targets are at least 28 × 28 pt (HIG › Accessibility).
//   • Text is at least 11 pt; secondary text keeps ≥ 4.5:1 contrast on the
//     dark purple backdrop (HIG › Color, Accessibility).
//   • Labels use sentence case, not ALL CAPS (HIG › Writing).
//   • Controls show hover and pressed states (HIG › Pointing devices).
//   • Springs fall back to a short fade when Reduce Motion is on (HIG › Motion).
//

import SwiftUI

enum Theme {
    /// The active colour theme (Settings → Appearance). Every token below follows it.
    private static var current: AppTheme { ThemeManager.shared.currentTheme }

    /// Primary accent, chosen so it keeps contrast against the dark notch.
    static var accent: Color { current.primaryAccent }
    static var accentBright: Color { current.secondaryAccent }
    static var deep: Color { current.backgroundColor }
    static var deeper: Color { current.backgroundColor }

    static var textPrimary: Color { current.textColor }
    /// ~7:1 on the backdrop, comfortably above the 4.5:1 minimum for small text.
    static var textSecondary: Color { current.textColor.opacity(0.74) }
    static let surface = Color.white.opacity(0.07)
    static let surfaceHover = Color.white.opacity(0.13)
    static var separator: Color { current.id == .notchPurple ? Color.white.opacity(0.10) : current.borderColor }

    /// Background gradient behind the expanded notch.
    static var backdrop: LinearGradient {
        let t = current
        let colors = t.id == .notchPurple
            ? [Color(red: 0.05, green: 0.02, blue: 0.10), Color(red: 0.12, green: 0.05, blue: 0.24), t.backdropEnd]
            : [t.backgroundColor, t.backgroundColor, t.backdropEnd]
        return LinearGradient(colors: colors, startPoint: .top, endPoint: .bottomTrailing)
    }

    static var accentGradient: LinearGradient {
        LinearGradient(colors: [accentBright, accent], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    static let corner: CGFloat = 14
    /// Minimum pointer target on macOS.
    static let minTarget: CGFloat = 28

    /// Spring for open/close and tab changes; a plain fade when Reduce Motion is on.
    static var spring: Animation {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
            ? .easeInOut(duration: 0.15)
            : .spring(response: 0.42, dampingFraction: 0.82)
    }
}

/// A frosted card used to group content inside modules.
struct GlassCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(.ultraThinMaterial.opacity(0.5), in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.corner, style: .continuous)
                .strokeBorder(Theme.separator))
    }
}

/// Text or icon+text button. `prominent` is the purple call-to-action; the
/// plain variant is a quiet filled capsule. Both are ≥ 28 pt tall.
struct PurpleButtonStyle: ButtonStyle {
    var prominent = true

    func makeBody(configuration: Configuration) -> some View {
        StyledButton(configuration: configuration, prominent: prominent)
    }

    private struct StyledButton: View {
        let configuration: ButtonStyleConfiguration
        let prominent: Bool
        @State private var hovering = false
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(minWidth: Theme.minTarget, minHeight: Theme.minTarget)
                .background(
                    Capsule().fill(prominent ? AnyShapeStyle(Theme.accentGradient)
                                             : AnyShapeStyle(hovering ? Theme.surfaceHover : Theme.surface))
                )
                .overlay(Capsule().fill(Color.white.opacity(prominent && hovering ? 0.12 : 0)))
                .contentShape(Capsule())
                .opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
                .scaleEffect(configuration.isPressed ? 0.97 : 1)
                .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
                .onHover { hovering = $0 }
        }
    }
}

/// Icon-only button with a 28 × 28 pt target and a hover highlight.
struct IconButton: View {
    let systemImage: String
    let help: String
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(hovering ? .white : Theme.textSecondary)
                .frame(width: Theme.minTarget, height: Theme.minTarget)
                .background(Circle().fill(hovering ? Theme.surfaceHover : .clear))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

extension View {
    /// Section header used inside modules (sentence case, per HIG › Writing).
    func sectionTitle() -> some View {
        font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Theme.textSecondary)
    }
}
