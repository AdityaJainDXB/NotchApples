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
    case general, modules, claude, audio, vpn, widget, about
    static let selection = PassthroughSubject<SettingsTab, Never>()

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: "General"
        case .modules: "Modules"
        case .claude: "Claude"
        case .audio: "Audio"
        case .vpn: "VPN"
        case .widget: "Widget"
        case .about: "About"
        }
    }

    var symbol: String {
        switch self {
        case .general: "gearshape.fill"
        case .modules: "square.grid.2x2.fill"
        case .claude: "sparkles"
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
        case .modules: Theme.accent
        case .claude: .orange
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
                case .modules: ModulesSettings()
                case .claude: ClaudeSettings()
                case .audio: AudioSettings()
                case .vpn: VPNSettings()
                case .widget: WidgetSettings()
                case .about: AboutSettings()
                }
            }
            .navigationTitle(tab.title)
        }
        .frame(minWidth: 720, minHeight: 520)
        .tint(Theme.accent)
        .onReceive(SettingsTab.selection) { tab = $0 }
        .onAppear { SettingsWindowController.shared.window?.title = tab.title }
        .onChange(of: tab) { _, new in SettingsWindowController.shared.window?.title = new.title }
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
                        try? on ? SMAppService.mainApp.register() : SMAppService.mainApp.unregister()
                    }
                Toggle("Show icon in menu bar", isOn: $settings.showStatusItem)
            }
            Section {
                Toggle(isOn: $settings.globalHotkeyEnabled) {
                    Text("Open and close with ⌘E")
                    Text("Works in any app. While on, other apps don't receive ⌘E.")
                }
                Toggle(isOn: $settings.stickyNotch) {
                    Text("Keep open when clicking elsewhere")
                    Text("Otherwise the notch closes when you click outside it or press Esc.")
                }
            } header: {
                Text("Notch")
            } footer: {
                Text("The notch opens when you click it, press ⌘E, or drag a file onto it. Hovering only highlights it.")
            }
        }
        .formStyle(.grouped)
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

// MARK: - Claude

private struct ClaudeSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @State private var key = ""
    @State private var hasKey = KeychainHelper.get(.anthropicAPIKey) != nil

    var body: some View {
        Form {
            Section {
                if hasKey {
                    LabeledContent("API key") {
                        HStack {
                            Label("Saved in Keychain", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                            Button("Remove…", role: .destructive) {
                                Task {
                                    // Require biometrics before touching the stored secret.
                                    if await BiometricAuth.authenticate(reason: "remove your Claude API key") {
                                        KeychainHelper.delete(.anthropicAPIKey); hasKey = false
                                    }
                                }
                            }
                        }
                    }
                } else {
                    SecureField("API key", text: $key, prompt: Text("sk-ant-…"))
                    Button("Save to Keychain") {
                        KeychainHelper.set(key.trimmingCharacters(in: .whitespaces), for: .anthropicAPIKey)
                        key = ""; hasKey = true
                    }
                    .disabled(key.isEmpty)
                }
            } header: {
                Text("Account")
            } footer: {
                Link("Get an API key at console.anthropic.com", destination: URL(string: "https://console.anthropic.com/settings/keys")!)
            }
            Section {
                Picker("Model", selection: $settings.claudeModel) {
                    ForEach(ClaudeClient.models, id: \.self) { Text($0).tag($0) }
                }
            } footer: {
                Text("Usage is billed to your own Anthropic account. Requests go straight from your Mac to Anthropic.")
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

    var body: some View {
        Form {
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
                Text("Weather location")
            } footer: {
                Text("Weather comes from free Open-Meteo data.")
            }
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
