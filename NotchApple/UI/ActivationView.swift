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
    @State private var checking = false
    @State private var errorText = "Invalid Access Code. Please try again."
    @FocusState private var focused: Bool

    private var complete: Bool { [13, 17].contains(AccessCodeManager.sanitize(code).count) && !checking }

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
                    Text(succeeded ? "\(Module.proSummary) are all unlocked."
                                   : "Enter your access code or product key to unlock \(Module.proSummary).")
                        .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !succeeded {
                    HStack(spacing: 8) {
                        TextField("Code or key", text: $code)
                            .textFieldStyle(.plain)
                            .font(.system(size: 14, weight: .semibold, design: .monospaced))
                            .lineLimit(1)
                            .foregroundStyle(.white)
                            .autocorrectionDisabled()
                            .focused($focused)
                            .padding(.horizontal, 12).frame(minWidth: 215).frame(height: 36)
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
                        Button(checking ? "Checking…" : "Unlock", action: unlock)
                            .buttonStyle(PurpleButtonStyle())
                            .disabled(!complete)
                    }
                    Text(errorText)
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(Color(red: 1, green: 0.45, blue: 0.5))
                        .fixedSize(horizontal: false, vertical: true)
                        .opacity(showError ? 1 : 0)
                    if !showError {
                        Link("No code? Get a product key for $1 in Litecoin, or with a promo code →",
                             destination: URL(string: "https://virajsinghchadha.github.io/notchapples-site/pro.html")!)
                            .font(.system(size: 11)).foregroundStyle(Theme.accent)
                    }
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
        guard !succeeded, !checking else { return }
        if ProductKeys.isProductKey(AccessCodeManager.sanitize(code)) {
            checking = true
            Task {
                do {
                    try await license.activate(productKey: code)
                    withAnimation(Theme.spring) { succeeded = true }
                } catch {
                    fail(error.localizedDescription)
                }
                checking = false
            }
        } else if license.activate(with: code) {
            withAnimation(Theme.spring) { succeeded = true }
        } else {
            fail("Invalid Access Code. Please try again.")
        }
    }

    private func fail(_ text: String) {
        errorText = text
        withAnimation(.linear(duration: 0.45)) { failures += 1 }
        withAnimation(.easeIn(duration: 0.15)) { showError = true }
    }
}
