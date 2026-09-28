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

struct SettingsView: View {
    var body: some View {
        TabView {
            ModulesSettings().tabItem { Label("Modules", systemImage: "square.grid.2x2.fill") }
            ClaudeSettings().tabItem { Label("Claude", systemImage: "sparkles") }
            WidgetSettings().tabItem { Label("Widget", systemImage: "rectangle.3.group.fill") }
            GeneralSettings().tabItem { Label("General", systemImage: "gearshape.fill") }
        }
        .frame(width: 520, height: 460)
        .tint(Theme.accent)
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
                Toggle("Launch at login", isOn: $launchAtLogin)
                    .onChange(of: launchAtLogin) { _, on in
                        try? on ? SMAppService.mainApp.register() : SMAppService.mainApp.unregister()
                    }
            }
            Section {
                Text("The notch opens only when you click it — never on hover.").font(.caption).foregroundStyle(.secondary)
                LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")
                Button("Quit Notch apple") { NSApp.terminate(nil) }
            }
        }
        .formStyle(.grouped)
    }
}
