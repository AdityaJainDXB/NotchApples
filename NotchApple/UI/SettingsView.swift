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
import Carbon.HIToolbox
import UniformTypeIdentifiers

/// Panes in the Settings window. `selection` lets other code jump to a pane.
enum SettingsTab: String, CaseIterable, Identifiable, Hashable {
    case general, notch, appearance, profiles, extras, backup, browser, license, shortcuts, permissions, authentication, modules, lidFold, windows, claude, aiHistory, messenger, clipboard, fileSearch, focus, audio, vpn, widget, iphone, updates, privacy, help, about
    static let selection = PassthroughSubject<SettingsTab, Never>()

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: "General"
        case .notch: "Notch"
        case .profiles: "Profiles & Rules"
        case .browser: "Browser"
        case .appearance: "Appearance"
        case .extras: "Notch Extras"
        case .backup: "Backup & Sync"
        case .license: "License & Activation"
        case .shortcuts: "Shortcuts & Hotkeys"
        case .permissions: "Permissions"
        case .authentication: "Authentication"
        case .modules: "Modules"
        case .lidFold: "Lid Fold"
        case .windows: "Windows"
        case .claude: "AI"
        case .aiHistory: "AI History"
        case .messenger: "Messenger"
        case .clipboard: "Clipboard"
        case .fileSearch: "File Search"
        case .focus: "Focus"
        case .audio: "Audio"
        case .vpn: "VPN"
        case .widget: "Widget"
        case .updates: "Updates"
        case .privacy: "Privacy"
        case .iphone: "iPhone"
        case .help: "Help & Feedback"
        case .about: "About"
        }
    }

    var symbol: String {
        switch self {
        case .general: "gearshape.fill"
        case .notch: "capsule.tophalf.filled"
        case .profiles: "person.2.crop.square.stack.fill"
        case .browser: "globe"
        case .appearance: "paintpalette.fill"
        case .extras: "sparkles.rectangle.stack.fill"
        case .backup: "icloud.fill"
        case .license: "key.fill"
        case .shortcuts: "command"
        case .permissions: "hand.raised.fill"
        case .authentication: "faceid"
        case .modules: "square.grid.2x2.fill"
        case .lidFold: "laptopcomputer"
        case .windows: "rectangle.split.2x2.fill"
        case .claude: "sparkles"
        case .aiHistory: "clock.arrow.circlepath"
        case .messenger: "bubble.left.and.bubble.right.fill"
        case .clipboard: "doc.on.clipboard.fill"
        case .fileSearch: "magnifyingglass"
        case .focus: "timer"
        case .audio: "speaker.wave.2.fill"
        case .vpn: "lock.shield.fill"
        case .widget: "rectangle.3.group.fill"
        case .updates: "arrow.down.circle.fill"
        case .privacy: "hand.raised.square.fill"
        case .iphone: "iphone"
        case .help: "questionmark.bubble.fill"
        case .about: "info.circle.fill"
        }
    }

    /// Icon tile colour, like System Settings' sidebar.
    var tint: Color {
        switch self {
        case .general: .gray
        case .notch: .purple
        case .profiles: .teal
        case .browser: .blue
        case .appearance: .pink
        case .extras: .orange
        case .backup: .blue
        case .license: .green
        case .shortcuts: .mint
        case .permissions: .blue
        case .authentication: .red
        case .modules: Theme.accent
        case .windows: .cyan
        case .claude: .orange
        case .aiHistory: .indigo
        case .messenger: .green
        case .clipboard: .yellow
        case .fileSearch: .purple
        case .focus: .purple
        case .audio: .pink
        case .vpn: .blue
        case .widget: .teal
        case .updates: .green
        case .privacy: .blue
        case .iphone: .gray
        case .help: .orange
        case .about: .indigo
        case .lidFold: .cyan
        }
    }
}

extension SettingsTab {
    /// Extra words Settings search matches, besides the title.
    var keywords: String {
        switch self {
        case .general: "login menu bar volume brightness hud recording dot charging"
        case .notch: "hover delay open click fullscreen hide size width height resize edge trigger zone display monitor gestures swipe pinch long press sound haptics keyboard focus pomodoro timer hot corners"
        case .appearance: "theme colour color dark light accent glow tab order editor import export animation speed sound haptic font menu bar icon style"
        case .profiles: "profile work study gaming automatic app rules hide per-app time"
        case .extras: "battery music lyrics rain meeting download keep awake album"
        case .backup: "icloud sync google account restore export import file"
        case .license: "pro ultimate key activate upgrade buy price restore lost deactivate terms refund"
        case .shortcuts: "hotkey keyboard shortcut capture"
        case .permissions: "accessibility screen recording camera microphone calendar"
        case .authentication: "face unlock lock password"
        case .modules: "tabs add-ons widgets enable"
        case .lidFold: "fold frost tilt lid close laptop screen recording desktop preview demo sensor angle blur"
        case .claude: "ai gemini ollama openai provider model key temperature capture"
        case .aiHistory: "conversations search export"
        case .updates: "version homebrew beta"
        case .privacy: "privacy data network permissions delete tracking analytics"
        case .iphone: "iphone companion phone pair send link sideload"
        case .help: "feedback bug report crash support beta translate donate icloud notes sync"
        default: ""
        }
    }

    func matches(_ query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty || title.lowercased().contains(q) || keywords.contains(q)
    }

    // MARK: Grouped sidebar
    //
    // Related panes share one sidebar entry, so the list stays short:
    //  • Permissions and Privacy → "Privacy & Permissions" (a chooser asks which one to open).
    //  • Focus is no longer its own entry: its settings are in Notch → Focus.
    // All the cases still exist, so anything that opens a pane by name (a link, a shortcut) keeps working.

