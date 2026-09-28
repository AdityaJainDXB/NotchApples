//
//  SettingsView.swift
//  Notch apple
//
//  The Settings window. Every module has its own on/off switch; the notch UI
//  reacts immediately via `SettingsManager`.
//

import SwiftUI
import ServiceManagement
import WidgetKit
import Combine
import UniformTypeIdentifiers

/// Tabs in the Settings window. `selection` lets other code jump to a tab.
enum SettingsTab: Hashable {
    case modules, claude, vpn, widget, general
    static let selection = PassthroughSubject<SettingsTab, Never>()
}

struct SettingsView: View {
    @State private var tab: SettingsTab = .modules

    var body: some View {
        TabView(selection: $tab) {
            ModulesSettings().tabItem { Label("Modules", systemImage: "square.grid.2x2.fill") }.tag(SettingsTab.modules)
            ClaudeSettings().tabItem { Label("Claude", systemImage: "sparkles") }.tag(SettingsTab.claude)
            VPNSettings().tabItem { Label("VPN", systemImage: "lock.shield.fill") }.tag(SettingsTab.vpn)
            WidgetSettings().tabItem { Label("Widget", systemImage: "rectangle.3.group.fill") }.tag(SettingsTab.widget)
            GeneralSettings().tabItem { Label("General", systemImage: "gearshape.fill") }.tag(SettingsTab.general)
        }
        .frame(width: 560, height: 500)
        .tint(Theme.accent)
        .onReceive(SettingsTab.selection) { tab = $0 }
    }
}

/// Full VPN configuration: enable the module, import profiles, pick free relays.
private struct VPNSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @StateObject private var vpn = VPNManager.shared
    @State private var importing = false

    var body: some View {
        Form {
            Section {
                Toggle("Show VPN in the notch", isOn: $settings.vpnEnabled)
                LabeledContent("Status", value: vpn.status.label)
                if let msg = vpn.message { Text(msg).font(.caption).foregroundStyle(.secondary) }
            }
            Section {
                if vpn.profiles.isEmpty {
                    Text("No profiles yet. Import a WireGuard .conf or OpenVPN .ovpn file.").foregroundStyle(.secondary)
                }
                ForEach(vpn.profiles) { p in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(p.name)
                            Text("\(p.kind.rawValue) · \(p.server)").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Connect") { Task { await vpn.connect(p) } }
                        Button(role: .destructive) { vpn.remove(p) } label: { Image(systemName: "trash") }
                            .buttonStyle(.borderless)
                    }
                }
                Button("Import Profile…") { importing = true }
            } header: { Text("My Profiles") }
            Section {
                HStack {
                    Button(vpn.vpnGate.isEmpty ? "Load free VPN Gate servers" : "Refresh") { Task { await vpn.loadVPNGate() } }
                    if vpn.loadingGate { ProgressView().controlSize(.small) }
                }
                ForEach(vpn.vpnGate.prefix(15)) { p in
                    HStack {
                        Text(p.name).lineLimit(1)
                        Spacer()
                        Button("Save") { vpn.add(p) }
                    }
                }
            } header: { Text("Free Servers") } footer: {
                Text("Free builds hand profiles to the WireGuard or Tunnelblick app. Native tunnels need a build signed with the Network Extension entitlement (see README).")
            }
        }
        .formStyle(.grouped)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data, .plainText], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { urls.forEach(vpn.importProfile) }
        }
    }
}

private struct ModulesSettings: View {
    @EnvironmentObject private var settings: SettingsManager

    var body: some View {
        Form {
            Section {
                ForEach(Module.allCases) { module in
                    Toggle(isOn: settings.binding(for: module)) {
                        HStack(spacing: 12) {
                            Image(systemName: module.symbol)
                                .frame(width: 28, height: 28)
                                .foregroundStyle(.white)
                                .background(Theme.accentGradient, in: RoundedRectangle(cornerRadius: 7))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(module.title).font(.body.weight(.medium))
                                Text(module.blurb).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .toggleStyle(.switch)
                }
            } header: {
                Text("Every module is optional. Turn off anything you don't use.")
            }
        }
        .formStyle(.grouped)
    }
}

private struct ClaudeSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @State private var key = ""
    @State private var hasKey = KeychainHelper.get(.anthropicAPIKey) != nil

    var body: some View {
        Form {
            Section("API Key") {
                if hasKey {
                    LabeledContent("Stored in Keychain") {
                        Button("Remove", role: .destructive) {
                            Task {
                                // Require biometrics before touching the stored secret.
                                if await BiometricAuth.authenticate(reason: "remove your Claude API key") {
                                    KeychainHelper.delete(.anthropicAPIKey); hasKey = false
                                }
                            }
                        }
                    }
                } else {
                    SecureField("sk-ant-…", text: $key)
                    Button("Save to Keychain") {
                        KeychainHelper.set(key.trimmingCharacters(in: .whitespaces), for: .anthropicAPIKey)
                        key = ""; hasKey = true
                    }
                    .disabled(key.isEmpty)
                }
                Link("Get a key at console.anthropic.com", destination: URL(string: "https://console.anthropic.com/settings/keys")!)
            }
            Section("Model") {
                Picker("Model", selection: $settings.claudeModel) {
                    ForEach(ClaudeClient.models, id: \.self) { Text($0).tag($0) }
                }
                Text("Usage is billed to your own Anthropic account. Notch apple never proxies your requests.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}

private struct WidgetSettings: View {
    @State private var city = SharedStore.weatherLocation.name
    @State private var status: String?

    var body: some View {
        Form {
            Section("Weather location") {
                HStack {
                    TextField("City", text: $city)
                    Button("Set") {
                        Task {
                            if let loc = try? await WeatherService.geocode(city) {
                                SharedStore.weatherLocation = loc
                                WidgetCenter.shared.reloadAllTimelines()
                                status = "Using \(loc.name) (\(String(format: "%.2f", loc.latitude)), \(String(format: "%.2f", loc.longitude)))"
                            } else { status = "City not found" }
                        }
                    }
                }
                if let status { Text(status).font(.caption).foregroundStyle(.secondary) }
            }
            Section("Add the widget") {
                Text("Right-click the desktop → Edit Widgets… → search “Notch apple”. On macOS 26+, widgets can also be placed on the Lock Screen.")
                    .font(.callout)
                Text("Weather uses free Open-Meteo data by default. Signed builds can switch to Apple WeatherKit (see README).")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}

private struct GeneralSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled

    var body: some View {
        Form {
            Section("Behavior") {
                Toggle("Show menu bar icon", isOn: $settings.showStatusItem)
                Toggle("Keep notch open when clicking elsewhere", isOn: $settings.stickyNotch)
                Toggle("Toggle the notch with ⌘E from anywhere", isOn: $settings.globalHotkeyEnabled)
                Toggle("Launch at login", isOn: $launchAtLogin)
                    .onChange(of: launchAtLogin) { _, on in
                        try? on ? SMAppService.mainApp.register() : SMAppService.mainApp.unregister()
                    }
            }
            Section {
                Text("The notch opens only when you click it or press ⌘E — never on hover.").font(.caption).foregroundStyle(.secondary)
                LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")
                Button("Quit Notch apple") { NSApp.terminate(nil) }
            }
        }
        .formStyle(.grouped)
    }
}
