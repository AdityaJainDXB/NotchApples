//
//  KeySecurityView.swift
//  Notch Apple
//
//  A key belongs to one email address. Two screens:
//  • VerifyKeyView: shown when a Mac that is new to a key activates it. An email with a six-digit code is the default; someone who set up
//    an authenticator app can enter its code instead. It is asked once per Mac: after that this Mac is remembered.
//  • KeySecuritySection (Settings → License): add an email to a key that has none, and set up or remove the optional authenticator app
//    (Google Authenticator, Microsoft Authenticator, 1Password…) with a QR code.
//

import SwiftUI
import CoreImage.CIFilterBuiltins

/// A QR code for `text`, drawn crisp (no blur) on white so phone cameras read it in dark mode too.
func qrImage(_ text: String, size: CGFloat = 150) -> Image? {
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(text.utf8)
    filter.correctionLevel = "M"
    guard let out = filter.outputImage else { return nil }
    let scale = max(1, floor(size * 2 / (out.extent.width + 8)))
    let scaled = out.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    let ctx = CIContext()
    guard let cg = ctx.createCGImage(scaled, from: scaled.extent) else { return nil }
    return Image(decorative: cg, scale: 2).interpolation(.none)
}

private struct CodeField: View {
    @Binding var text: String
    var focus: FocusState<Bool>.Binding
    var onSubmit: () -> Void
    var body: some View {
        TextField("6-digit code", text: $text)
            .textFieldStyle(.plain)
            .font(.system(size: 20, weight: .bold, design: .monospaced))
            .multilineTextAlignment(.center)
            .foregroundStyle(.white)
            .focused(focus)
            .frame(width: 170, height: 38)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.separator))
            .onChange(of: text) { _, new in
                let digits = String(new.filter(\.isNumber).prefix(6))
                if digits != new { text = digits }
            }
            .onSubmit(onSubmit)
    }
}

private struct EmailField: View {
    @Binding var text: String
    var focus: FocusState<Bool>.Binding
    var onSubmit: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Your email address").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
            TextField("", text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.white)
                .autocorrectionDisabled()
                .focused(focus)
                .padding(.horizontal, 12).frame(minWidth: 240).frame(height: 36)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.separator))
                .onSubmit(onSubmit)
                .accessibilityLabel("Your email address")
        }
    }
}

private let errorColor = Color(red: 1, green: 0.45, blue: 0.5)
private func validEmail(_ s: String) -> Bool {
    let t = s.trimmingCharacters(in: .whitespaces)
    return t.contains("@") && t.split(separator: "@").count == 2 && t.contains(".") && !t.contains(" ")
}

/// Confirms a new Mac for a key: email, then code (or the authenticator app's code). `onDone` runs after the key is activated here.
struct VerifyKeyView: View {
    let key: String
    let bound: Bool
    let hint: String?
    var onDone: () -> Void
    /// Nil hides the Cancel button (the email gate cannot be cancelled).
    var onCancel: (() -> Void)?
    /// Remember a requested code (the email typed and when it was sent) so that leaving to read the email, or restarting the app,
    /// brings the person back to the code box instead of asking for the email again while the code is still valid.
    var remember = false

    private enum Step { case email, code, authenticator }
    @State private var step: Step
    @State private var email: String

    private static let emailKey = "license.verify.email", sentKey = "license.verify.sentAt", codeLife: TimeInterval = 10 * 60