    /// The panes that get a sidebar row.
    static var sidebar: [SettingsTab] { allCases.filter { $0 != .privacy && $0 != .focus } }

    /// The sidebar row this pane belongs to.
    var sidebarRow: SettingsTab { self == .privacy ? .permissions : self }

    var sidebarTitle: String { self == .permissions ? "Privacy & Permissions" : title }

    /// The two panes behind "Privacy & Permissions".
    static let privacyGroup: [SettingsTab] = [.permissions, .privacy]
    var inPrivacyGroup: Bool { Self.privacyGroup.contains(self) }

    func sidebarMatches(_ query: String) -> Bool {
        self == .permissions ? (matches(query) || SettingsTab.privacy.matches(query) || "privacy & permissions".contains(query.lowercased())) : matches(query)
    }
}

/// Lets other screens ask Settings to open the Focus timer sheet.
@MainActor
final class SettingsRouter: ObservableObject {
    static let shared = SettingsRouter()
    @Published var showFocus = false
}

struct SettingsView: View {
    @ObservedObject private var updater = UpdateChecker.shared
    @AppStorage("settings.lastPane") private var tab: SettingsTab = .general
    @State private var query = ""
    @State private var chooseGroup = false
    @ObservedObject private var router = SettingsRouter.shared

    var body: some View {
        NavigationSplitView {
            List(SettingsTab.sidebar.filter { $0.sidebarMatches(query) }, selection: Binding(get: { tab.sidebarRow }, set: { picked in
                guard let t = picked else { return }
                // "Privacy & Permissions" asks which of its two panes to open (unless you're already in one).
                if t == .permissions && !tab.inPrivacyGroup { chooseGroup = true } else if t != .permissions { tab = t }
            })) { pane in
                Label {
                    HStack {
                        Text(pane.sidebarTitle)
                        if pane == .updates, updater.pendingUpdate != nil {
                            Spacer()
                            Text("1").font(.caption2.bold()).foregroundStyle(.white)
                                .padding(.horizontal, 6).padding(.vertical, 1)
                                .background(Capsule().fill(.red))
                                .accessibilityLabel("Update available")
                        }
                    }
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
            .searchable(text: $query, placement: .sidebar, prompt: "Search settings")
            .onSubmit(of: .search) {
                if let first = SettingsTab.sidebar.first(where: { $0.sidebarMatches(query) }) {
                    if first == .permissions { chooseGroup = true } else { tab = first }
                }
            }
        } detail: {
            Group {
                switch tab {
                case .general: GeneralSettings()
                case .notch: NotchSettings()
                case .profiles: ProfilesSettings()
                case .browser: BrowserSettings()
                case .appearance: AppearanceSettings()
                case .extras: ExtrasSettings()
                case .backup: BackupSettings()
                case .license: LicenseSettings()
                case .shortcuts: ShortcutsSettings()
                case .permissions:
                    PrivacyPermissionsPane(tab: $tab) {
                        PermissionsView(showsWelcome: !UserDefaults.standard.bool(forKey: "onboarding.welcomeDismissed"))
                            .onDisappear { UserDefaults.standard.set(true, forKey: "onboarding.welcomeDismissed") }
                    }
                case .authentication: AuthenticationSettings()
                case .modules: ModulesSettings()
                case .lidFold: LidFoldSettings()
                case .windows: WindowsSettings()
                case .claude: ClaudeSettings()
                case .aiHistory: Entitlements.shared.canUse(.aiHistory) ? AnyView(AIHistorySettings()) : AnyView(ActivationModalView(feature: .aiHistory).padding())
                case .messenger: MessengerSettings()
                case .clipboard: ClipboardSettings()
                case .fileSearch: FileSearchSettings()
                case .focus: NotchSettings()   // Focus lives in Notch → Focus now; this only keeps old links working
                case .audio: AudioSettings()
                case .vpn: VPNSettings()
                case .widget: WidgetSettings()
                case .updates: UpdatesSettings()
                case .privacy: PrivacyPermissionsPane(tab: $tab) { PrivacyDashboard() }
                case .iphone: CompanionSettings()
                case .help: HelpSettings()
                case .about: AboutSettings()
                }
            }
            .navigationTitle(tab.inPrivacyGroup ? "Privacy & Permissions" : tab.title)
            // The pages follow the colour theme chosen in Settings → Appearance.
            .scrollContentBackground(.hidden)
            .background(Theme.backdrop.ignoresSafeArea())
        }
        .preferredColorScheme(.dark)
        .frame(minWidth: 680, idealWidth: 860, minHeight: 440, idealHeight: 560)
        .tint(Theme.accent)
        .id(ThemeManager.shared.currentThemeID)
        .onReceive(SettingsTab.selection) { picked in
            // Old links to the Focus pane open it as a sheet over Notch settings.
            if picked == .focus { tab = .notch; router.showFocus = true } else { tab = picked }
        }
        .onAppear {
            if tab == .focus { tab = .notch }
            SettingsWindowController.currentWindow?.title = tab.inPrivacyGroup ? "Privacy & Permissions" : tab.title
        }
        .onChange(of: tab) { _, new in SettingsWindowController.currentWindow?.title = new.inPrivacyGroup ? "Privacy & Permissions" : new.title }
        .sheet(isPresented: $chooseGroup) {
            PrivacyChooser { picked in
                chooseGroup = false
                if let picked { tab = picked }
            }
        }
        .sheet(isPresented: $router.showFocus) {
            VStack(spacing: 0) {
                HStack {
                    Text("Focus timer").font(.headline)
                    Spacer()
                    Button("Done") { router.showFocus = false }.keyboardShortcut(.defaultAction)
                }
                .padding([.horizontal, .top], 16)
                FocusSettings()
            }
            .frame(width: 560, height: 520)
            .environmentObject(SettingsManager.shared)
            .preferredColorScheme(.dark)
        }
    }
}

// MARK: - Privacy & Permissions

/// "Which one?": the picker shown when you choose Privacy & Permissions in the sidebar.
private struct PrivacyChooser: View {
    let done: (SettingsTab?) -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "hand.raised.fill").font(.system(size: 30)).foregroundStyle(.blue)
            Text("Privacy & Permissions").font(.title3.bold())
            Text("Which would you like to open?").foregroundStyle(.secondary)
            HStack(spacing: 12) {
                choice("Permissions", "What macOS lets Notch apple use: accessibility, screen, camera and more.", "checkmark.shield.fill", .permissions)
                choice("Privacy", "What stays on your Mac, what goes online, and how to delete your data.", "eye.slash.fill", .privacy)
            }
            Button("Cancel") { done(nil) }.keyboardShortcut(.cancelAction).buttonStyle(.plain).foregroundStyle(.secondary)
        }
        .padding(24)
        .frame(width: 480)
        .preferredColorScheme(.dark)
    }

    private func choice(_ title: String, _ detail: String, _ symbol: String, _ tab: SettingsTab) -> some View {
        Button { done(tab) } label: {
            VStack(spacing: 8) {
                Image(systemName: symbol).font(.system(size: 22)).foregroundStyle(Theme.accent)
                Text("[ \(title) ]").font(.headline)
                Text(detail).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, minHeight: 130)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.06)))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.accent.opacity(0.25)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Permissions and Privacy share one sidebar row; this switch at the top moves between them.
