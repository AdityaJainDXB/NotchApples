//
//  AccountSync.swift
//  Notch apple
//
//  A Notch apple account: sign in with Google (or Apple), and your notch setup
//  and access code are saved to your account (Firebase Auth + Cloud Firestore)
//  and restored on any Mac you sign in on. It works alongside iCloud sync.
//
//  Talks to Firebase's REST APIs directly instead of bundling the Firebase
//  SDK: the app stays small, and there's no keychain-sharing entitlement to
//  sign (which needs a paid developer account). The refresh token is kept in
//  the app's private store (KeychainHelper), like the AI keys.
//
//  Firestore: users/{uid}/settings/notch = { data, updated, mac, version }
//             users/{uid}/license/key    = { codeHash, mask, activated, mac }
//  Only the SHA-256 hash of the access code is stored, never the code itself,
//  and a restored hash only unlocks if it matches one of the real codes.
//  Security rules only let a signed-in user read and write their own document.
//
//  What's synced is exactly what the backup file holds (see SettingsBackup):
//  no AI keys, access code or Messenger identity.
//

import AppKit
import AuthenticationServices
import CryptoKit
import SwiftUI

@MainActor
final class AccountSync: NSObject, ObservableObject {
    static let shared = AccountSync()

    struct Config {
        let apiKey: String, projectID: String, clientID: String, reversedClientID: String
        static let load: Config? = {
            guard let url = Bundle.main.url(forResource: "GoogleService-Info", withExtension: "plist"),
                  let d = NSDictionary(contentsOf: url) as? [String: Any],
                  let key = d["API_KEY"] as? String, let project = d["PROJECT_ID"] as? String else { return nil }
            return Config(apiKey: key, projectID: project, clientID: d["CLIENT_ID"] as? String ?? "",
                          reversedClientID: d["REVERSED_CLIENT_ID"] as? String ?? "")
        }()
    }

    @Published private(set) var email: String?
    @Published private(set) var uid: String?
    @Published private(set) var busy = false
    @Published private(set) var lastSync: Date?
    @Published private(set) var cloudCopy: Date?
    @Published var message: String?
    @AppStorage("account.sync") var autoSync = true
    @AppStorage("account.email") private var savedEmail = ""
    @AppStorage("account.uid") private var savedUID = ""

    private var idToken: String?
    private var idTokenExpiry = Date.distantPast
    private var saveWork: DispatchWorkItem?
    private var observer: NSObjectProtocol?
    private var authSession: ASWebAuthenticationSession?

    var isSignedIn: Bool { uid != nil }

    override init() {
        super.init()
        if KeychainHelper.get(.accountRefreshToken) != nil, !savedUID.isEmpty {
            uid = savedUID
            email = savedEmail
        }
    }

    func start() {
        guard observer == nil else { return }
        observer = NotificationCenter.default.addObserver(forName: UserDefaults.didChangeNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { AccountSync.shared.uploadSoon() }
        }
        if isSignedIn { Task { await refreshCloudInfo() } }
    }

    // MARK: Google (OAuth with PKCE in the system browser sheet)