    init(key: String, bound: Bool, hint: String?, onDone: @escaping () -> Void, onCancel: (() -> Void)? = nil, remember: Bool = false) {
        self.key = key; self.bound = bound; self.hint = hint; self.onDone = onDone; self.onCancel = onCancel; self.remember = remember
        let d = UserDefaults.standard
        let fresh = remember && Date().timeIntervalSince1970 - d.double(forKey: Self.sentKey) < Self.codeLife
        _step = State(initialValue: fresh ? .code : .email)
        _email = State(initialValue: remember ? (d.string(forKey: Self.emailKey) ?? "") : "")
        if remember && !fresh { d.removeObject(forKey: Self.emailKey) }
    }

    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool
    @FocusState private var emailFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(step == .email ? "Confirm it's you" : (step == .code ? "Check your email" : "Authenticator code"))
                .font(.system(size: 17, weight: .bold)).foregroundStyle(.white)
            Text(subtitle).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)

            switch step {
            case .email:
                HStack(spacing: 8) {
                    EmailField(text: $email, focus: $focused, onSubmit: send)
                    Button(busy ? "Sending…" : "Email me a code", action: send).buttonStyle(PurpleButtonStyle()).disabled(busy || !validEmail(email))
                }
            case .code, .authenticator:
                if step == .authenticator { EmailField(text: $email, focus: $emailFocused, onSubmit: confirm) }
                HStack(spacing: 8) {
                    CodeField(text: $code, focus: $focused, onSubmit: confirm)
                    Button(busy ? "Checking…" : "Confirm", action: confirm).buttonStyle(PurpleButtonStyle()).disabled(busy || code.count != 6 || !validEmail(email))
                }
            }
            if let error { Text(error).font(.system(size: 12, weight: .medium)).foregroundStyle(errorColor).fixedSize(horizontal: false, vertical: true) }

            HStack(spacing: 14) {
                if let onCancel { Button("Cancel", action: onCancel) }
                switch step {
                case .email: Button("I use an authenticator app") { step = .authenticator; code = ""; error = nil }
                case .code: Button("Use a different email") { step = .email; code = ""; error = nil; UserDefaults.standard.removeObject(forKey: Self.sentKey) }
                case .authenticator: Button("Email me a code instead") { step = .email; code = ""; error = nil }
                }
            }
            .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(Theme.accent)
        }
        .frame(maxWidth: 420, alignment: .leading)
        .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { focused = true } }
        .onChange(of: step) { _, new in DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { if new == .authenticator { emailFocused = true } else { focused = true } } }
    }

    private var subtitle: String {
        switch step {
        case .email:
            bound ? "This key belongs to an email address\(hint.map { " (\($0))" } ?? ""). Enter it and we'll send a code to confirm this Mac. You only do this once per Mac."
                  : "Enter your email address. We'll send a code, and the key will belong to that address from now on."
        case .code: "If \(email) is the address this key belongs to, we sent it a 6-digit code (valid 10 minutes, check spam too). If it is not, no code is sent: only the key's owner can sign in on a new device."
        case .authenticator: "Enter your email and the 6-digit code your authenticator app shows for Notch Apple."
        }
    }

    private func send() {
        guard validEmail(email), !busy else { return }
        busy = true; error = nil
        Task {
            let e = await Entitlements.shared.requestCode(key: key, email: email)
            busy = false
            if let e { error = e } else {
                code = ""; step = .code
                if remember { UserDefaults.standard.set(email, forKey: Self.emailKey); UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.sentKey) }
            }
        }
    }

    private func confirm() {
        guard code.count == 6, validEmail(email), !busy else { return }
        busy = true; error = nil
        Task {
            let e = await Entitlements.shared.verify(key: key, email: email, code: code, totp: step == .authenticator)
            busy = false
            if let e { error = e } else {
                UserDefaults.standard.removeObject(forKey: Self.emailKey); UserDefaults.standard.removeObject(forKey: Self.sentKey)
                onDone()
            }
        }
    }
}

/// Settings → License → Security.
struct KeySecuritySection: View {
    @StateObject private var entitlements = Entitlements.shared
    @State private var status: (email: Bool, hint: String?, totp: Bool)?
    @State private var loaded = false

    // add email
    @State private var email = ""
    @State private var emailSent = false
    // authenticator
    @State private var setup: (uri: String, secret: String)?
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @State private var info: String?

    var body: some View {
        if entitlements.key != nil {
            Section {
                if !loaded {
                    Text("Checking…").foregroundStyle(.secondary)
                } else if let status {
                    if !status.email { addEmail } else {
                        Label("This key belongs to \(status.hint ?? "your email"). A new device confirms with a code we email you, once.", systemImage: "checkmark.shield.fill")
                            .foregroundStyle(.green)
                        authenticator(status)
                    }
                    if let info { Text(info).foregroundStyle(.green).font(.callout) }
                    if let error { Text(error).foregroundStyle(.red).font(.callout) }
                } else {
                    Text(entitlements.securityProblem ?? "Couldn't reach the server. Try again when you're online.").foregroundStyle(.secondary)
                    Button("Try again") { Task { loaded = false; await refresh() } }
                }
            } header: {
                Text("Security")
            } footer: {
                Text("If your key is ever shared by mistake, nobody can use it on a new device without a code from your inbox. This Mac is already confirmed, so you won't be asked again.")
            }
            .task { await refresh() }
        }
    }