private struct PrivacyPermissionsPane<Content: View>: View {
    @Binding var tab: SettingsTab
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $tab) {
                Text("Permissions").tag(SettingsTab.permissions)
                Text("Privacy").tag(SettingsTab.privacy)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(maxWidth: 320)
            .padding(.vertical, 10)
            content
        }
    }
}

// MARK: - License & Activation

private struct LicenseSettings: View {
    @StateObject private var license = LicenseState.shared
    @StateObject private var entitlements = Entitlements.shared
    @State private var confirmDeactivate = false

    var body: some View {
        Form {
            Section {
                LabeledContent("This Mac") {
                    HStack(spacing: 6) {
                        if entitlements.tier == .free { Text("Free").foregroundStyle(.secondary) }
                        else { TierBadge(tier: entitlements.tier, locked: false) }
                    }
                }
                if let key = entitlements.key {
                    LabeledContent("Key", value: key.masked).monospaced().textSelection(.enabled)
                    LabeledContent("Bought", value: key.issued.formatted(date: .abbreviated, time: .omitted))
                } else if license.isActivated {
                    LabeledContent("Activated with", value: AccessCodeManager.maskedActiveCode).monospaced()
                }
                if let notice = entitlements.notice {
                    Label(notice, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                }
            } footer: {
                Text(entitlements.tier == .free
                     ? "Everything not marked PRO or ULTIMATE is free, for good. A key is a one-time purchase: no subscription, no account, and every future update is included."
                     : "Yours for life: no renewals, and every future update is included. The key is checked on this Mac, offline.")
            }

            if entitlements.tier < .ultimate {
                Section {
                    ActivationModalView(feature: nil, prefill: entitlements.pendingKey ?? "", compact: true)
                        .id(entitlements.pendingKey ?? "")
                } header: {
                    Text(entitlements.tier == .pro ? "Activate an Ultimate key" : "Activate or restore a purchase")
                } footer: {
                    Text("Paste the key from your email or the checkout page. Reinstalled or new Mac? Paste the same key again (up to 3 Macs).")
                }
            }

            Section {
                if entitlements.tier == .pro {
                    Link("Upgrade to Ultimate for $4 →", destination: URL(string: LicenseServer.site + "#upgrade")!)
                } else if entitlements.tier == .free {
                    Link("Get Pro ($1) or Ultimate ($5) →", destination: URL(string: LicenseServer.site)!)
                }
                Link("Lost my key?", destination: URL(string: LicenseServer.site + "#recover")!)
                Link("Terms and refunds", destination: URL(string: "https://virajsinghchadha.github.io/notchapples-site/terms.html")!)
                Button("Deactivate this Mac…", role: .destructive) { confirmDeactivate = true }
                    .disabled(entitlements.tier == .free)
            } footer: {
                Text("Deactivating frees this Mac's slot so you can use the key on another one.")
            }

            CompareTiers()
            AccountSection()
        }
        .formStyle(.grouped)
        .confirmationDialog("Deactivate this Mac?", isPresented: $confirmDeactivate) {
            Button("Deactivate", role: .destructive) { Task { await entitlements.deactivateThisMac() } }
        } message: {
            Text("Pro features lock on this Mac until you paste your key again. Your key keeps working on your other Macs.")
        }
        .onDisappear { entitlements.pendingKey = nil }
    }
}

/// Settings → License: what each tier includes. Paid features that aren't finished yet stay hidden.
private struct CompareTiers: View {
    @StateObject private var entitlements = Entitlements.shared

    var body: some View {
        Section {
            row(.free, "The whole notch: Now Playing, timers, calendar, weather, world clock, clipboard, shelf, F1, sports, games, window snapping, AI with your own free key or Ollama, and more.")
            row(.pro, Feature.allCases.filter { $0.tier == .pro && $0.isReady }.map(\.title).joined(separator: ", ") + ".")
            let ultimate = Feature.allCases.filter { $0.tier == .ultimate && $0.isReady }
            row(.ultimate, ultimate.isEmpty
                ? "Everything in Pro, plus the Live Activities API, plugin SDK, priority support and the beta channel as they arrive in later updates."
                : "Everything in Pro, plus " + ultimate.map(\.title).joined(separator: ", ") + ".")
        } header: {
            Text("Compare tiers")
        } footer: {
            Text("One-time prices. The app has no ads and no tracking in every tier.")
        }
    }

