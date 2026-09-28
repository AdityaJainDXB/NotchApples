//
//  BiometricAuth.swift
//  Notch apple
//
//  Biometric gate built on LocalAuthentication. On macOS,
//  `.deviceOwnerAuthentication` automatically offers Touch ID, Apple Watch
//  unlock, and falls back to the login password — whatever the Mac supports.
//

import SwiftUI
import LocalAuthentication

enum BiometricAuth {
    /// Human-readable name for the strongest available method.
    static var methodName: String {
        let ctx = LAContext()
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch ctx.biometryType {
        case .touchID: return "Touch ID"
        case .faceID: return "Face ID"
        case .opticID: return "Optic ID"
        default: return "Password"
        }
    }

    static var symbol: String {
        methodName == "Face ID" ? "faceid" : methodName == "Touch ID" ? "touchid" : "lock.fill"
    }

    /// Prompts the user. Returns true on success.
    static func authenticate(reason: String) async -> Bool {
        let ctx = LAContext()
        ctx.localizedCancelTitle = "Cancel"
        var error: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return false }
        return (try? await ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
    }
}

/// Shown in place of the modules while the biometric gate is locked.
struct LockView: View {
    @EnvironmentObject private var state: NotchState
    @State private var failed = false

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: BiometricAuth.symbol)
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(Theme.accentGradient)
                .symbolEffect(.pulse, options: .repeating)
            Text("Notch apple is locked").font(.headline).foregroundStyle(.white)
            if failed {
                Text("Authentication failed — try again.").font(.caption).foregroundStyle(.red.opacity(0.9))
            }
            Button("Unlock with \(BiometricAuth.methodName)", action: unlock)
                .buttonStyle(PurpleButtonStyle())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task { unlock() }
    }

    private func unlock() {
        Task { @MainActor in
            let ok = await BiometricAuth.authenticate(reason: "unlock Notch apple")
            withAnimation(Theme.spring) {
                state.isUnlocked = ok
                failed = !ok
            }
        }
    }
}
