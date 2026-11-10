//
//  BiometricAuth.swift
//  Notch Apple
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
    @State private var code = ""
    @State private var wait = 0
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var faceAvailable: Bool { settings.faceUnlockEnabled && FaceTemplateStore.isEnrolled }

    var body: some View {
        VStack(spacing: 14) {
            if usingFace {
                FaceScanView(engine: face, size: 110, showsCamera: false)
            } else {
                Image(systemName: BiometricAuth.symbol)
                    .font(.system(size: 44, weight: .light))
                    .foregroundStyle(Theme.accentGradient)
                    .symbolEffect(.pulse, options: .repeating)
            }
            Text("Notch Apple is locked").font(.headline).foregroundStyle(.white)
            if failed {
                Text("Not recognised. Try again.").font(.caption).foregroundStyle(.red.opacity(0.9))
            }
            if LockCodeStore.isSet { codeEntry }
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
        .task {
            wait = LockCodeStore.waitRemaining()
            // With a code set, the code is the first thing offered; Touch ID is one tap away.
            if LockCodeStore.isSet { return }
            faceAvailable ? unlockWithFace() : unlockWithSystem()
        }
        .onReceive(ticker) { _ in if wait > 0 { wait = LockCodeStore.waitRemaining() } }
        .onDisappear { face.stop() }
    }

    /// Four to eight digits; unlocks by itself as soon as the right code is typed, or on Return.
    private var codeEntry: some View {
        VStack(spacing: 6) {
            SecureField("Code", text: $code)
                .textFieldStyle(.roundedBorder).multilineTextAlignment(.center).frame(width: 150)
                .disabled(wait > 0)
                .onChange(of: code) { _, new in
                    let c = LockCode.cleaned(new)
                    if c != new { code = c; return }
                    if c.count >= LockCode.minLength { tryCode(c, final: false) }
                }
                .onSubmit { tryCode(code, final: true) }
            if wait > 0 {
                Text("Too many tries. Wait \(wait) s.").font(.caption).foregroundStyle(.orange)
            }
        }
    }

    /// While typing, only a right code counts (a wrong prefix is not a try); Return counts a wrong code.
    private func tryCode(_ c: String, final: Bool) {
        guard wait == 0 else { return }
        if !final && !LockCodeStore.isRight(c) { if c.count == LockCode.maxLength { tryCode(c, final: true) }; return }
        if LockCodeStore.check(c) {
            StatusPulse.shared.unlockAttempt(success: true)
            withAnimation(Theme.spring) { state.isUnlocked = true }
        } else {
            StatusPulse.shared.unlockAttempt(success: false)
            failed = true; code = ""; wait = LockCodeStore.waitRemaining()
        }
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
            let ok = await BiometricAuth.authenticate(reason: "unlock Notch Apple")
            withAnimation(Theme.spring) {
                state.isUnlocked = ok
                failed = !ok
            }
        }
    }
}

/// Pick a code: four to eight digits, typed twice.
struct LockCodeSetupView: View {
    var onDone: (Bool) -> Void
    @State private var first = ""
    @State private var again = ""

    private var problem: String? {
        if first.isEmpty { return nil }
        if first.count < LockCode.minLength { return "Use \(LockCode.minLength) to \(LockCode.maxLength) digits." }
        if !again.isEmpty && again != first { return "The two codes don't match." }
        return nil
    }
    private var ready: Bool { LockCode.isValid(first) && first == again }

    var body: some View {
        VStack(spacing: 12) {
            Text("Choose a code").font(.title3.bold())
            Text("\(LockCode.minLength) to \(LockCode.maxLength) digits. It unlocks the tabs you lock, instead of Touch ID or your Mac password.")
                .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            SecureField("Code", text: $first).textFieldStyle(.roundedBorder).frame(width: 160)
                .onChange(of: first) { _, v in first = LockCode.cleaned(v) }
            SecureField("Again", text: $again).textFieldStyle(.roundedBorder).frame(width: 160)
                .onChange(of: again) { _, v in again = LockCode.cleaned(v) }
                .onSubmit { save() }
            Text(problem ?? " ").font(.caption).foregroundStyle(.orange)
            HStack {
                Button("Cancel") { onDone(false) }.keyboardShortcut(.cancelAction)
                Button("Save code") { save() }.keyboardShortcut(.defaultAction).disabled(!ready)
            }
        }
        .padding(24).frame(width: 340)
    }

    private func save() {
        guard ready, LockCodeStore.set(first) else { return }
        onDone(true)
    }
}

/// Shown once, in place of the Messenger tab the first time you open it: lock your messages with Touch ID / your password, or with a code.
struct ChatLockOffer: View {
    @EnvironmentObject private var state: NotchState
    @EnvironmentObject private var settings: SettingsManager
    var onDone: () -> Void = {}
    @State private var settingCode = false

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: BiometricAuth.symbol).font(.system(size: 34, weight: .light)).foregroundStyle(Theme.accentGradient)
            Text("Lock your messages?").font(.headline).foregroundStyle(.white)
            Text("Ask for \(BiometricAuth.methodName) or a code before Messenger opens. Every other tab stays as it is.")
                .font(.caption).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center).frame(maxWidth: 280)
            HStack {
                Button("Use \(BiometricAuth.methodName)") { lock() }.buttonStyle(PurpleButtonStyle())
                Button("Use a code…") { settingCode = true }.buttonStyle(PurpleButtonStyle(prominent: false))
            }
            Button("Not now") { settings.chatLockOfferDone = true; onDone() }.buttonStyle(.plain)
                .font(.caption).foregroundStyle(Theme.textSecondary).hitTarget()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sheet(isPresented: $settingCode) {
            LockCodeSetupView { saved in
                settingCode = false
                if saved { lock() }
            }
        }
    }

    /// You just chose it, so this open stays unlocked; the next one asks.
    private func lock() {
        settings.lockMessages()
        state.isUnlocked = true
        onDone()
    }
}