    private func row(_ tier: Tier, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(tier.name).font(.headline)
                Text(tier.price).font(.caption).foregroundStyle(.secondary)
            }
            .frame(width: 70, alignment: .leading)
            Text(text).font(.callout).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if entitlements.tier == tier { Text("You").font(.caption.weight(.semibold)).foregroundStyle(.green) }
        }
    }
}

// MARK: - Browser

private struct BrowserSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @AppStorage(SearchEngine.storageKey) private var engine = SearchEngine.duckDuckGo.rawValue
    @State private var confirmClear = false
    @State private var cleared = false

    var body: some View {
        Form {
            Section {
                Toggle("Show Browser in the notch", isOn: $settings.browserEnabled)
            }
            Section {
                Picker("Search engine", selection: $engine) {
                    ForEach(SearchEngine.allCases) { Text($0.name).tag($0.rawValue) }
                }
            } footer: {
                Text("Anything you type in the address bar that isn't a website is searched with this engine.")
            }
            Section {
                Button(cleared ? "Cleared" : "Clear browsing data…", role: .destructive) { confirmClear = true }
            } footer: {
                Text("Removes cookies, cache and site data from the notch browser, and signs you out of sites.")
            }
        }
        .formStyle(.grouped)
        .confirmationDialog("Clear browsing data?", isPresented: $confirmClear) {
            Button("Clear", role: .destructive) { Task { await BrowserModel.shared.clearBrowsingData(); cleared = true } }
        } message: { Text("This signs you out of websites you used in the notch browser.") }
    }
}

// MARK: - Shortcuts & Hotkeys

private struct ShortcutsSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @State private var binding = HotkeyBinding.invisibility
    @State private var notchBinding = HotkeyBinding.notch
    @State private var blocked = GlobalHotkeyManager.shared.isBlocked(.toggleInvisible)
    @State private var notchBlocked = GlobalHotkeyManager.shared.isBlocked(.toggleNotch)
    @State private var captureBinding = HotkeyBinding.capture
    @State private var captureBlocked = GlobalHotkeyManager.shared.isBlocked(.capture)

    var body: some View {
        Form {
            Section {
                Toggle(isOn: $settings.invisibilityHotkeyEnabled) {
                    Text("Hide the notch with \(binding.label)")
                    Text("Press \(binding.label) from anywhere on your Mac to instantly hide or reveal the notch.")
                }
                LabeledContent("Shortcut") {
                    ShortcutRecorder(slot: .invisibility, binding: $binding, reserved: [notchBinding, captureBinding]) {
                        // The app re-registers on the next preferences change; check the result shortly after.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            blocked = GlobalHotkeyManager.shared.isBlocked(.toggleInvisible)
                        }
                    }
                }
                if blocked && settings.invisibilityHotkeyEnabled {
                    Label("macOS didn't accept \(binding.label): another app may already use it. Pick a different shortcut.",
                          systemImage: "exclamationmark.triangle.fill")
                        .font(.callout).foregroundStyle(.orange)
                }
                LabeledContent("Notch") {
                    Label(settings.isNotchHidden ? "Hidden/Invisible" : "Visible",
                          systemImage: settings.isNotchHidden ? "eye.slash.fill" : "eye.fill")
                        .foregroundStyle(settings.isNotchHidden ? .orange : .green)
                }
                Button(settings.isNotchHidden ? "Show the notch now" : "Hide the notch now") {
                    AppDelegate.current?.toggleInvisible()
                }
            } header: {
                Text("Invisibility")
            } footer: {
                Text("Everything keeps running while the notch is hidden; \(notchBinding.label) also brings it back.")
            }
            Section {
                Toggle(isOn: $settings.globalHotkeyEnabled) {
                    Text("Open and close with \(notchBinding.label)")
                    Text("Works in any app. While on, other apps don't receive \(notchBinding.label).")
                }
                LabeledContent("Shortcut") {
                    ShortcutRecorder(slot: .notch, binding: $notchBinding, reserved: [binding, captureBinding]) {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            notchBlocked = GlobalHotkeyManager.shared.isBlocked(.toggleNotch)
                            binding = HotkeyBinding.invisibility
                        }
                    }
                }
                if notchBlocked && settings.globalHotkeyEnabled {
                    Label("macOS didn't accept \(notchBinding.label): another app may already use it. Pick a different shortcut.",
                          systemImage: "exclamationmark.triangle.fill")
                        .font(.callout).foregroundStyle(.orange)
                }
            } header: {
                Text("Notch")
            }
            Section {
                Toggle(isOn: $settings.captureHotkeyEnabled) {
                    Text("Capture with \(captureBinding.label)")
                    Text("Select part of the screen from anywhere, even while the notch is hidden, and the AI tab opens with it.")
                }
                LabeledContent("Shortcut") {
                    ShortcutRecorder(slot: .capture, binding: $captureBinding, reserved: [binding, notchBinding]) {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            captureBlocked = GlobalHotkeyManager.shared.isBlocked(.capture)
                        }
                    }
                }
                if captureBlocked && settings.captureHotkeyEnabled {
                    Label("macOS didn't accept \(captureBinding.label): another app may already use it. Pick a different shortcut.",
                          systemImage: "exclamationmark.triangle.fill")
                        .font(.callout).foregroundStyle(.orange)
                }
            } header: {
                Text("Capture for AI")
            } footer: {
                Text("Shortcuts need ⌘ or ⌃. They use macOS's built-in hot keys, so no Accessibility permission is needed and they work in every app, including full-screen ones.")
            }
        }
        .formStyle(.grouped)
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
                Toggle(isOn: $settings.showSystemHUD) {
                    Text("Show volume and brightness beside the notch")
                    Text("When you change either, the closed notch briefly expands with a gauge. Not shown while the notch is hidden.")
                }
                Toggle(isOn: $settings.replaceSystemHUD) {
                    Text("Hide the macOS volume and brightness pop-ups")
                    Text(AXIsProcessTrusted()
                         ? "Only the notch gauge appears when you press the volume or brightness keys."
                         : "Needs Accessibility (System Settings → Privacy & Security → Accessibility). Until you allow it, only the macOS pop-up shows, so the two never overlap.")
                }
                .disabled(!settings.showSystemHUD)
                Toggle(isOn: $settings.showRecordingIndicator) {
                    Text("Show a dot on the notch while the screen is recorded")
                    Text("Works for Notch apple's own recordings and the system recorder (⌘⇧5). Other recording apps can't be detected.")
                }
                Toggle(isOn: $settings.showChargingActivity) {
                    Text("Show battery beside the notch when charging")
                    Text("Briefly shows the battery level when you plug in or unplug the charger.")
                }
            }
            Section {
                Button("Opening, hiding, size and gestures…") { SettingsTab.selection.send(.notch) }
                Button("Show the welcome tour again") { Onboarding.show() }
            } header: {
                Text("Notch")
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
                        Label("Saved on this Mac", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
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
                Text("The camera takes a few photos of you and Apple's Vision framework turns them into a face template, saved in a private file on this Mac only. Photos are never stored or sent anywhere. To unlock, look at the camera and blink. This uses a regular 2D camera, not Apple's 3D Face ID, so treat it as a convenience. Touch ID and your password always work too, and macOS itself can't be unlocked by third-party apps.")
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
            result = "Face data deleted."
        }
    }
}