    func signInWithGoogle() {
        guard let cfg = Config.load, !cfg.clientID.isEmpty else { message = "Google sign-in isn't set up."; return }
        let verifier = Self.randomString(64)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        let redirect = "\(cfg.reversedClientID):/oauth2redirect"
        var comps = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        comps.queryItems = [
            .init(name: "client_id", value: cfg.clientID), .init(name: "redirect_uri", value: redirect),
            .init(name: "response_type", value: "code"), .init(name: "scope", value: "openid email profile"),
            .init(name: "code_challenge", value: challenge), .init(name: "code_challenge_method", value: "S256"),
            .init(name: "prompt", value: "select_account"),
        ]
        let session = ASWebAuthenticationSession(url: comps.url!, callbackURLScheme: cfg.reversedClientID) { [weak self] url, error in
            Task { @MainActor in
                guard let self else { return }
                self.authSession = nil
                guard let url, let code = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value else {
                    if let error, (error as? ASWebAuthenticationSessionError)?.code != .canceledLogin { self.message = error.localizedDescription }
                    return
                }
                await self.finishGoogle(code: code, verifier: verifier, redirect: redirect, cfg: cfg)
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        NSApp.activate(ignoringOtherApps: true)
        session.start()
    }

    private func finishGoogle(code: String, verifier: String, redirect: String, cfg: Config) async {
        busy = true
        defer { busy = false }
        do {
            let tokens = try await Self.postForm("https://oauth2.googleapis.com/token", [
                "code": code, "client_id": cfg.clientID, "code_verifier": verifier,
                "redirect_uri": redirect, "grant_type": "authorization_code",
            ])
            guard let googleID = tokens["id_token"] as? String else { throw AccountError.message("Google didn't return a sign-in token.") }
            let r = try await Self.post("https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=\(cfg.apiKey)", json: [
                "postBody": "id_token=\(googleID)&providerId=google.com", "requestUri": "http://localhost",
                "returnSecureToken": true, "returnIdpCredential": true,
            ])
            try await finishSignIn(r)
        } catch {
            message = Self.friendly(error)
        }
    }

    // MARK: Session

    private func finishSignIn(_ r: [String: Any]) async throws {
        guard let token = r["idToken"] as? String, let refresh = r["refreshToken"] as? String, let id = r["localId"] as? String else {
            throw AccountError.message("Sign-in didn't complete.")
        }
        KeychainHelper.set(refresh, for: .accountRefreshToken)
        idToken = token
        idTokenExpiry = .now.addingTimeInterval(Double(r["expiresIn"] as? String ?? "3600").map { $0 - 120 } ?? 3000)
        uid = id
        email = r["email"] as? String
        savedUID = id
        savedEmail = email ?? ""
        message = "Signed in as \(email ?? "your account")."
        await syncLicense()
        // A saved setup in the account? Offer to restore it. Otherwise save this Mac's setup there.
        if let cloud = try? await download() {
            cloudCopy = cloud.date
            offerRestore(cloud.data, date: cloud.date, mac: cloud.mac)
        } else {
            await upload()
        }
    }

    func signOut() {
        KeychainHelper.delete(.accountRefreshToken)
        idToken = nil
        uid = nil
        email = nil
        savedUID = ""
        savedEmail = ""
        cloudCopy = nil
        lastSync = nil
        message = "Signed out. Your settings on this Mac are unchanged."
    }

    /// A fresh ID token (they last an hour), using the saved refresh token.
    private func token() async throws -> String {
        if let idToken, Date.now < idTokenExpiry { return idToken }
        guard let cfg = Config.load, let refresh = KeychainHelper.get(.accountRefreshToken) else { throw AccountError.message("Please sign in again.") }
        let r = try await Self.postForm("https://securetoken.googleapis.com/v1/token?key=\(cfg.apiKey)",
                                        ["grant_type": "refresh_token", "refresh_token": refresh])
        guard let t = r["id_token"] as? String else { throw AccountError.message("Please sign in again.") }
        if let newRefresh = r["refresh_token"] as? String { KeychainHelper.set(newRefresh, for: .accountRefreshToken) }
        idToken = t
        idTokenExpiry = .now.addingTimeInterval(Double(r["expires_in"] as? String ?? "3600").map { $0 - 120 } ?? 3000)
        return t
    }

    // MARK: Firestore

    private var documentURL: URL? {
        guard let cfg = Config.load, let uid else { return nil }
        return URL(string: "https://firestore.googleapis.com/v1/projects/\(cfg.projectID)/databases/(default)/documents/users/\(uid)/settings/notch")
    }

    func uploadSoon() {
        guard isSignedIn, autoSync, Entitlements.shared.canUse(.sync) else { return }
        saveWork?.cancel()
        let work = DispatchWorkItem { Task { await AccountSync.shared.upload(quietly: true) } }
        saveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: work)
    }

    private var lastUploaded: Data?

    func upload(quietly: Bool = false) async {
        guard let url = documentURL else { return }
        do {
            let payload = try SettingsBackup.encode()
            // Only upload when the settings themselves changed (the file also carries a timestamp).
            let prefs = try SettingsBackup.decode(payload).prefs as NSDictionary
            if let last = lastUploaded, let old = try? SettingsBackup.decode(last).prefs as NSDictionary, old == prefs { return }
            var req = URLRequest(url: url)
            req.httpMethod = "PATCH"
            req.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let now = ISO8601DateFormatter().string(from: .now)
            req.httpBody = try JSONSerialization.data(withJSONObject: ["fields": [
                "data": ["stringValue": payload.base64EncodedString()],
                "updated": ["timestampValue": now],
                "mac": ["stringValue": Host.current().localizedName ?? "Mac"],
                "version": ["stringValue": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""],
            ]])
            let (data, response) = try await URLSession.shared.data(for: req)
            try Self.check(data, response)
            lastUploaded = payload
            lastSync = .now
            cloudCopy = .now
            if !quietly { message = "Saved to your account." }
        } catch {
            if !quietly { message = Self.friendly(error) }
        }
    }

    private func download() async throws -> (data: Data, date: Date?, mac: String)? {
        guard let url = documentURL else { return nil }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: req)
        if (response as? HTTPURLResponse)?.statusCode == 404 { return nil }
        try Self.check(data, response)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let fields = json["fields"] as? [String: Any],
              let b64 = (fields["data"] as? [String: Any])?["stringValue"] as? String,
              let payload = Data(base64Encoded: b64) else { return nil }
        let date = ((fields["updated"] as? [String: Any])?["timestampValue"] as? String).flatMap {
            ISO8601DateFormatter.withFractions.date(from: $0) ?? ISO8601DateFormatter().date(from: $0)
        }
        return (payload, date, ((fields["mac"] as? [String: Any])?["stringValue"] as? String) ?? "Mac")
    }

