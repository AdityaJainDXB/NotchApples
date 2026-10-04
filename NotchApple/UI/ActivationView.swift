//
//  ActivationView.swift
//  Notch apple
//
//  The inline unlock prompt. It appears inside the notch when someone opens a
//  Pro tab, and in Settings → License. It shows what the feature does and the
//  tier it needs (never blocking anything free), and takes a signed product key
//  (NTCH-PRO-… / NTCH-ULTM-…) or an older access code. A wrong key shakes the
//  field; a right one plays a checkmark and unlocks everything in that tier.
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
    /// What the user tried to open. Nil when shown from Settings.
    var feature: Feature?
    /// Pre-filled key, e.g. from a notchapple://activate link.
    var prefill: String = ""
    var compact = false

    @StateObject private var license = LicenseState.shared
    @StateObject private var entitlements = Entitlements.shared
    @State private var code = ""
    @State private var failures: CGFloat = 0
    @State private var showError = false
    @State private var succeeded = false
    @State private var checking = false
    @State private var errorText = "Invalid Access Code. Please try again."
    @FocusState private var focused: Bool

    private var isSignedKey: Bool { LicenseKey.looksLikeKey(code) }
    private var complete: Bool {
        !checking && (isSignedKey ? code.count > 100 : [13, 17].contains(AccessCodeManager.sanitize(code).count))
    }
    private var needed: Tier { feature?.tier ?? .pro }

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
                    HStack(spacing: 8) {
                        Text(succeeded ? "Unlocked" : (feature?.title ?? "Enter your product key"))
                            .font(.system(size: compact ? 15 : 18, weight: .bold)).foregroundStyle(.white)
                        if !succeeded && feature != nil { TierBadge(tier: needed) }
                    }
                    Text(succeeded ? "Everything in \(entitlements.tier.name) is unlocked on this Mac."
                                   : (feature.map { "\($0.benefit) Part of \($0.tier.name), \($0.tier.price), yours for life." }
                                      ?? "Paste your key (or an older access code) to unlock Pro or Ultimate."))
                        .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !succeeded {
                    HStack(spacing: 8) {
                        TextField("Paste your key", text: $code)
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
                                // Signed keys are pasted whole; only older codes get NOTCH-XXXX formatting.
                                if !LicenseKey.looksLikeKey(new) {
                                    let formatted = AccessCodeManager.format(new)
                                    if formatted != new { code = formatted }
                                }
                                if showError { withAnimation(.easeOut(duration: 0.2)) { showError = false } }
                            }
                            .onSubmit(unlock)
                            .accessibilityLabel("Product key or access code")
                        Button(checking ? "Checking…" : "Unlock", action: unlock)
                            .buttonStyle(PurpleButtonStyle())
                            .disabled(!complete)
                    }
                    Text(errorText)
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(Color(red: 1, green: 0.45, blue: 0.5))
                        .fixedSize(horizontal: false, vertical: true)
                        .opacity(showError ? 1 : 0)
                    if !showError && feature != nil {
                        HStack(spacing: 12) {
                            Link("Get \(needed.name), \(needed.price) →", destination: URL(string: LicenseServer.site)!)
                            Link("Lost my key?", destination: URL(string: LicenseServer.site + "#recover")!)
                            Button("Compare tiers") { AppDelegate.openSettingsWindow(tab: .license) }.buttonStyle(.plain)
                        }
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
        .onAppear {
            focused = true
            if !prefill.isEmpty { code = prefill }
        }
    }

    private func unlock() {
        guard !succeeded, !checking else { return }
        if isSignedKey {
            checking = true
            Task {
                do {
                    try await entitlements.activate(code)
                    withAnimation(Theme.spring) { succeeded = true }
                } catch {
                    fail(error.localizedDescription)
                }
                checking = false
            }
        } else if ProductKeys.isProductKey(AccessCodeManager.sanitize(code)) {
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

/// Small capsule naming the tier a feature needs: 🔒 PRO / 🔒 ULTIMATE.
struct TierBadge: View {
    let tier: Tier
    var locked = true

    var body: some View {
        HStack(spacing: 3) {
            if locked { Image(systemName: "lock.fill").font(.system(size: 7, weight: .bold)) }
            Text(tier.name.uppercased()).font(.system(size: 9, weight: .heavy))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 6).padding(.vertical, 2)
        .background(LinearGradient(colors: tier == .ultimate ? [.purple, .indigo] : [.orange, .pink],
                                   startPoint: .leading, endPoint: .trailing), in: Capsule())
        .accessibilityLabel(locked ? "Needs \(tier.name)" : tier.name)
    }
}

extension View {
    /// For a setting that belongs to a paid feature: disabled with a tier badge until unlocked.
    /// Free settings never use this.
    func requires(_ feature: Feature) -> some View { modifier(RequiresFeature(feature: feature)) }
}

private struct RequiresFeature: ViewModifier {
    let feature: Feature
    @ObservedObject private var entitlements = Entitlements.shared

    func body(content: Content) -> some View {
        if entitlements.canUse(feature) {
            content
        } else {
            HStack {
                content.disabled(true)
                TierBadge(tier: feature.tier).help(feature.benefit)
            }
        }
    }
}