// MARK: - Modules

private struct ModulesSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @AppStorage("notch.keepInFullscreen") private var keepInFullscreen = true

    var body: some View {
        Form {
            // The notch's own switches, here as well as in Notch, so everything is toggled in one place.
            Section {
                Toggle(isOn: $settings.useDuoAnimations) {
                    Text("Use iPhone Duo animations")
                    Text("The panel springs out of the notch, the highlight slides between tabs and pages morph into place.")
                }
                Toggle(isOn: $keepInFullscreen) {
                    Text("Keep the notch visible in full-screen apps")
                    Text("The notch stays on screen when an app goes full screen, including on Macs without a hardware notch.")
                }
                .onChange(of: keepInFullscreen) { _, _ in
                    let n = AppDelegate.current?.notch
                    n?.reassertWindowLevels(); n?.recheckFullscreen(); n?.updateAutoHide()
                }
            } header: {
                Text("Notch")
            }
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
                                HStack(spacing: 6) {
                                    Text(module.title)
                                    if module.isGated {
                                        Text("PRO").font(.system(size: 9, weight: .heavy)).foregroundStyle(.white)
                                            .padding(.horizontal, 5).padding(.vertical, 1)
                                            .background(LinearGradient(colors: [.orange, .pink], startPoint: .leading, endPoint: .trailing), in: Capsule())
                                            .help("Needs an access code")
                                    }
                                }
                                Text(module.blurb).font(.callout).foregroundStyle(.secondary)
                                if module == .live {
                                    Text("(Not recommended - limited usefulness for most situations, low compatibility)")
                                        .font(.caption.weight(.semibold)).foregroundStyle(.orange)
                                }
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
    @State private var refresh = 0     // bump to re-read saved-key state
    @State private var testResult: (ok: Bool, message: String)?
    @State private var testing = false
    @AppStorage("capture.defaultMode") private var captureMode = CaptureManager.Mode.region.rawValue
    @AppStorage("ai.temperature") private var temperature = -1.0

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
                    LabeledContent("Images") {
                        Label(config.provider.likelySupportsVision(config.model) ? "This model can read screenshots" : "Text only: pick a vision model to use captures",
                              systemImage: config.provider.likelySupportsVision(config.model) ? "eye" : "eye.slash")
                            .foregroundStyle(config.provider.likelySupportsVision(config.model) ? .green : .orange)
                    }
                    HStack {
                        Button(testing ? "Testing…" : "Test connection") {
                            testing = true; testResult = nil
                            Task {
                                testResult = await AIClient.testConnection(provider: config.provider, model: config.model)
                                testing = false
                            }
                        }
                        .disabled(testing)
                        if let r = testResult {
                            Label(r.message, systemImage: r.ok ? "checkmark.circle.fill" : "xmark.octagon.fill")
                                .foregroundStyle(r.ok ? .green : .orange).font(.callout).lineLimit(3)
                        }
                    }
                }
                LabeledContent("Temperature") {
                    HStack {
                        Toggle("Provider default", isOn: Binding(get: { temperature < 0 }, set: { temperature = $0 ? -1 : 0.7 }))
                            .toggleStyle(.checkbox)
                        if temperature >= 0 {
                            Slider(value: $temperature, in: 0...1.5, step: 0.1).frame(width: 140)
                            Text(String(format: "%.1f", temperature)).monospacedDigit().frame(width: 28)
                        }
                    }
                }
                .help("Lower is more precise and repeatable (good for maths); higher is more varied.")
                Toggle(isOn: Binding(get: { ClaudeChatModel.shared.autoScreen }, set: { ClaudeChatModel.shared.autoScreen = $0 })) {
                    Text("Share my screen when I ask about it")
                    Text("Questions like \"what's on my screen?\" or \"explain this error\" automatically include a screenshot.")
                }
                .requires(.aiCapture)
            } header: {
                Text("Provider")
            } footer: {
                Text("Free options need no credit card. OpenRouter's free list changes over time (Qwen, Llama, and DeepSeek when available). The official DeepSeek and ChatGPT APIs require billing.")
            }

            Section {
                Picker("Capture shortcut takes", selection: $captureMode) {
                    ForEach(CaptureManager.Mode.allCases) { Text($0.title).tag($0.rawValue) }
                }
                LabeledContent("Shortcut", value: HotkeyBinding.capture.label)
                LabeledContent("Quality") {
                    Text("Full Retina resolution; sent at up to 2048 px on the long edge").foregroundStyle(.secondary)
                }
            } header: {
                Text("Capture")
            } footer: {
                Text("Region capture freezes the display under the pointer: drag a box, click for the whole display, or press Esc or right-click to cancel. Change the shortcut in Shortcuts & Hotkeys.")
            }

            Section {
                LabeledContent("Stays on this Mac") {
                    Text("API keys, chat history, saved images, and Extract text (Apple's on-device text recognition)").foregroundStyle(.secondary).multilineTextAlignment(.trailing)
                }
                LabeledContent("Sent to \(config.provider.title)") {
                    Text(config.provider == .ollama || config.provider == .apple ? "Nothing: the model runs on this Mac" : "Only what you ask about: your question, the captured or pasted image, and the conversation so far")
                        .foregroundStyle(config.provider == .ollama || config.provider == .apple ? .green : .secondary).multilineTextAlignment(.trailing)
                }
                LabeledContent("Telemetry") { Text("None").foregroundStyle(.secondary) }
            } header: {
                Text("Privacy")
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
                Text("Keys are stored in a private file on this Mac (only your user account can read it) and sent only to that provider.")
            }
            PersonasSettings()
            AutomationsSettings()
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

    private var filtered: [ChatSession] { store.search(search) }

    var body: some View {
        VStack(spacing: 14) {
            // Header card: what this page is, the save switch and the count.
            HStack(spacing: 12) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 18, weight: .semibold)).foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Theme.accentGradient, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("AI chat history").font(.headline)
                    Text(store.sessions.isEmpty ? "Nothing saved yet" : "\(store.sessions.count) chat\(store.sessions.count == 1 ? "" : "s") saved on this Mac")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Menu {
                    Toggle("Save chats", isOn: $store.isEnabled)
                    Toggle("Keep captured images (to continue tasks later)", isOn: $store.saveImages)
                    Picker("Keep chats for", selection: $store.retentionDays) {
                        Text("Forever").tag(0); Text("30 days").tag(30); Text("7 days").tag(7); Text("1 day").tag(1)
                    }
                } label: { Label(store.isEnabled ? "Saving on" : "Saving off", systemImage: store.isEnabled ? "checkmark.circle" : "pause.circle") }
                .fixedSize()
                .help("History stays on this Mac. Turn it off, stop keeping images, or delete old chats automatically.")
                if !store.sessions.isEmpty {
                    Button(role: .destructive) { confirmClear = true } label: { Label("Delete all", systemImage: "trash") }
                }
            }
            .padding(14)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.separator))

            if store.sessions.isEmpty {
                VStack(spacing: 14) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 34, weight: .semibold)).foregroundStyle(.white)
                        .frame(width: 76, height: 76)
                        .background(Theme.accentGradient, in: Circle())
                        .shadow(color: Theme.accent.opacity(0.5), radius: 18)
                    Text("No AI chats yet").font(.title3.bold())
                    Text(store.isEnabled
                         ? "Ask something in the notch's AI tab. Each conversation is saved here with the model that answered, so you can read it again or pick up where you left off."
                         : "Saving is off. Turn on Save chats to keep your conversations here.")
                        .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 380)
                    Button { AppDelegate.showNotch(tab: .claude) } label: { Label("Open AI in the notch", systemImage: "arrow.up.forward.app") }
                        .buttonStyle(PurpleButtonStyle())
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HStack(spacing: 12) {
                    VStack(spacing: 8) {
                        HStack(spacing: 6) {
                            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                            TextField("Search questions, answers, modes, dates", text: $search).textFieldStyle(.plain)
                        }
                        .padding(8)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                        ScrollView {
                            LazyVStack(spacing: 6) {
                                ForEach(filtered) { s in
                                    let selected = s.id == selectedID
                                    Button { selectedID = s.id } label: {
                                        HStack(alignment: .top, spacing: 8) {
                                            HistoryThumb(session: s)
                                            VStack(alignment: .leading, spacing: 3) {
                                                Text(s.firstQuestion).lineLimit(2).font(.callout.weight(.medium)).foregroundStyle(.primary)
                                                Text([s.modeTitle, s.modelsUsed.first ?? s.providerTitle].compactMap { $0 }.joined(separator: " · "))
                                                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                                Text(s.updated.formatted(.relative(presentation: .named))).font(.caption2).foregroundStyle(.tertiary)
                                            }
                                        }
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(10)
                                        .background(selected ? AnyShapeStyle(Theme.accent.opacity(0.28)) : AnyShapeStyle(Theme.surface),
                                                    in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .strokeBorder(selected ? Theme.accent.opacity(0.7) : .clear))
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .contextMenu { Button("Delete", role: .destructive) { store.delete(s.id) } }
                                }
                                if filtered.isEmpty {
                                    Text("No matches").font(.caption).foregroundStyle(.secondary).padding(.top, 12)
                                }
                            }
                        }
                    }
                    .frame(width: 240)

                    Group {
                        if let s = store.sessions.first(where: { $0.id == selectedID }) {
                            ChatTranscriptView(session: s)
                        } else {
                            ContentUnavailableView("Select a chat", systemImage: "text.bubble")
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.separator))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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
                HStack(alignment: .top, spacing: 10) {
                    HistoryThumb(session: session, size: 64)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.firstQuestion).font(.headline).lineLimit(2)
                        if let src = session.inputSource { Text(src).font(.caption).foregroundStyle(.secondary) }
                    }
                }
                Label("\(session.providerTitle) · \(session.modelsUsed.joined(separator: ", "))\(session.modeTitle.map { " · \($0)" } ?? "")", systemImage: "sparkles")
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
                    Button {
                        let panel = NSSavePanel()
                        panel.nameFieldStringValue = "\(session.firstQuestion.prefix(40)).md"
                        if panel.runModal() == .OK, let url = panel.url {
                            try? store.markdown(session).write(to: url, atomically: true, encoding: .utf8)
                        }
                    } label: { Label("Export", systemImage: "square.and.arrow.up") }
                    .help("Save as a Markdown file")
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
                            Group {
                                if m.role == "user" { Text(m.text) } else { RichTextView(markdown: m.text) }
                            }
                                .textSelection(.enabled)
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .background(m.role == "user" ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Theme.surfaceHover),
                                            in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                                .foregroundStyle(.white)
                                .frame(maxWidth: 460, alignment: m.role == "user" ? .trailing : .leading)
                        }
                        .frame(maxWidth: .infinity, alignment: m.role == "user" ? .trailing : .leading)
                    }
                }
                .padding(12)
            }
        }
    }
}

