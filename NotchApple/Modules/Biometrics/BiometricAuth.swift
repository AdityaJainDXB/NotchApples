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
    @EnvironmentObject private var settings: SettingsManager
    @StateObject private var face = FaceUnlockEngine()
    @State private var failed = false
    @State private var usingFace = false

    private var faceAvailable: Bool { settings.faceUnlockEnabled && FaceTemplateStore.isEnrolled }

    var body: some View {
        VStack(spacing: 14) {
            if usingFace {
                FaceScanView(engine: face, size: 130)
            } else {
                Image(systemName: BiometricAuth.symbol)
                    .font(.system(size: 44, weight: .light))
                    .foregroundStyle(Theme.accentGradient)
                    .symbolEffect(.pulse, options: .repeating)
            }
            Text("Notch apple is locked").font(.headline).foregroundStyle(.white)
            if failed {
                Text("Not recognised. Try again.").font(.caption).foregroundStyle(.red.opacity(0.9))
            }
            HStack {
                if faceAvailable && !usingFace {
                    Button { unlockWithFace() } label: { Label("Unlock with face", systemImage: "faceid") }
                        .buttonStyle(PurpleButtonStyle())
                }
                Button("Use \(BiometricAuth.methodName)", action: unlockWithSystem)
                    .buttonStyle(PurpleButtonStyle(prominent: !faceAvailable))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task { faceAvailable ? unlockWithFace() : unlockWithSystem() }
        .onDisappear { face.stop() }
    }

    private func unlockWithFace() {
        failed = false
        usingFace = true
        face.verify { ok in
            withAnimation(Theme.spring) {
                usingFace = false
                if ok { state.isUnlocked = true } else { failed = true }
            }
        }
    }

    /// Touch ID / Apple Watch / password: always available as the fallback.
    private func unlockWithSystem() {
        face.stop()
        usingFace = false
        Task { @MainActor in
            let ok = await BiometricAuth.authenticate(reason: "unlock Notch apple")
            withAnimation(Theme.spring) {
                state.isUnlocked = ok
                failed = !ok
            }
        }
    }
}