    func refreshCloudInfo() async {
        cloudCopy = (try? await download())??.date
    }

    func restoreFromAccount() async {
        busy = true
        defer { busy = false }
        do {
            guard let cloud = try await download() else { message = "Nothing saved in your account yet."; return }
            offerRestore(cloud.data, date: cloud.date, mac: cloud.mac)
        } catch {
            message = Self.friendly(error)
        }
    }

    private func offerRestore(_ payload: Data, date: Date?, mac: String) {
        guard let (prefs, _) = try? SettingsBackup.decode(payload) else { return }
        let alert = NSAlert()
        alert.messageText = "Restore your saved notch setup?"
        alert.informativeText = "Your account has a setup saved from \(mac)\(date.map { " on " + $0.formatted(date: .abbreviated, time: .shortened) } ?? ""). Restoring replaces this Mac's modules, layout and preferences, then restarts Notch apple. Choose Keep This Mac's to save this Mac's setup to your account instead."
        alert.addButton(withTitle: "Restore and Restart")
        alert.addButton(withTitle: "Keep This Mac's")
        alert.addButton(withTitle: "Decide Later")
        NSApp.activate(ignoringOtherApps: true)
        switch alert.runModal() {
        case .alertFirstButtonReturn: SettingsBackup.apply(prefs)
        case .alertSecondButtonReturn: Task { await upload() }
        default: break
        }
    }

    // MARK: Access code

    private var licenseURL: URL? {
        guard let cfg = Config.load, let uid else { return nil }
        return URL(string: "https://firestore.googleapis.com/v1/projects/\(cfg.projectID)/databases/(default)/documents/users/\(uid)/license/key")
    }