    private var addEmail: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Add your email to protect this key", systemImage: "exclamationmark.shield").foregroundStyle(.orange)
            Text("Your key has no email yet. Add one: we send a code to confirm it, and the key then works on a new device only with a code from that inbox.")
                .font(.callout).foregroundStyle(.secondary)
            if !emailSent {
                HStack {
                    TextField("Your email address", text: $email).textFieldStyle(.roundedBorder).autocorrectionDisabled()
                    Button("Email me a code") {
                        run { if let e = await entitlements.addEmailStart(email) { error = e } else { emailSent = true; code = "" } }
                    }.disabled(busy || !validEmail(email))
                }
            } else {
                Text("We sent a code to \(email).").font(.callout)
                HStack {
                    TextField("6-digit code", text: $code).textFieldStyle(.roundedBorder).monospaced().frame(width: 130)
                        .onChange(of: code) { _, new in let d = String(new.filter(\.isNumber).prefix(6)); if d != new { code = d } }
                    Button("Confirm") {
                        run {
                            if let e = await entitlements.addEmailFinish(email, code: code) { error = e }
                            else { info = "Email added. Your key is now protected."; emailSent = false; await refresh() }
                        }
                    }.disabled(busy || code.count != 6)
                    Button("Cancel") { emailSent = false; error = nil }
                }
            }
        }
    }

    @ViewBuilder private func authenticator(_ status: (email: Bool, hint: String?, totp: Bool)) -> some View {
        if status.totp {
            VStack(alignment: .leading, spacing: 8) {
                Label("Authenticator app is on: a new device can use its code instead of the email.", systemImage: "lock.shield.fill")
                HStack {
                    TextField("Current code", text: $code).textFieldStyle(.roundedBorder).monospaced().frame(width: 130)
                        .onChange(of: code) { _, new in let d = String(new.filter(\.isNumber).prefix(6)); if d != new { code = d } }
                    Button("Turn off", role: .destructive) {
                        run { if let e = await entitlements.totpDisable(code) { error = e } else { info = "Authenticator app turned off."; code = ""; await refresh() } }
                    }.disabled(busy || code.count != 6)
                }
            }
        } else if let setup {
            VStack(alignment: .leading, spacing: 8) {
                Text("1. Scan this with Google Authenticator, Microsoft Authenticator or another app").font(.callout)
                if let img = qrImage(setup.uri) { img.resizable().interpolation(.none).frame(width: 150, height: 150).padding(8).background(.white, in: RoundedRectangle(cornerRadius: 10)) }
                Text("Can't scan? Enter this key by hand:").font(.caption).foregroundStyle(.secondary)
                Text(setup.secret).monospaced().textSelection(.enabled).font(.callout)
                Text("2. Enter the 6-digit code it shows").font(.callout)
                HStack {
                    TextField("6-digit code", text: $code).textFieldStyle(.roundedBorder).monospaced().frame(width: 130)
                        .onChange(of: code) { _, new in let d = String(new.filter(\.isNumber).prefix(6)); if d != new { code = d } }
                    Button("Turn on") {
                        run { if let e = await entitlements.totpConfirm(code) { error = e } else { info = "Authenticator app is on."; self.setup = nil; code = ""; await refresh() } }
                    }.disabled(busy || code.count != 6)
                    Button("Cancel") { self.setup = nil; code = ""; error = nil }
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("Optional: confirm a new device with an authenticator app instead of waiting for an email.").font(.callout).foregroundStyle(.secondary)
                Button("Set up an authenticator app…") {
                    run { if let s = await entitlements.totpSetup() { setup = s; code = "" } else { error = await entitlements.totpSetupError() } }
                }.disabled(busy)
            }
        }
    }

    private func run(_ work: @escaping () async -> Void) {
        guard !busy else { return }
        busy = true; error = nil; info = nil
        Task { await work(); busy = false }
    }

    private func refresh() async {
        status = await entitlements.securityStatus()
        loaded = true
    }
}
