//
//  SettingsView.swift
//  Notch apple
//
//  The Settings window, laid out like macOS System Settings: a sidebar of
//  panes on the left and a grouped form on the right. Following the HIG:
//   • the window title names the current pane,
//   • the last-used pane is restored next time,
//   • every module has its own on/off switch that updates the notch live.
//

import SwiftUI
import ServiceManagement
import WidgetKit
import Combine
import UniformTypeIdentifiers

/// Panes in the Settings window. `selection` lets other code jump to a pane.
enum SettingsTab: String, CaseIterable, Identifiable, Hashable {
    case general, permissions, authentication, modules, windows, claude, aiHistory, messenger, clipboard, focus, audio, vpn, widget, about
    static let selection = PassthroughSubject<SettingsTab, Never>()

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: "General"
        case .permissions: "Permissions"
        case .authentication: "Authentication"
        case .modules: "Modules"
        case .windows: "Windows"
        case .claude: "AI"
        case .aiHistory: "AI History"
        case .messenger: "Messenger"
        case .clipboard: "Clipboard"
        case .focus: "Focus"
        case .audio: "Audio"
        case .vpn: "VPN"
        case .widget: "Widget"
        case .about: "About"
        }
    }

    var symbol: String {
        switch self {
        case .general: "gearshape.fill"
        case .permissions: "hand.raised.fill"
        case .authentication: "faceid"
        case .modules: "square.grid.2x2.fill"
        case .windows: "rectangle.split.2x2.fill"
        case .claude: "sparkles"
        case .aiHistory: "clock.arrow.circlepath"
        case .messenger: "bubble.left.and.bubble.right.fill"
        case .clipboard: "doc.on.clipboard.fill"
        case .focus: "timer"
        case .audio: "speaker.wave.2.fill"
        case .vpn: "lock.shield.fill"
        case .widget: "rectangle.3.group.fill"
        case .about: "info.circle.fill"
        }
    }

    /// Icon tile colour, like System Settings' sidebar.
    var tint: Color {
        switch self {
        case .general: .gray
        case .permissions: .blue
        case .authentication: .red
        case .modules: Theme.accent
        case .windows: .cyan
        case .claude: .orange
        case .aiHistory: .indigo
        case .messenger: .green
        case .clipboard: .yellow
        case .focus: .purple
        case .audio: .pink
        case .vpn: .blue
        case .widget: .teal
        case .about: .indigo
        }
    }
}

struct SettingsView: View {
    @AppStorage("settings.lastPane") private var tab: SettingsTab = .general

    var body: some View {
        NavigationSplitView {
            List(SettingsTab.allCases, selection: Binding(get: { tab }, set: { if let t = $0 { tab = t } })) { pane in
                Label {
                    Text(pane.title)
                } icon: {
                    Image(systemName: pane.symbol)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 22, height: 22)
                        .background(pane.tint.gradient, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
                .tag(pane)
            }
            .navigationSplitViewColumnWidth(190)
        } detail: {
            Group {
                switch tab {
                case .general: GeneralSettings()
                case .permissions: PermissionsView(showsWelcome: !UserDefaults.standard.bool(forKey: "onboarding.welcomeDismissed"))
                    .onDisappear { UserDefaults.standard.set(true, forKey: "onboarding.welcomeDismissed") }
                case .authentication: AuthenticationSettings()
                case .modules: ModulesSettings()
                case .windows: WindowsSettings()
                case .claude: ClaudeSettings()
                case .aiHistory: AIHistorySettings()
                case .messenger: MessengerSettings()
                case .clipboard: ClipboardSettings()
                case .focus: FocusSettings()
                case .audio: AudioSettings()
                case .vpn: VPNSettings()
                case .widget: WidgetSettings()
                case .about: AboutSettings()
                }
            }
            .navigationTitle(tab.title)
        }
        .frame(minWidth: 680, idealWidth: 860, minHeight: 440, idealHeight: 560)
        .tint(Theme.accent)
        .onReceive(SettingsTab.selection) { tab = $0 }
        .onAppear { SettingsWindowController.currentWindow?.title = tab.title }
        .onChange(of: tab) { _, new in SettingsWindowController.currentWindow?.title = new.title }
    }
}

// MARK: - General

private struct GeneralSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled

    var body: some View {
        Form {
            Section {
                Toggle("Launch at login", isOn: $launchAtLogin)
                    .onChange(of: launchAtLogin) { _, on in
                        on ? PermissionsModel.shared.enableLoginItem() : PermissionsModel.shared.disableLoginItem()
                    }
                Toggle("Show icon in menu bar", isOn: $settings.showStatusItem)
                Toggle(isOn: $settings.showChargingActivity) {
                    Text("Show battery beside the notch when charging")
                    Text("Briefly shows the battery level when you plug in or unplug the charger.")
                }
            }
            Section {
                Toggle(isOn: $settings.globalHotkeyEnabled) {
                    Text("Open and close with ⌘E")
                    Text("Works in any app. While on, other apps don't receive ⌘E.")
                }
                Toggle(isOn: $settings.hoverToOpen) {
                    Text("Open on hover")
                    Text("Opens when the pointer rests on the notch and closes when it moves away. Click inside to keep it open.")
                }
                Toggle(isOn: $settings.stickyNotch) {
                    Text("Keep open when clicking elsewhere")
                    Text("Otherwise the notch closes when you click outside it or press Esc.")
                }
            } header: {
                Text("Notch")
            } footer: {
                Text("The notch opens when you click it, press ⌘E, or drag a file onto it. With Open on hover off, hovering only highlights it.")
            }
        }
        .formStyle(.grouped)
    }
}

// MARK: - Authentication

private struct AuthenticationSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @StateObject private var engine = FaceUnlockEngine()
    @State private var enrolled = FaceTemplateStore.isEnrolled
    @State private var sheet: Sheet?
    @State private var result: String?

    enum Sheet: Identifiable { case enrol, test; var id: Self { self } }

    var body: some View {
        Form {
            Section {
                Toggle(isOn: $settings.securityEnabled) {
                    Text("Lock Notch apple")
                    Text("Ask to unlock every time the notch opens.")
                }
            }
            Section {
                LabeledContent("Face") {
                    if enrolled {
                        Label("Saved in Keychain", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                    } else {
                        Text("Not set up").foregroundStyle(.secondary)
                    }
                }
                Toggle("Unlock Notch apple with my face", isOn: $settings.faceUnlockEnabled)
                    .disabled(!enrolled)
                HStack {
                    Button(enrolled ? "Set up again…" : "Set up face unlock…") { sheet = .enrol }
                    if enrolled {
                        Button("Test…") { sheet = .test }
                        Spacer()
                        Button("Delete face data…", role: .destructive) { deleteFace() }
                    }
                }
                if let result { Text(result).font(.callout).foregroundStyle(.secondary) }
            } header: {
                Text("Face unlock")
            } footer: {
                Text("The camera takes a few photos of you and Apple's Vision framework turns them into a face template, saved in your Keychain on this Mac only. Photos are never stored or sent anywhere. To unlock, look at the camera and blink. This uses a regular 2D camera, not Apple's 3D Face ID, so treat it as a convenience. Touch ID and your password always work too, and macOS itself can't be unlocked by third-party apps.")
            }
        }
        .formStyle(.grouped)
        .sheet(item: $sheet) { which in
            VStack(spacing: 16) {
                Text(which == .enrol ? "Set up face unlock" : "Test face unlock").font(.title3.bold())
                FaceScanView(engine: engine, size: 200, showsCamera: which == .enrol)
                Button("Cancel") { engine.stop(); sheet = nil }
            }
            .padding(24)
            .frame(width: 340)
            .onAppear {
                if which == .enrol {
                    engine.enrol { ok in
                        enrolled = FaceTemplateStore.isEnrolled
                        if ok { settings.faceUnlockEnabled = true }
                        result = ok ? "Face saved. Try Test to check it recognises you." : "Setup didn't finish. Try again in good light."
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { sheet = nil }
                    }
                } else {
                    engine.verify { ok in
                        result = ok ? "Recognised you ✓" : "Didn't recognise you. Try better light, or set up again."
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { sheet = nil }
                    }
                }
            }
            .onDisappear { engine.stop() }
        }
    }

    /// Deleting biometric data needs Touch ID / password first.
    private func deleteFace() {
        Task {
            guard await BiometricAuth.authenticate(reason: "delete your saved face data") else { return }
            FaceTemplateStore.delete()
            settings.faceUnlockEnabled = false
            enrolled = false
            result = "Face data deleted from the Keychain."
        }
    }
}

