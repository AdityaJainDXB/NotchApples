//
//  NotchAITier.swift
//  Notch Apple
//
//  Which NotchAI capabilities each tier gets, using the app's EXISTING entitlement state (Entitlements.tier and the
//  update lock). It adds no licensing feature or key rules: free is always allowed, Pro and Ultimate follow the
//  tier the licensing code already computed. Pro: screen awareness, advanced voice. Ultimate: autonomous computer
//  control and multi-agent execution (later milestones).
//

import Foundation

@MainActor
enum NotchAITier {
    static func allows(_ required: Tier) -> Bool {
        if required == .free { return true }
        return !UpdateChecker.isLocked && !(Entitlements.emailGateLocked) && Entitlements.shared.tier >= required
    }

    /// A short line for a locked feature.
    static func lockedMessage(_ required: Tier) -> String {
        "\(required.name) feature. Unlock it in Settings → License."
    }
}
