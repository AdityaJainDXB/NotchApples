//
//  CompanionApp.swift
//  Notch apple companion (iPhone)
//
//  Send text and links to your Mac's notch, see its battery and music, and run
//  a few controls, over your Wi-Fi with no server. Needs Notch apple Ultimate
//  on the Mac (Settings → iPhone). Installed with Sideloadly.
//

import AppIntents
import SwiftUI

@main
struct NotchCompanionApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @StateObject private var client = CompanionClient.shared

    var body: some View {
        NavigationStack {
            Group {
                if client.pairing == nil { PairView() } else { MainView() }
            }
            .navigationTitle("Notch apple")
        }
        .tint(Color(red: 0.62, green: 0.42, blue: 1))
        .preferredColorScheme(.dark)
    }
}

struct PairView: View {
    @StateObject private var client = CompanionClient.shared
    @State private var chosen: Chosen?
    @State private var code = ""
    @FocusState private var codeFocused: Bool

    var body: some View {
        List {
            Section {
                if client.found.isEmpty {
                    HStack { ProgressView(); Text("Looking for Macs on this Wi-Fi…").foregroundStyle(.secondary) }
                }
                ForEach(client.found, id: \.self) { name in
                    Button { code = ""; chosen = Chosen(name: name) } label: { Label(name, systemImage: "laptopcomputer") }
                }
            } header: {
                Text("Your Macs")
            } footer: {
                Text("On the Mac, open Notch apple → Settings → iPhone, turn on the iPhone companion and press Pair an iPhone. Both need to be on the same Wi-Fi.")
            }
            if let m = client.message { Text(m).foregroundStyle(.orange) }
        }
        .onAppear { client.browse() }
        .sheet(item: $chosen) { c in
            NavigationStack {
                Form {
                    Section {
                        TextField("6-digit code", text: $code).keyboardType(.numberPad).font(.system(size: 28, weight: .bold, design: .monospaced))
                            .focused($codeFocused)
                            .onChange(of: code) { _, new in
                                // Pairs by itself once all six digits are in.
                                let digits = String(new.filter(\.isNumber).prefix(6))
                                if digits != new { code = digits }
                                if digits.count == 6, !client.busy {
                                    Task { await client.pair(with: c.name, code: digits); if client.pairing != nil { chosen = nil } }
                                }
                            }
                    } footer: { Text("The code is shown on \(c.name). Pairing starts as soon as you've typed it.") }
                    Button(client.busy ? "Pairing…" : "Pair") {
                        Task { await client.pair(with: c.name, code: code); if client.pairing != nil { chosen = nil } }
                    }
                    .disabled(code.count != 6 || client.busy)
                    if let m = client.message { Text(m).foregroundStyle(.orange) }
                }
                .navigationTitle("Pair with \(c.name)")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { chosen = nil } } }
                .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { codeFocused = true } }
            }
            .presentationDetents([.medium, .large])
            .interactiveDismissDisabled()
        }
    }

    struct Chosen: Identifiable { let name: String; var id: String { name } }
}

struct MainView: View {
    @StateObject private var client = CompanionClient.shared
    @State private var text = ""
    @State private var sent = false

    var body: some View {
        List {
            Section {
                if let s = client.status {
                    LabeledContent("Battery", value: s.battery.map { "\($0)%\(s.charging ? " · charging" : "")" } ?? "—")
                    if let t = s.title {
                        VStack(alignment: .leading) {
                            Text(t).font(.headline)
                            if let a = s.artist { Text(a).foregroundStyle(.secondary) }
                        }
                    } else {
                        LabeledContent("Music", value: "Nothing playing")
                    }
                    if let timer = s.timer { LabeledContent("Timer", value: timer) }
                } else {
                    Text("Pull down to refresh").foregroundStyle(.secondary)
                }
                HStack(spacing: 24) {
                    ForEach(["previous", "playPause", "next"], id: \.self) { a in
                        Button { Task { await client.control(a) } } label: {
                            Image(systemName: Companion.controlActions.first { $0.id == a }?.symbol ?? "circle").font(.title2)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(Companion.controlActions.first { $0.id == a }?.title ?? a)
                    }
                }
                .frame(maxWidth: .infinity)
            } header: { Text(client.pairing?.macName ?? "Mac") }

            Section {
                TextField("Text or a link", text: $text, axis: .vertical).lineLimit(1...5)
                Button(sent ? "Sent ✓" : "Send to the notch") {
                    Task { sent = await client.send(text: text); if sent { text = "" }; try? await Task.sleep(for: .seconds(2)); sent = false }
                }
                .disabled(text.isEmpty || client.busy)
                Button("Send what I copied") {
                    Task { if let s = UIPasteboard.general.string { sent = await client.send(text: s) } }
                }
            } header: { Text("Send") } footer: {
                Text("Text lands on the Mac's clipboard and links can open there. In Shortcuts, use “Send to Mac notch” from the share sheet.")
            }

            Section("Controls") {
                ForEach(Companion.controlActions.filter { !["previous", "playPause", "next"].contains($0.id) }, id: \.id) { a in
                    Button { Task { await client.control(a.id) } } label: { Label(a.title, systemImage: a.symbol) }
                }
            }

            if let m = client.message { Section { Text(m).foregroundStyle(.secondary) } }

            Section { Button("Unpair this iPhone", role: .destructive) { client.unpair() } }
        }
        .refreshable { await client.refresh() }
        .task { await client.refresh() }
    }
}

// MARK: - Shortcuts

struct SendToMacIntent: AppIntent {
    static let title: LocalizedStringResource = "Send to Mac notch"
    static let description = IntentDescription("Sends text or a link to Notch apple on your Mac.")
    @Parameter(title: "Text or link") var text: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ok = await CompanionClient.shared.send(text: text)
        return .result(dialog: ok ? "Sent to your Mac." : "Couldn't reach your Mac.")
    }
}

struct MacStatusIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Mac status"
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        await CompanionClient.shared.refresh()
        let s = await CompanionClient.shared.status
        let text = s.map { "\($0.macName): battery \($0.battery.map { "\($0)%" } ?? "—")\($0.title.map { ", playing \($0)" } ?? "")" } ?? "Couldn't reach your Mac."
        return .result(value: text, dialog: "\(text)")
    }
}

struct CompanionShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: SendToMacIntent(), phrases: ["Send to my Mac with \(.applicationName)"], shortTitle: "Send to Mac", systemImageName: "laptopcomputer")
        AppShortcut(intent: MacStatusIntent(), phrases: ["Check my Mac with \(.applicationName)"], shortTitle: "Mac status", systemImageName: "battery.75percent")
    }
}