// MARK: - Modules

private struct ModulesSettings: View {
    @EnvironmentObject private var settings: SettingsManager

    var body: some View {
        Form {
            Section {
                ForEach(Module.allCases) { module in
                    Toggle(isOn: settings.binding(for: module)) {
                        HStack(spacing: 12) {
                            Image(systemName: module.symbol)
                                .font(.system(size: 13, weight: .semibold))
                                .frame(width: 28, height: 28)
                                .foregroundStyle(.white)
                                .background(Theme.accentGradient, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(module.title)
                                Text(module.blurb).font(.callout).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .toggleStyle(.switch)
                }
            } footer: {
                Text("Every module is optional. Turned-off modules disappear from the notch straight away.")
            }
        }
        .formStyle(.grouped)
    }
}

// MARK: - AI

private struct ClaudeSettings: View {
    @StateObject private var config = AIConfig.shared
    @State private var drafts: [AIProvider: String] = [:]
    @State private var customModel = ""
    @State private var refresh = 0     // bump to re-read Keychain state

    var body: some View {
        Form {
            Section {
                Picker("Provider", selection: Binding(get: { config.provider }, set: { config.provider = $0 })) {
                    Section("Free") { ForEach(AIProvider.allCases.filter(\.isFree)) { Text($0.title).tag($0) } }
                    Section("Paid") { ForEach(AIProvider.allCases.filter { !$0.isFree }) { Text($0.title).tag($0) } }
                }
                LabeledContent("Cost", value: config.provider.costNote)
                if config.provider.isConfigured {
                    Picker("Model", selection: Binding(get: { config.model }, set: { config.setModel($0, for: config.provider) })) {
                        let models = config.availableModels[config.provider] ?? []
                        ForEach(models.contains(config.model) ? models : [config.model] + models, id: \.self) { Text($0).tag($0) }
                    }
                    HStack {
                        TextField("Or type a model ID", text: $customModel)
                        Button("Use") { config.setModel(customModel, for: config.provider); customModel = "" }
                            .disabled(customModel.isEmpty)
                        Button("Refresh list") { config.refreshModels() }
                        if config.loadingModels { ProgressView().controlSize(.small) }
                    }
                    if let e = config.modelError { Text(e).font(.callout).foregroundStyle(.red) }
                }
                Toggle(isOn: Binding(get: { ClaudeChatModel.shared.autoScreen }, set: { ClaudeChatModel.shared.autoScreen = $0 })) {
                    Text("Share my screen when I ask about it")
                    Text("Questions like \"what's on my screen?\" or \"explain this error\" automatically include a screenshot.")
                }
            } header: {
                Text("Provider")
            } footer: {
                Text("Free options need no credit card. OpenRouter's free list changes over time (Qwen, Llama, and DeepSeek when available). The official DeepSeek and ChatGPT APIs require billing.")
            }

            Section {
                ForEach(AIProvider.allCases.filter(\.needsKey)) { p in
                    keyRow(p)
                }
                LabeledContent("Ollama") {
                    Link("Download Ollama (free, runs locally) →", destination: AIProvider.ollama.keyURL)
                }
            } header: {
                Text("API keys")
            } footer: {
                Text("Keys are stored in your Keychain on this Mac and sent only to that provider.")
            }
        }
        .formStyle(.grouped)
        .id(refresh)
        .onAppear { if config.availableModels[config.provider] == nil { config.refreshModels() } }
    }

    @ViewBuilder
    private func keyRow(_ p: AIProvider) -> some View {
        if p.apiKey != nil {
            LabeledContent(p.title) {
                HStack {
                    Label("Saved", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                    Button("Remove", role: .destructive) {
                        KeychainHelper.delete(p.keychainKey); refresh += 1; config.objectWillChange.send()
                    }
                }
            }
        } else {
            LabeledContent(p.title) {
                HStack {
                    SecureField(p.keyPlaceholder, text: Binding(get: { drafts[p] ?? "" }, set: { drafts[p] = $0 }))
                        .frame(width: 200)
                    Button("Save") {
                        let key = (drafts[p] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !key.isEmpty else { return }
                        KeychainHelper.set(key, for: p.keychainKey)
                        drafts[p] = nil; refresh += 1
                        config.objectWillChange.send()
                        if p == config.provider { config.refreshModels() }
                    }
                    .disabled((drafts[p] ?? "").isEmpty)
                    Link(p.isFree ? "Free key" : "Get key", destination: p.keyURL)
                }
            }
        }
    }
}

// MARK: - AI History

private struct AIHistorySettings: View {
    @StateObject private var store = ChatHistoryStore.shared
    @State private var selectedID: UUID?
    @State private var search = ""
    @State private var confirmClear = false

    private var filtered: [ChatSession] {
        search.isEmpty ? store.sessions : store.sessions.filter { s in
            s.messages.contains { $0.text.localizedCaseInsensitiveContains(search) }
                || s.modelsUsed.contains { $0.localizedCaseInsensitiveContains(search) }
                || s.providerTitle.localizedCaseInsensitiveContains(search)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Toggle("Save AI chats", isOn: $store.isEnabled).toggleStyle(.switch).controlSize(.small)
                Spacer()
                Text("\(store.sessions.count) chat\(store.sessions.count == 1 ? "" : "s")").foregroundStyle(.secondary)
                Button("Delete all…", role: .destructive) { confirmClear = true }.disabled(store.sessions.isEmpty)
            }
            .padding(12)
            Divider()
            if store.sessions.isEmpty {
                ContentUnavailableView("No AI chats yet", systemImage: "clock.arrow.circlepath",
                                       description: Text("Conversations from the notch's AI tab appear here, with the model that answered."))
            } else {
                HStack(spacing: 0) {
                    List(filtered, selection: $selectedID) { s in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(s.firstQuestion).lineLimit(2).font(.body.weight(.medium))
                            Text("\(s.providerTitle) · \(s.modelsUsed.joined(separator: ", "))")
                                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            Text("\(s.updated.formatted(date: .abbreviated, time: .shortened)) · \(s.messages.count) messages")
                                .font(.caption2).foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 3)
                        .tag(s.id)
                        .contextMenu { Button("Delete", role: .destructive) { store.delete(s.id) } }
                    }
                    .safeAreaInset(edge: .top) {
                        TextField("Search chats", text: $search)
                            .textFieldStyle(.roundedBorder).padding(.horizontal, 10).padding(.top, 8)
                    }
                    .frame(width: 220)
                    Divider()

                    Group {
                        if let s = store.sessions.first(where: { $0.id == selectedID }) {
                            ChatTranscriptView(session: s)
                        } else {
                            ContentUnavailableView("Select a chat", systemImage: "text.bubble")
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .onAppear { if selectedID == nil { selectedID = store.sessions.first?.id } }
        .confirmationDialog("Delete all AI chat history?", isPresented: $confirmClear) {
            Button("Delete all", role: .destructive) { store.deleteAll(); selectedID = nil }
        } message: { Text("This can't be undone.") }
    }
}

/// Full conversation: your questions, the AI's answers, and which model wrote each one.
private struct ChatTranscriptView: View {
    let session: ChatSession
    @ObservedObject private var store = ChatHistoryStore.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text(session.firstQuestion).font(.headline).lineLimit(2)
                Label("\(session.providerTitle) · \(session.modelsUsed.joined(separator: ", "))", systemImage: "sparkles")
                    .font(.caption).foregroundStyle(.secondary)
                Text("Started \(session.started.formatted(date: .complete, time: .shortened))")
                    .font(.caption).foregroundStyle(.secondary)
                HStack {
                    Button {
                        ClaudeChatModel.shared.resume(session)
                        AppDelegate.showNotch(tab: .claude)
                    } label: { Label("Continue", systemImage: "arrow.up.forward.app") }
                    .help("Reopen this chat in the notch and keep going")
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(store.transcript(session), forType: .string)
                    } label: { Label("Copy", systemImage: "doc.on.doc") }
                    .help("Copy the whole conversation as text")
                    Spacer()
                    Button(role: .destructive) { store.delete(session.id) } label: { Label("Delete", systemImage: "trash") }
                }
                .padding(.top, 4)
            }
            .padding(12)
            Divider()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(session.messages.enumerated()), id: \.offset) { _, m in
                        VStack(alignment: m.role == "user" ? .trailing : .leading, spacing: 3) {
                            HStack(spacing: 4) {
                                Text(m.role == "user" ? "You" : (m.model ?? "AI")).font(.caption.weight(.semibold))
                                if m.hadScreenshot { Label("screenshot", systemImage: "camera.viewfinder").font(.caption2) }
                                Text(m.date.formatted(date: .omitted, time: .shortened)).font(.caption2)
                            }
                            .foregroundStyle(.secondary)
                            Text(LocalizedStringKey(m.text))
                                .textSelection(.enabled)
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .background(m.role == "user" ? AnyShapeStyle(Theme.accent.opacity(0.25)) : AnyShapeStyle(.quaternary),
                                            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .frame(maxWidth: .infinity, alignment: m.role == "user" ? .trailing : .leading)
                    }
                }
                .padding(12)
            }
        }
    }
}

// MARK: - Messenger

private struct MessengerSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @StateObject private var identity = MessengerIdentity.shared
    @StateObject private var notifier = MessengerNotifier.shared
    @State private var handleDraft = MessengerIdentity.shared.handle
    @State private var cleared = false

    var body: some View {
        Form {
            Section {
                Toggle("Enable Notch Messenger", isOn: $settings.messengerEnabled)
            }
            Section {
                HStack {
                    TextField("Display handle", text: $handleDraft)
                        .onSubmit(saveHandle)
                    Button("Save", action: saveHandle)
                        .disabled(MessengerIdentity.sanitize(handleDraft) == identity.handle)
                    Button("Randomize") {
                        identity.regenerate(); handleDraft = identity.handle
                        LocalP2PManager.shared.restart()
                    }
                }
            } header: {
                Text("Identity")
            } footer: {
                Text("No accounts, emails or phone numbers. Other people only see this handle.")
            }
            Section {
                Toggle("Notify me about new messages", isOn: $notifier.notificationsEnabled)
                    .onChange(of: notifier.notificationsEnabled) { _, on in if on { notifier.requestAuthorizationIfNeeded() } }
                Toggle("Show message text in notifications", isOn: $notifier.showPreview)
                    .disabled(!notifier.notificationsEnabled)
            } header: {
                Text("Notifications")
            } footer: {
                Text("A purple dot on the notch also shows when you have unread messages.")
            }
            Section {
                Toggle(isOn: $settings.messengerLocalDiscovery) {
                    Text("Allow local network discovery")
                    Text("Lets people on the same Wi-Fi find you in Nearby mode. Traffic is encrypted between Macs.")
                }
                .onChange(of: settings.messengerLocalDiscovery) { _, on in
                    on ? LocalP2PManager.shared.start() : LocalP2PManager.shared.stop()
                }
            } header: {
                Text("Nearby Wi-Fi")
            }
            Section {
                Button(cleared ? "Cleared" : "Clear chat history and disconnect", role: .destructive) {
                    LocalP2PManager.shared.stop(); LocalP2PManager.shared.clear()
                    WebP2PManager.shared.leave(); WebP2PManager.shared.clear()
                    cleared = true
                }
            } header: {
                Text("Anonymous rooms")
            } footer: {
                Text("Room messages are end-to-end encrypted with a key made from the room code and relayed live through a free public server that can't read them. Nothing is stored, and chat history only lives in memory until you quit. Short codes like 8821 are easy to guess, so use a longer room name for private chats.")
            }
        }
        .formStyle(.grouped)
    }

    private func saveHandle() {
        identity.handle = MessengerIdentity.sanitize(handleDraft)
        handleDraft = identity.handle
        LocalP2PManager.shared.restart()
    }
}

// MARK: - Focus

private struct FocusSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @StateObject private var timer = FocusTimer.shared

    var body: some View {
        Form {
            Section {
                Toggle("Show Focus in the notch", isOn: $settings.focusEnabled)
            }
            Section {
                Stepper("Focus: \(timer.workMinutes) min", value: $timer.workMinutes, in: 5...90, step: 5)
                Stepper("Break: \(timer.breakMinutes) min", value: $timer.breakMinutes, in: 1...30)
                Stepper("Long break: \(timer.longBreakMinutes) min", value: $timer.longBreakMinutes, in: 5...60, step: 5)
                Toggle("Start the next session automatically", isOn: $timer.autoStartNext)
            } header: {
                Text("Session lengths")
            } footer: {
                Text("Every 4th focus session is followed by a long break. You'll get a notification and a sound when a session ends.")
            }
        }
        .formStyle(.grouped)
    }
}

// MARK: - Clipboard

private struct ClipboardSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @StateObject private var history = ClipboardHistory.shared
    @State private var cleared = false