/// The captured image of a history item (or an icon for its input type).
private struct HistoryThumb: View {
    let session: ChatSession
    var size: CGFloat = 38
    @State private var image: NSImage?

    var body: some View {
        Group {
            if let image {
                Image(nsImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: session.inputKind == "text" ? "text.alignleft" : session.hasImage == true ? "photo" : "bubble.left")
                    .foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.surfaceHover)
            }
        }
        .frame(width: size, height: size).clipShape(RoundedRectangle(cornerRadius: 7))
        .task(id: session.id) {
            guard session.hasImage == true else { image = nil; return }
            let url = ChatHistoryStore.shared.imageURL(session.id)
            image = await Task.detached { NSImage(contentsOf: url) }.value
        }
        .accessibilityHidden(true)
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
    @State private var todoistToken = KeychainHelper.get(.todoistToken) ?? ""

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
            Section {
                TextField("Shortcut when a session starts", text: $timer.dndOnShortcut, prompt: Text("e.g. Do Not Disturb On"))
                TextField("Shortcut when it stops", text: $timer.dndOffShortcut, prompt: Text("e.g. Do Not Disturb Off"))
            } header: {
                Text("Do Not Disturb during focus")
            } footer: {
                Text("macOS doesn't let apps change Focus directly, so make two shortcuts in the Shortcuts app with the “Set Focus” action (Do Not Disturb on / off) and type their names here. Leave empty to skip. With Pro, the same shortcuts power the Do Not Disturb toggle in quick actions and the command palette.")
            }
            Section {
                SecureField("Todoist API token", text: $todoistToken)
                    .onSubmit { KeychainHelper.set(todoistToken.trimmingCharacters(in: .whitespaces), for: .todoistToken) }
                    .onChange(of: todoistToken) { _, t in KeychainHelper.set(t.trimmingCharacters(in: .whitespaces), for: .todoistToken) }
                Link("Where do I find it?", destination: URL(string: "https://todoist.com/help/articles/find-your-api-token-Jpzx9IIlB")!)
            } header: {
                HStack(spacing: 6) { Text("To-do apps"); if !Entitlements.shared.canUse(.remindersSync) { TierBadge(tier: .pro) } }
            } footer: {
                Text("Send to-dos to Things (no setup) or Todoist (your token, stored privately on this Mac and sent only to Todoist).")
            }
            .disabled(!Entitlements.shared.canUse(.remindersSync))
        }
        .formStyle(.grouped)
    }
}

