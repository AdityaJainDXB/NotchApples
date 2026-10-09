//
//  HoldToConfirm.swift
//  Notch apple
//
//  A destructive button you press and hold: a fill sweeps across while you hold, and only when it is full does the
//  action run. Letting go early, or sliding off the button, cancels. VoiceOver and keyboard users activate it
//  normally (their assistive action confirms deliberately), and Reduce Motion skips the sweep but keeps the hold.
//

import SwiftUI

struct HoldToConfirmButton<Label: View>: View {
    var duration: Double = 1.2
    var hint = "Press and hold to confirm"
    let action: () -> Void
    @ViewBuilder var label: () -> Label

    @State private var progress: CGFloat = 0
    @State private var done = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var shape: Capsule { Capsule() }

    var body: some View {
        label()
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Color(red: 1, green: 0.45, blue: 0.45))
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(shape.fill(Color.red.opacity(0.14)))
            .overlay(shape.strokeBorder(Color.red.opacity(0.55)))
            .overlay(alignment: .leading) {
                // The same label in white on solid red, revealed from the left as the hold progresses.
                label()
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(shape.fill(Color.red))
                    .mask(alignment: .leading) { GeometryReader { g in Rectangle().frame(width: g.size.width * progress) } }
                    .allowsHitTesting(false)
            }
            .contentShape(shape)
            .scaleEffect(progress > 0 && !reduceMotion ? 0.98 : 1)
            .onLongPressGesture(minimumDuration: duration, maximumDistance: 24) {
                done = true
                action()
                withAnimation(.easeOut(duration: 0.18)) { progress = 0 }
            } onPressingChanged: { pressing in
                if pressing {
                    done = false
                    withAnimation(reduceMotion ? nil : .linear(duration: duration)) { progress = 1 }
                } else if !done {
                    withAnimation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.18)) { progress = 0 }
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityHint(hint)
            .accessibilityAction { action() }
            .help(hint)
    }
}