    var body: some View {
        Form {
            Section {
                Toggle("Save everything I copy", isOn: $settings.clipboardEnabled)
            }
            Section {
                Picker("Keep the last", selection: $history.limit) {
                    ForEach([50, 100, 200, 500, 1000], id: \.self) { Text("\($0) items").tag($0) }
                }
                Toggle(isOn: $history.persist) {
                    Text("Keep history after restart")
                    Text("Saved in Application Support on this Mac. Turn off to keep history in memory only.")
                }
                .onChange(of: history.persist) { _, on in if !on { history.forgetSavedHistory() } }
                LabeledContent("Saved items", value: "\(history.items.count)")
                Button(cleared ? "Cleared" : "Clear history (keeps pinned items)", role: .destructive) {
                    history.clearUnpinned(); cleared = true
                }
            } header: {
                Text("History")
            } footer: {
                Text("Pinned items are never removed automatically. Anything a password manager marks as secret is never saved, and nothing leaves your Mac.")
            }
        }
        .formStyle(.grouped)
    }
}

// MARK: - Audio

private struct AudioSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @StateObject private var audio = AudioDeviceController.shared

    var body: some View {
        Form {
            Section {
                Toggle("Show Audio in the notch", isOn: $settings.audioEnabled)
            }
            Section {
                LabeledContent("Engine") {
                    switch audio.backend {
                    case .native: Label("Built in (macOS process taps)", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    case .backgroundMusic: Label("BackgroundMusic driver", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    case .unavailable: Label("Not available", systemImage: "xmark.circle.fill").foregroundStyle(.orange)
                    }
                }
                if audio.backend == .native {
                    Text("Per-app volume and EQ work without installing anything. The first time you change an app, macOS asks to allow audio recording. Notch apple only processes the sound; it never records or sends it anywhere.")
                        .font(.callout).foregroundStyle(.secondary)
                }
            } header: {
                Text("Per-app volume and EQ")
            }
            Section {
                Button("Install BackgroundMusic driver…") { openBundledDriver() }
                Link("BackgroundMusic on GitHub (GPL-2.0)", destination: URL(string: "https://github.com/kyleneideck/BackgroundMusic")!)
            } header: {
                Text("Optional driver")
            } footer: {
                Text("Only needed on macOS 14.0–14.1, where the built-in engine isn't available. The installer is included with Notch apple.")
            }
        }
        .formStyle(.grouped)
    }

    private func openBundledDriver() {
        if let pkg = Bundle.main.url(forResource: "BackgroundMusic", withExtension: "pkg") {
            NSWorkspace.shared.open(pkg)
        } else {
            NSWorkspace.shared.open(URL(string: "https://github.com/kyleneideck/BackgroundMusic/releases/latest")!)
        }
    }
}

// MARK: - VPN

private struct VPNSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @StateObject private var vpn = VPNManager.shared
    @State private var importing = false
    @State private var search = ""

    private var library: [VPNProfile] {
        search.isEmpty ? vpn.library : vpn.library.filter { $0.name.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        Form {
            Section {
                Toggle("Show VPN in the notch", isOn: $settings.vpnEnabled)
                LabeledContent("Status", value: vpn.status == .invalid ? "Not connected" : vpn.status.label)
                if let msg = vpn.message { Text(msg).font(.callout).foregroundStyle(.secondary) }
            }
            Section {
                if vpn.profiles.isEmpty {
                    Text("No saved profiles yet.").foregroundStyle(.secondary)
                }
                ForEach(vpn.profiles) { p in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(p.name)
                            Text("\(p.kind.rawValue) · \(p.server)").font(.callout).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Connect") { Task { await vpn.connect(p) } }
                        Button(role: .destructive) { vpn.remove(p) } label: { Image(systemName: "trash") }
                            .buttonStyle(.borderless).help("Delete profile")
                    }
                }
                Button("Import .ovpn or .conf file…") { importing = true }
            } header: { Text("My profiles") }
            Section {
                HStack {
                    TextField("Search country", text: $search)
                    if vpn.loadingLibrary { ProgressView().controlSize(.small) }
                    Button(vpn.library.isEmpty ? "Load servers" : "Refresh") { Task { await vpn.loadLibrary() } }
                }
                ForEach(library.prefix(60)) { p in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(p.name)
                            Text(p.credentialsHint ?? "Login shown on the provider's page").font(.callout).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Save") { vpn.add(p) }
                        Button("Connect") { Task { await vpn.connect(p) } }
                    }
                }
            } header: {
                Text("Free servers")
            } footer: {
                Text("From the free, community-maintained github.com/Zoult/.ovpn library. Servers come and go; if one fails, try another. Connecting opens the profile in the free Tunnelblick or OpenVPN Connect app.")
            }
        }
        .formStyle(.grouped)
        .task { if vpn.library.isEmpty { await vpn.loadLibrary() } }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data, .plainText], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { urls.forEach(vpn.importProfile) }
        }
    }
}