// MARK: - File Search

private struct FileSearchSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @StateObject private var search = FileSearchManager.shared

    var body: some View {
        Form {
            Section {
                Toggle("Enable File Search in Notch", isOn: $settings.searchEnabled)
            }
            Section {
                Picker("Search", selection: $settings.searchWholeMac) {
                    Text("User home folder only").tag(false)
                    Text("Entire Mac").tag(true)
                }
                .pickerStyle(.radioGroup)
            } header: {
                Text("Scope")
            } footer: {
                Text("Hidden files, caches and system folders are always skipped.")
            }
            Section {
                Toggle("Apps", isOn: $settings.searchApps)
                Toggle("Documents", isOn: $settings.searchDocuments)
                Toggle("Images", isOn: $settings.searchImages)
                Toggle("PDFs", isOn: $settings.searchPDFs)
                Toggle("Downloads", isOn: $settings.searchDownloads)
            } header: {
                Text("File types")
            } footer: {
                Text("With everything ticked, folders and all other files are included too.")
            }
            Section {
                if search.needsFullDiskAccess {
                    Label("Some folders (Downloads, Documents or Desktop) can't be read yet.", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.yellow)
                }
                Button("Grant Full Disk Access in System Settings") { FileSearchManager.openFullDiskAccessSettings() }
            } header: {
                Text("Permissions")
            }
        }
        .formStyle(.grouped)
        .onAppear { search.checkPermissions() }
    }
}

// MARK: - Clipboard

