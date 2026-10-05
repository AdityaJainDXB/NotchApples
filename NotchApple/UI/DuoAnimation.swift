//
//  DuoAnimation.swift
//  Notch apple
//
//  The "iPhone Duo" feel (Settings → Notch → Use iPhone Duo animations, on by default): views pop
//  and morph the way the Dynamic Island does. The open panel springs out of the notch with a soft
//  overshoot, the highlight slides between tabs as one shape (matchedGeometryEffect), and the page
//  you switch to scales and de-blurs into place. With Reduce Motion on, everything is a short fade.
//

import SwiftUI

enum Duo {
    static let key = "useDuoAnimations"

    /// The setting, readable from anywhere (on unless turned off).
    static var enabled: Bool { UserDefaults.standard.object(forKey: key) as? Bool ?? true }
    static var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
    static var active: Bool { enabled && !reduceMotion }

    /// Open, close and tab changes: a quick pop that settles with a little bounce.
    static var animation: Animation {
        if reduceMotion { return .easeInOut(duration: 0.15) }
        return enabled ? .spring(response: 0.42, dampingFraction: 0.68) : Theme.spring
    }

    /// The panel growing out of (and shrinking back into) the notch.
    static var panelTransition: AnyTransition {
        active ? .scale(scale: 0.55, anchor: .top).combined(with: .opacity) : .opacity.combined(with: .scale(scale: 0.96, anchor: .top))
    }

    /// The page you switch to: it pops in from slightly small and blurred, the old one softens away.
    static var pageTransition: AnyTransition {
        active
            ? .asymmetric(insertion: .modifier(active: Morph(amount: 1), identity: Morph(amount: 0)),
                          removal: .modifier(active: Morph(amount: 1), identity: Morph(amount: 0)))
            : .asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity)
    }

    /// 0 = settled, 1 = fully popped out.
    struct Morph: ViewModifier {
        var amount: Double
        func body(content: Content) -> some View {
            content
                .scaleEffect(1 - 0.07 * amount, anchor: .top)
                .blur(radius: 9 * amount)
                .opacity(1 - amount)
        }
    }
}
