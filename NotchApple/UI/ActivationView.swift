//
//  ActivationView.swift
//  Notch apple
//
//  The inline access-code prompt. It appears inside the notch (or Settings)
//  when someone opens AI, Messenger, Audio, Now Playing or VPN without having
//  activated. A wrong code shakes the field; a right one plays a checkmark and
//  unlocks every gated feature at once.
//

import SwiftUI

/// Horizontal shake driven by an increasing counter.
private struct Shake: GeometryEffect {
    var travel: CGFloat = 9
    var shakes: CGFloat = 3
    var animatableData: CGFloat
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: travel * sin(animatableData * .pi * shakes * 2), y: 0))
    }
}

struct ActivationModalView: View {
    /// What the user tried to open, e.g. "AI". Nil when shown from Settings.
    var feature: String?
    var compact = false

    @StateObject private var license = LicenseState.shared
    @State private var code = ""
    @State private var failures: CGFloat = 0
    @State private var showError = false
    @State private var succeeded = false
    @FocusState private var focused: Bool

    private var complete: Bool { AccessCodeManager.sanitize(code).count == 13 }

    var body: some View {
        HStack(spacing: compact ? 14 : 22) {
            ZStack {
                Circle().fill(Theme.accentGradient).frame(width: compact ? 46 : 64, height: compact ? 46 : 64)
                    .shadow(color: Theme.accent.opacity(0.5), radius: 14)
                Image(systemName: succeeded ? "checkmark" : "key.fill")
                    .font(.system(size: compact ? 19 : 26, weight: .bold)).foregroundStyle(.white)
                    .contentTransition(.symbolEffect(.replace))
                    .symbolEffect(.bounce, value: succeeded)
            }

            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(succeeded ? "Unlocked" : (feature.map { "\($0) needs an access code" } ?? "Enter your access code"))
                        .font(.system(size: compact ? 15 : 18, weight: .bold)).foregroundStyle(.white)
                    Text(succeeded ? "AI, Messenger, Audio, Now Playing and VPN are all unlocked."
                                   : "Please enter your 12-character access code to unlock AI, Messenger, Audio, Now Playing and VPN.")
                        .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !succeeded {
                    HStack(spacing: 8) {
                        TextField("NOTCH-XXXX-XXXX", text: $code)
                            .textFieldStyle(.plain)
                            .font(.system(size: 16, weight: .semibold, design: .monospaced))
                            .foregroundStyle(.white)
                            .autocorrectionDisabled()
                            .focused($focused)
                            .padding(.horizontal, 12).frame(height: 36)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10)
                                .strokeBorder(showError ? Color.red : (focused ? Theme.accent : Theme.separator),
                                              lineWidth: showError || focused ? 1.5 : 1))
                            .modifier(Shake(animatableData: failures))
                            .onChange(of: code) { _, new in
                                let formatted = AccessCodeManager.format(new)
                                if formatted != new { code = formatted }
                                if showError { withAnimation(.easeOut(duration: 0.2)) { showError = false } }
                            }
                            .onSubmit(unlock)
                            .accessibilityLabel("Access code")
                        Button("Unlock", action: unlock)
                            .buttonStyle(PurpleButtonStyle())
                            .disabled(!complete)
                    }
                    Text("Invalid Access Code. Please try again.")
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(Color(red: 1, green: 0.45, blue: 0.5))
                        .opacity(showError ? 1 : 0)
                }
            }
            .frame(maxWidth: 420, alignment: .leading)
        }
        .padding(compact ? 14 : 24)
        .background(.ultraThinMaterial.opacity(0.5), in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.corner, style: .continuous).strokeBorder(Theme.accent.opacity(0.4)))
        .frame(maxWidth: .infinity, maxHeight: compact ? nil : .infinity)
        .onAppear { focused = true }
    }

    private func unlock() {
        guard !succeeded else { return }
        if license.activate(with: code) {
            withAnimation(Theme.spring) { succeeded = true }
        } else {
            withAnimation(.linear(duration: 0.45)) { failures += 1 }
            withAnimation(.easeIn(duration: 0.15)) { showError = true }
        }
    }
}