private struct ClipboardSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @StateObject private var history = ClipboardHistory.shared
    @State private var cleared = false
    @AppStorage("clipboard.protectSecrets") private var protectSecrets = false
    @AppStorage("clipboard.secretSeconds") private var secretSeconds = 30

    var body: some View {
        Form {
            Section {
                Toggle("Save everything I copy", isOn: $settings.clipboardEnabled)
            }
            Section {
                Picker("Keep the last", selection: $history.limit) {
                    ForEach([50, 100, 200, 500, 1000], id: \.self) { Text("\($0) items").tag($0) }
                    ForEach([2500, 5000], id: \.self) { n in
                        Text(Entitlements.shared.canUse(.clipboardUnlimited) ? "\(n) items" : "\(n) items (Pro)").tag(n)
                    }
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
                Text("Pinned items are never removed automatically. Anything a password manager marks as secret is never saved, and nothing leaves your Mac unless you turn on Clipboard Link below.")
            }
            Section {
                ForEach(history.ignoredApps, id: \.self) { id in
                    HStack {
                        Text(NSWorkspace.shared.urlForApplication(withBundleIdentifier: id).map { FileManager.default.displayName(atPath: $0.path) } ?? id)
                        Spacer()
                        Button(role: .destructive) { history.ignoredAppsRaw = history.ignoredApps.filter { $0 != id }.joined(separator: ",") } label: { Image(systemName: "minus.circle") }
                            .buttonStyle(.borderless)
                    }
                }
                Button("Add an app…") {
                    let panel = NSOpenPanel()
                    panel.directoryURL = URL(fileURLWithPath: "/Applications")
                    panel.allowedContentTypes = [.application]
                    guard panel.runModal() == .OK, let url = panel.url, let id = Bundle(url: url)?.bundleIdentifier, !history.ignoredApps.contains(id) else { return }
                    history.ignoredAppsRaw = (history.ignoredApps + [id]).joined(separator: ",")
                }
            } header: {
                HStack(spacing: 6) {
                    Text("Never save copies from")
                    if !Entitlements.shared.canUse(.clipboardUnlimited) { TierBadge(tier: .pro) }
                }
            } footer: {
                Text("For example your banking app or a work tool. Password managers are always skipped.")
            }
            .disabled(!Entitlements.shared.canUse(.clipboardUnlimited))

            Section {
                Toggle(isOn: $protectSecrets) {
                    Text("Protect secrets")
                    Text("API keys, tokens, one-time codes and card numbers are left out of the history and cleared from the clipboard a little later.")
                }
                if protectSecrets {
                    Picker("Clear the clipboard after", selection: $secretSeconds) {
                        ForEach([15, 30, 60, 120], id: \.self) { Text("\($0) seconds").tag($0) }
                    }
                }
            } header: {
                Text("Secrets")
            } footer: {
                Text("A best guess from what the text looks like, not a promise. Nothing is sent anywhere. Anything a password manager marks as secret is always skipped.")
            }

            ClipboardLinkSettings()
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
    @State private var showWhatsNew = WhatsNew.hasUnseen
    @State private var showAcknowledgements = false
    @StateObject private var license = LicenseState.shared
    @ObservedObject private var updater = UpdateChecker.shared

    var body: some View {
        VStack(spacing: 12) {
            Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 96, height: 96)
            Text("Notch apple").font(.title.bold())
            Text("Version \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")")
                .foregroundStyle(.secondary)
            Text("Free, open source, and local first.").foregroundStyle(.secondary)
            HStack(spacing: 14) {
                Label(Entitlements.shared.tier == .free ? "Free" : "\(Entitlements.shared.tier.name) unlocked", systemImage: Entitlements.shared.tier == .free ? "seal" : "checkmark.seal.fill")
                    .foregroundStyle(Entitlements.shared.tier != .free ? .green : .secondary)
                if updater.pendingUpdate != nil {
                    Button { AppDelegate.openSettingsWindow(tab: .updates) } label: { Label("Update available", systemImage: "arrow.down.circle.fill") }
                        .buttonStyle(.link)
                } else {
                    Button("Check for updates") { AppDelegate.openSettingsWindow(tab: .updates); updater.check(userInitiated: true) }.buttonStyle(.link)
                }
            }
            .font(.callout)
            Button { showWhatsNew = true } label: {
                Label(WhatsNew.hasUnseen ? "What's new in \(WhatsNew.currentVersion)" : "What's New", systemImage: "sparkles")
            }
            .buttonStyle(PurpleButtonStyle(prominent: WhatsNew.hasUnseen))
            HStack {
                Link("Website", destination: URL(string: "https://virajsinghchadha.github.io/notchapples-site/")!)
                Text("·").foregroundStyle(.secondary)
                Link("GitHub", destination: URL(string: "https://github.com/AdityaJainDXB/NotchApples")!)
                Text("·").foregroundStyle(.secondary)
                Link("Report an issue", destination: URL(string: "https://github.com/AdityaJainDXB/NotchApples/issues")!)
                Text("·").foregroundStyle(.secondary)
                Link("Donate", destination: URL(string: "https://github.com/AdityaJainDXB/NotchApples#donate-")!)
            }
            Text("MIT License").font(.caption).foregroundStyle(.secondary)
            Button("Acknowledgements") { showAcknowledgements = true }.buttonStyle(.link).font(.caption)
            Button("Quit Notch apple") { NSApp.terminate(nil) }.padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sheet(isPresented: $showAcknowledgements) { AcknowledgementsView() }
        .sheet(isPresented: $showWhatsNew) {
            VStack(spacing: 0) {
                HStack {
                    Text("What's New").font(.title2.bold())
                    Spacer()
                    Button("Done") { showWhatsNew = false }.keyboardShortcut(.defaultAction)
                }
                .padding([.horizontal, .top], 20)
                WhatsNewView()
            }
            .frame(width: 520, height: 560)
        }
    }
}