    /// Saves this Mac's activation (hash + masked code) to the account.
    func uploadLicense() async {
        guard let url = licenseURL, let hash = AccessCodeManager.activeHash else { return }
        do {
            var req = URLRequest(url: url)
            req.httpMethod = "PATCH"
            req.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: ["fields": [
                "codeHash": ["stringValue": hash],
                "mask": ["stringValue": AccessCodeManager.maskedActiveCode],
                "activated": ["timestampValue": ISO8601DateFormatter().string(from: .now)],
                "mac": ["stringValue": Host.current().localizedName ?? "Mac"],
            ]])
            let (data, response) = try await URLSession.shared.data(for: req)
            try Self.check(data, response)
        } catch {
            message = "Couldn't save your access code to your account: \(Self.friendly(error))"
        }
    }

    /// On sign-in: unlock this Mac from the account's saved code, or save this Mac's code to the account.
    func syncLicense() async {
        guard let url = licenseURL else { return }
        if LicenseState.shared.isActivated { await uploadLicense(); return }
        do {
            var req = URLRequest(url: url)
            req.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
            let (data, response) = try await URLSession.shared.data(for: req)
            if (response as? HTTPURLResponse)?.statusCode == 404 { return }
            try Self.check(data, response)
            let fields = (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["fields"] as? [String: Any]
            guard let hash = (fields?["codeHash"] as? [String: Any])?["stringValue"] as? String else { return }
            let mask = ((fields?["mask"] as? [String: Any])?["stringValue"] as? String) ?? "NOTCH-****-****"
            if await LicenseState.shared.activate(hash: hash, mask: mask) {
                message = "Signed in, and Pro is unlocked from your account."
            }
        } catch {
            message = "Signed in, but couldn't check your access code: \(Self.friendly(error))"
        }
    }

    // MARK: Sign in with Apple

    /// Sign in with Apple can only be offered by apps signed with a paid Apple Developer team
    /// (it needs an App ID with the capability, a Services ID and a key registered in Firebase).
    func signInWithApple() {
        let alert = NSAlert()
        alert.messageText = "Sign in with Apple is coming soon"
        alert.informativeText = "Apple only allows Sign in with Apple in apps published through the Apple Developer Program. Until Notch apple is, please continue with Google. Your setup and access code sync the same way."
        alert.addButton(withTitle: "Continue with Google")
        alert.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertFirstButtonReturn { signInWithGoogle() }
    }

    func deleteCloudData() async {
        guard let url = documentURL else { return }
        do {
            var req = URLRequest(url: url)
            req.httpMethod = "DELETE"
            req.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
            let (data, response) = try await URLSession.shared.data(for: req)
            try Self.check(data, response)
            cloudCopy = nil
            lastUploaded = nil
            message = "Deleted the setup saved in your account."
        } catch {
            message = Self.friendly(error)
        }
    }

    // MARK: HTTP helpers

    enum AccountError: LocalizedError {
        case message(String)
        var errorDescription: String? { if case .message(let m) = self { return m }; return nil }
    }

    private static func post(_ url: String, json: [String: Any]) async throws -> [String: Any] {
        var req = URLRequest(url: URL(string: url)!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: json)
        let (data, response) = try await URLSession.shared.data(for: req)
        try check(data, response)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    private static func postForm(_ url: String, _ form: [String: String]) async throws -> [String: Any] {
        var req = URLRequest(url: URL(string: url)!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var comps = URLComponents()
        comps.queryItems = form.map { URLQueryItem(name: $0.key, value: $0.value) }
        req.httpBody = comps.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B").data(using: .utf8)
        let (data, response) = try await URLSession.shared.data(for: req)
        try check(data, response)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    private static func check(_ data: Data, _ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) else { return }
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        let err = json?["error"]
        let msg = (err as? [String: Any])?["message"] as? String ?? (err as? String) ?? (json?["error_description"] as? String) ?? "HTTP \(http.statusCode)"
        throw AccountError.message(msg)
    }

    /// Firebase's error codes, in plain words.
    private static func friendly(_ error: Error) -> String {
        let raw = error.localizedDescription
        let map: [String: String] = [
            "EMAIL_EXISTS": "There's already an account with that email. Sign in instead.",
            "EMAIL_NOT_FOUND": "No account with that email. Create one instead.",
            "INVALID_PASSWORD": "Wrong password.",
            "INVALID_LOGIN_CREDENTIALS": "Wrong email or password.",
            "INVALID_EMAIL": "That email address doesn't look right.",
            "WEAK_PASSWORD": "Use a password with at least 6 characters.",
            "TOO_MANY_ATTEMPTS_TRY_LATER": "Too many attempts. Try again in a few minutes.",
            "USER_DISABLED": "This account has been disabled.",
            "OPERATION_NOT_ALLOWED": "This sign-in method isn't turned on for Notch apple yet.",
            "PERMISSION_DENIED": "Your account couldn't access its saved setup. Try signing out and in again.",
        ]
        return map.first { raw.hasPrefix($0.key) }?.value ?? raw
    }

    private static func randomString(_ n: Int) -> String {
        let chars = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        return String((0..<n).map { _ in chars.randomElement()! })
    }
}

extension AccountSync: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { SettingsWindowController.currentWindow ?? NSApp.keyWindow ?? NSWindow() }
    }
}

private extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

extension ISO8601DateFormatter {
    static let withFractions: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

// MARK: - Settings UI

struct AccountSection: View {
    @StateObject private var account = AccountSync.shared
    @State private var confirmDelete = false

    var body: some View {
        Section {
            if account.isSignedIn {
                LabeledContent("Signed in as") {
                    Label(account.email ?? "Account", systemImage: "person.crop.circle.fill.badge.checkmark").foregroundStyle(.green)
                }
                Toggle("Save changes to my account automatically", isOn: $account.autoSync).toggleStyle(.switch).requires(.sync)
                LabeledContent("Saved in account") {
                    Text(account.cloudCopy.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "Not yet").foregroundStyle(.secondary)
                }
                HStack {
                    Button("Save now") { Task { await account.upload() } }
                    Button("Restore from account…") { Task { await account.restoreFromAccount() } }
                    Spacer()
                    Button("Sign out") { account.signOut() }
                }
                Button("Delete my saved setup…", role: .destructive) { confirmDelete = true }
                    .confirmationDialog("Delete the setup saved in your account?", isPresented: $confirmDelete) {
                        Button("Delete", role: .destructive) { Task { await account.deleteCloudData() } }
                    } message: { Text("Settings on this Mac stay as they are.") }
            } else {
                SignInButtons()
            }
            if let m = account.message { Text(m).font(.callout).foregroundStyle(.secondary) }
        } header: {
            Text("Notch apple account")
        } footer: {
            Text("Sign in on any Mac to get your notch set up the way you like it, with Pro unlocked. Your setup is stored in your account (Google Firebase) and only you can read it. Your access code is kept as a secure fingerprint, never the code itself; AI keys and your Messenger identity are never uploaded.")
        }
    }


}

/// Continue with Google / Apple, styled like the providers' own buttons.
struct SignInButtons: View {
    @ObservedObject private var account = AccountSync.shared

    var body: some View {
        VStack(spacing: 8) {
            Button { account.signInWithGoogle() } label: {
                HStack(spacing: 8) {
                    Text("G").font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(LinearGradient(colors: [.blue, .red, .yellow, .green], startPoint: .topLeading, endPoint: .bottomTrailing))
                    Text("Continue with Google").font(.system(size: 13, weight: .semibold))
                }
                .frame(maxWidth: .infinity, minHeight: 30)
                .foregroundStyle(.black)
                .background(.white, in: RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            Button { account.signInWithApple() } label: {
                HStack(spacing: 8) {
                    Image(systemName: "apple.logo").font(.system(size: 14, weight: .semibold))
                    Text("Continue with Apple").font(.system(size: 13, weight: .semibold))
                }
                .frame(maxWidth: .infinity, minHeight: 30)
                .foregroundStyle(.white)
                .background(.black, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.white.opacity(0.25)))
            }
            .buttonStyle(.plain)
            if account.busy { ProgressView().controlSize(.small) }
        }
        .padding(.vertical, 4)
    }
}