// MARK: - Widget

private struct WidgetSettings: View {
    @State private var city = SharedStore.weatherLocation.name
    @State private var status: String?
    @StateObject private var location = LocationProvider.shared

    var body: some View {
        Form {
            Section {
                Toggle("Use my current location", isOn: $location.useCurrentLocation)
                    .onChange(of: location.useCurrentLocation) { _, on in if on { location.requestLocation() } }
                if location.useCurrentLocation {
                    LabeledContent("Location", value: location.isAuthorized ? location.cityName : "Permission needed")
                    if !location.isAuthorized {
                        Button(location.status == .notDetermined ? "Allow location…" : "Open Location Services settings…") {
                            location.status == .notDetermined ? location.requestLocation() : location.openSystemSettings()
                        }
                    }
                }
            } footer: {
                Text("Only your approximate location is used, and only to fetch the weather.")
            }
            Section {
                HStack {
                    TextField("City", text: $city)
                    Button("Set") {
                        Task {
                            if let loc = try? await WeatherService.geocode(city) {
                                SharedStore.weatherLocation = loc
                                WidgetCenter.shared.reloadAllTimelines()
                                status = "Using \(loc.name)"
                            } else { status = "City not found" }
                        }
                    }
                }
                if let status { Text(status).font(.callout).foregroundStyle(.secondary) }
            } header: {
                Text("Or choose a city")
            } footer: {
                Text("Weather comes from free Open-Meteo data.")
            }
            .disabled(location.useCurrentLocation)
            Section("Add the widget") {
                Text("Right-click the desktop, choose Edit Widgets…, and search for “Notch apple”.")
            }
        }
        .formStyle(.grouped)
    }
}

// MARK: - About

private struct AboutSettings: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 96, height: 96)
            Text("Notch apple").font(.title.bold())
            Text("Version \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")")
                .foregroundStyle(.secondary)
            Text("Free, open source, and fully local.").foregroundStyle(.secondary)
            HStack {
                Link("GitHub", destination: URL(string: "https://github.com/AdityaJainDXB/NotchApples")!)
                Text("·").foregroundStyle(.secondary)
                Link("Report an issue", destination: URL(string: "https://github.com/AdityaJainDXB/NotchApples/issues")!)
            }
            Button("Quit Notch apple") { NSApp.terminate(nil) }.padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
