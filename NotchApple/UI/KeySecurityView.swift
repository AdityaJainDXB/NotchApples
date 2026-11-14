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

/// Six digit cells split 3 + 3 over one real text field (typing, paste and autofill all work); the next cell glows blue.
private struct CodeField: View {
    @Binding var text: String
    var focus: FocusState<Bool>.Binding
    var onSubmit: () -> Void

    private func cell(_ i: Int) -> some View {
        let digits = Array(text)
        let lit = focus.wrappedValue && i == min(digits.count, 5)
        return ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(LinearGradient(colors: [.white.opacity(0.045), .white.opacity(0.015)], startPoint: .top, endPoint: .bottom))
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(lit ? Color(red: 0.73, green: 0.78, blue: 1).opacity(0.55) : .white.opacity(0.08), lineWidth: 1)
            if i < digits.count {
                Text(String(digits[i])).font(.system(size: 24, weight: .light)).foregroundStyle(Color(red: 0.95, green: 0.95, blue: 0.97))
            } else if lit {
                Rectangle().fill(Color(red: 0.73, green: 0.78, blue: 1)).frame(width: 1.5, height: 24)
            }
        }
        .frame(width: 36, height: 46)
        .shadow(color: lit ? Color(red: 0.59, green: 0.69, blue: 1).opacity(0.45) : .clear, radius: 8)
        .animation(Theme.quick, value: lit)
    }

    var body: some View {
        ZStack {
            HStack(spacing: 6) {
                ForEach(0..<3, id: \.self) { cell($0) }
                Capsule().fill(.white.opacity(0.2)).frame(width: 8, height: 1.5).padding(.horizontal, 3)
                ForEach(3..<6, id: \.self) { cell($0) }
            }
            .allowsHitTesting(false)
            TextField("", text: $text)
                .textFieldStyle(.plain)
                .focused(focus)
                .foregroundStyle(.clear).tint(.clear)
                .opacity(0.02)
                .onChange(of: text) { _, new in
                    let digits = String(new.filter(\.isNumber).prefix(6))
                    if digits != new { text = digits }
                }
                .onSubmit(onSubmit)
                .accessibilityLabel("6-digit code")
        }
        .frame(width: 6 * 36 + 5 * 6 + 14, height: 46)
        .contentShape(Rectangle())
        .onTapGesture { focus.wrappedValue = true }
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
    /// The key has a passkey: offer "Use a passkey (Touch ID)", which opens the website's passkey page in the browser.
    var passkey = false
    var onDone: () -> Void
    /// Nil hides the Cancel button (the email gate cannot be cancelled).
    var onCancel: (() -> Void)?
    /// Remember a requested code (the email typed and when it was sent) so that leaving to read the email, or restarting the app,
    /// brings the person back to the code box instead of asking for the email again while the code is still valid.
    var remember = false

    private enum Step { case email, code, authenticator, passkey }
    @State private var step: Step
    @State private var email: String

    private static let emailKey = "license.verify.email", sentKey = "license.verify.sentAt", codeLife: TimeInterval = 10 * 60

    init(key: String, bound: Bool, hint: String?, passkey: Bool = false, onDone: @escaping () -> Void, onCancel: (() -> Void)? = nil, remember: Bool = false) {
        self.key = key; self.bound = bound; self.hint = hint; self.passkey = passkey; self.onDone = onDone; self.onCancel = onCancel; self.remember = remember
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
            Text(step == .email ? "Confirm it's you" : (step == .code ? "Check your email" : (step == .passkey ? "Use your passkey" : "Authenticator code")))
                .font(.system(size: 17, weight: .bold)).foregroundStyle(.white)
            Text(subtitle).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)

            switch step {
            case .email:
                HStack(spacing: 8) {
                    EmailField(text: $email, focus: $focused, onSubmit: send)
                    Button(busy ? "Sending…" : "Email me a code", action: send).buttonStyle(PurpleButtonStyle()).disabled(busy || !validEmail(email))
                }
            case .passkey:
                HStack(spacing: 10) {
                    if busy { ProgressView().controlSize(.small) }
                    Button(busy ? "Waiting for your browser…" : "Open my browser", action: usePasskey).buttonStyle(PurpleButtonStyle()).disabled(busy)
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
                case .email:
                    Button("I use an authenticator app") { step = .authenticator; code = ""; error = nil }
                    if passkey { Button("Use a passkey (Touch ID)") { step = .passkey; error = nil } }
                case .code: Button("Use a different email") { step = .email; code = ""; error = nil; UserDefaults.standard.removeObject(forKey: Self.sentKey) }
                case .authenticator: Button("Email me a code instead") { step = .email; code = ""; error = nil }
                case .passkey: Button("Email me a code instead") { step = .email; error = nil }
                }
            }
            .buttonStyle(MetalPlainStyle()).font(.system(size: 11)).foregroundStyle(Theme.accent)
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
        case .passkey: "Your browser opens a page on our website. Confirm with Touch ID (or your device PIN) there, then come back: this Mac continues by itself. No email is needed."
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

    private func usePasskey() {
        guard !busy else { return }
        busy = true; error = nil
        Task {
            let b = await Entitlements.shared.passkeyBegin("verify", key: key)
            guard let ticket = b.ticket else { busy = false; error = b.error; return }
            NSWorkspace.shared.open(ticket.url)
            if let e = await Entitlements.shared.passkeyWait(ticket.id) { busy = false; error = e; return }
            let e = await Entitlements.shared.passkeyActivate(key: key, ticket: ticket.id)
            busy = false
            if let e { error = e } else { UserDefaults.standard.removeObject(forKey: Self.emailKey); UserDefaults.standard.removeObject(forKey: Self.sentKey); onDone() }
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
    @State private var status: Entitlements.SecurityStatus?
    @State private var loaded = false

    @State private var error: String?
    @State private var info: String?

    var body: some View {
        if entitlements.key != nil {
            Section {
                if !loaded {
                    Text("Checking…").foregroundStyle(.secondary)
                } else if let status {
                    if status.email {
                        Label("This key belongs to \(status.hint ?? "your email"). A new device confirms with a code we email you, once.", systemImage: "checkmark.shield.fill")
                            .foregroundStyle(.green)
                        authenticator(status)
                    } else if status.passkeys > 0 {
                        Label("This key is protected by your passkey. A new device confirms with it, once. No email is needed.", systemImage: "checkmark.shield.fill").foregroundStyle(.green)
                    } else { addEmail }
                    passkeyBlock(status)
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
            Button("Add my email…") { KeySecurityWindow.shared.show(.addEmail) { info = "Email added. Your key is now protected."; Task { await refresh() } } }
        }
    }

    @ViewBuilder private func passkeyBlock(_ status: Entitlements.SecurityStatus) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if status.passkeys > 0 {
                Label("Passkey is on: a new Mac or PC can confirm with Touch ID instead of a code. It syncs through iCloud Keychain, Google or your password manager.", systemImage: "touchid")
                Button("Remove the passkey…", role: .destructive) { KeySecurityWindow.shared.show(.removePasskey) { info = "Passkey removed."; Task { await refresh() } } }
            } else {
                Text("Optional: use a passkey (Touch ID, or Windows Hello) to confirm a new device, with no email code. It opens your browser for a moment.").font(.callout).foregroundStyle(.secondary)
                Button("Add a passkey (Touch ID)…") { KeySecurityWindow.shared.show(.addPasskey) { info = "Passkey is on."; Task { await refresh() } } }
            }
        }
    }

    @ViewBuilder private func authenticator(_ status: Entitlements.SecurityStatus) -> some View {
        if status.totp {
            VStack(alignment: .leading, spacing: 8) {
                Label("Authenticator app is on: a new device can use its code instead of the email.", systemImage: "lock.shield.fill")
                Button("Turn off…", role: .destructive) { KeySecurityWindow.shared.show(.turnOff) { info = "Authenticator app turned off."; Task { await refresh() } } }
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("Optional: confirm a new device with an authenticator app instead of waiting for an email.").font(.callout).foregroundStyle(.secondary)
                Button("Set up an authenticator app…") { KeySecurityWindow.shared.show(.authenticator) { info = "Authenticator app is on."; Task { await refresh() } } }
            }
        }
    }

    private func refresh() async {
        status = await entitlements.securityStatus()
        loaded = true
    }
}

/// Add an email, set up the authenticator app, or turn it off: each in its own window. The boxes in the Settings form did not reliably take
/// typing (the same reason confirming a key's email has a window), and a window also stays open while you pick up your phone.
@MainActor
final class KeySecurityWindow {
    enum Mode { case addEmail, authenticator, turnOff, addPasskey, removePasskey }
    static let shared = KeySecurityWindow()
    private var window: NSWindow?

    func show(_ mode: Mode, onDone: @escaping () -> Void) {
        close()
        let view = SecurityWindowView(mode: mode, onDone: { [weak self] in self?.close(); onDone() }, onCancel: { [weak self] in self?.close() })
        let w = NSWindow(contentViewController: NSHostingController(rootView: view))
        w.title = mode == .addEmail ? "Notch Apple: add your email" : (mode == .addPasskey || mode == .removePasskey ? "Notch Apple: passkey" : "Notch Apple: authenticator app")
        w.styleMask = [.titled, .closable]
        w.isReleasedWhenClosed = false
        w.hidesOnDeactivate = false
        w.center()
        window = w
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
    }
    private func close() { window?.close(); window = nil }
}

private struct SecurityWindowView: View {
    let mode: KeySecurityWindow.Mode
    var onDone: () -> Void
    var onCancel: () -> Void
    @StateObject private var entitlements = Entitlements.shared
    @FocusState private var focused: Bool
    @State private var email = ""
    @State private var emailSent = false
    @State private var setup: (uri: String, secret: String)?
    @State private var code = ""
    @State private var busy = false
    @State private var loading = false
    @State private var error: String?
    @State private var finished: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            switch mode {
            case .addEmail: addEmail
            case .authenticator: authenticator
            case .turnOff: turnOff
            case .addPasskey, .removePasskey: passkeyFlow
            }
            if let finished { Label(finished, systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
            if let error { Text(error).foregroundStyle(errorColor).font(.callout).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(24)
        .frame(width: 440)
        .background(Color(white: 0.09))
        .preferredColorScheme(.dark)
        .task { if mode == .authenticator { await start() } else if mode == .addPasskey || mode == .removePasskey { await startPasskey() } else { focused = true } }
    }

    private func work(_ job: @escaping () async -> Void) {
        guard !busy else { return }
        busy = true; error = nil
        Task { await job(); busy = false }
    }
    private func done(_ message: String) {
        finished = message
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) { onDone() }
    }
    private func start() async {
        loading = true; error = nil
        if let s = await entitlements.totpSetup() { setup = s; code = ""; focused = true } else { error = await entitlements.totpSetupError() }
        loading = false
    }

    private var addEmail: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Add your email").font(.title3.weight(.semibold))
            if !emailSent {
                Text("We send a code to confirm it. After that the key works on a new device only with a code from this inbox.").font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                EmailField(text: $email, focus: $focused, onSubmit: sendEmail)
                HStack { Button("Email me a code", action: sendEmail).disabled(busy || !validEmail(email)); Button("Cancel", action: onCancel) }
            } else {
                Text("We sent a code to \(email) (valid 10 minutes, check spam too).").font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                CodeField(text: $code, focus: $focused, onSubmit: confirmEmail)
                HStack { Button("Confirm", action: confirmEmail).disabled(busy || code.count != 6); Button("Back") { emailSent = false; code = ""; error = nil; focused = true } }
            }
        }
    }
    private func sendEmail() { guard validEmail(email) else { return }; work { if let e = await entitlements.addEmailStart(email) { error = e } else { emailSent = true; code = ""; focused = true } } }
    private func confirmEmail() { guard code.count == 6 else { return }; work { if let e = await entitlements.addEmailFinish(email, code: code) { error = e } else { done("Email added. Your key is now protected.") } } }

    private var authenticator: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Set up an authenticator app").font(.title3.weight(.semibold))
            if loading { ProgressView("Getting your code…") }
            else if let setup {
                Text("1. Open Google Authenticator, Microsoft Authenticator or another app, add an account and scan this").font(.callout).fixedSize(horizontal: false, vertical: true)
                if let img = qrImage(setup.uri, size: 170) {
                    img.resizable().interpolation(.none).frame(width: 170, height: 170).padding(14).background(.white, in: RoundedRectangle(cornerRadius: 12)).frame(maxWidth: .infinity)
                }
                Text("Can't scan? Choose \"Enter a setup key\" in the app and type this:").font(.caption).foregroundStyle(.secondary)
                Text(setup.secret).monospaced().textSelection(.enabled).font(.callout)
                Text("2. Type the 6-digit code the app now shows for Notch Apple").font(.callout)
                CodeField(text: $code, focus: $focused, onSubmit: turnOn)
                HStack { Button("Turn on", action: turnOn).disabled(busy || code.count != 6); Button("Cancel", action: onCancel) }
            } else {
                Button("Try again") { Task { await start() } }
                Button("Close", action: onCancel)
            }
        }
    }
    private func turnOn() { guard code.count == 6 else { return }; work { if let e = await entitlements.totpConfirm(code) { error = e } else { done("Authenticator app is on.") } } }

    @State private var passkeyURL: URL?
    private var passkeyFlow: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(mode == .addPasskey ? "Add a passkey" : "Remove the passkey").font(.title3.weight(.semibold))
            Text(mode == .addPasskey
                 ? "Your browser opens a page on our website. Confirm with Touch ID (or your device PIN) there, then come back. The passkey stays in your browser or password manager and syncs with your other devices."
                 : "Your browser opens a page on our website. Confirm with your passkey there, then come back. New devices will use the email code again.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if loading || (passkeyURL != nil && finished == nil && error == nil) { HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Waiting for your browser…").font(.callout) } }
            HStack {
                if let passkeyURL, finished == nil { Button("Open the page again") { NSWorkspace.shared.open(passkeyURL) } }
                if error != nil && finished == nil { Button("Try again") { Task { await startPasskey() } } }
                Button("Cancel", action: onCancel)
            }
        }
    }
    private func startPasskey() async {
        loading = true; error = nil; passkeyURL = nil
        let b = await entitlements.passkeyBegin(mode == .addPasskey ? "add" : "remove")
        loading = false
        guard let ticket = b.ticket else { error = b.error; return }
        passkeyURL = ticket.url
        NSWorkspace.shared.open(ticket.url)
        if let e = await entitlements.passkeyWait(ticket.id) { error = e; return }
        if mode == .addPasskey { done("Passkey is on.") }
        else if let e = await entitlements.passkeyRemove(ticket: ticket.id) { error = e } else { done("Passkey removed.") }
    }

    private var turnOff: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Turn off the authenticator app").font(.title3.weight(.semibold))
            Text("Enter the 6-digit code your app shows now. A new device will then confirm with an email code again.").font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            CodeField(text: $code, focus: $focused, onSubmit: turnOffNow)
            HStack { Button("Turn off", role: .destructive, action: turnOffNow).disabled(busy || code.count != 6); Button("Cancel", action: onCancel) }
        }
    }
    private func turnOffNow() { guard code.count == 6 else { return }; work { if let e = await entitlements.totpDisable(code) { error = e } else { done("Authenticator app turned off.") } } }
}
