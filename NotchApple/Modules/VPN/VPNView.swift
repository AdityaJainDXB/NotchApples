//
//  VPNView.swift
//  Notch apple
//
//  One big power button in the middle: tap it to connect to the chosen server, tap again to disconnect.
//  The server picker sits discreetly on the right (your VPN app, the free library, VPN Gate). To use your own VPN
//  you only add its app: no addresses, passwords or config files. The VPN status stays on this page and no longer shows in the notch header.
//

import SwiftUI
import NetworkExtension
import UniformTypeIdentifiers

struct VPNView: View {
    @StateObject private var vpn = VPNManager.shared
    @State private var importing = false
    @State private var picking = false
    @State private var addingApp = false

    /// For a VPN app, "connected" means the Mac has a VPN tunnel up (the app itself isn't something Notch apple can ask).
    private var connected: Bool { vpn.selected?.kind == .app ? vpn.tunnelActive : vpn.status == .connected }
    private var busy: Bool { vpn.selected?.kind != .app && (vpn.status == .connecting || vpn.status == .reasserting || vpn.status == .disconnecting) }

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(spacing: 10) {
                if let client = vpn.needsVPNClient { clientBanner(client) }
                Spacer(minLength: 0)
                PowerButton(connected: connected, busy: busy, enabled: vpn.selected != nil || connected || busy) { toggle() }
                Text(vpn.selected == nil && !connected && !busy ? "Pick a server or add your VPN app" : (connected ? "Connected" : (busy ? vpn.status.label : "Not connected")))
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(connected ? Color.green : .white)
                if let s = vpn.selected {
                    Text(s.name).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                }
                if let msg = vpn.message {
                    Text(msg).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center).lineLimit(3)
                        .frame(maxWidth: 360)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity)

            GlassCard {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Server").sectionTitle()
                    Button { picking = true } label: {
                        HStack(spacing: 6) {
                            Text(vpn.selected?.name ?? "Choose…").font(.system(size: 12, weight: .semibold)).lineLimit(1)
                            Spacer(minLength: 2)
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 10))
                        }
                        .foregroundStyle(.white).padding(.horizontal, 10).frame(height: 30)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .popover(isPresented: $picking, arrowEdge: .leading) { ServerPicker(isPresented: $picking) }
                    HStack(spacing: 6) {
                        Button { addingApp = true } label: { Label("VPN app", systemImage: "plus.app") }
                        Button { importing = true } label: { Label("Import", systemImage: "square.and.arrow.down") }
                    }
                    .buttonStyle(PurpleButtonStyle(prominent: false)).font(.system(size: 11))
                    if let s = vpn.selected, vpn.profiles.contains(where: { $0.id == s.id }) {
                        Button("Remove", role: .destructive) { vpn.remove(s) }
                            .buttonStyle(PurpleButtonStyle(prominent: false)).font(.system(size: 11))
                    }
                    Spacer(minLength: 0)
                }
            }
            .frame(width: 190)
        }
        .onAppear {
            vpn.startWatchingTunnel()
            if vpn.library.isEmpty { Task { await vpn.loadLibrary() } }
        }
        .onDisappear { vpn.stopWatchingTunnel() }
        .sheet(isPresented: $addingApp) { AddVPNAppSheet() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data, .plainText], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { urls.forEach(vpn.importProfile) }
        }
    }

    private func toggle() {
        if connected || busy { vpn.disconnect() }
        else if let s = vpn.selected { Task { await vpn.connect(s) } }
        else { picking = true }
    }

    /// One-time setup prompt when a VPN client app is needed.
    private func clientBanner(_ client: VPNManager.VPNClient) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "arrow.down.app.fill").font(.system(size: 22)).foregroundStyle(Theme.accentGradient)
            VStack(alignment: .leading, spacing: 2) {
                Text(client == .tunnelblick ? "One-time setup: install the VPN helper" : "One-time setup: install WireGuard")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                Text(client == .tunnelblick
                     ? "Tunnelblick is free, open source and included with Notch apple. After installing, your server connects automatically."
                     : "WireGuard is free on the Mac App Store. After installing, your profile opens automatically.")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(2)
            }
            Spacer()
            Button("Not now") { vpn.cancelClientInstall() }.buttonStyle(PurpleButtonStyle(prominent: false))
            Button(client == .tunnelblick ? "Install" : "Open App Store") { vpn.installVPNClient() }.buttonStyle(PurpleButtonStyle())
        }
        .padding(10)
        .background(Theme.accent.opacity(0.18), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// The big round power button: grey when off, a spinning ring while it works, glowing green when connected.
private struct PowerButton: View {
    let connected: Bool
    let busy: Bool
    let enabled: Bool
    let action: () -> Void
    @State private var spin = false
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle().fill(connected ? Color.green.opacity(0.16) : Theme.surface)
                Circle().strokeBorder(connected ? Color.green : Color.white.opacity(hovering ? 0.35 : 0.18), lineWidth: 3)
                if busy {
                    Circle().trim(from: 0, to: 0.28).stroke(Theme.accentBright, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                        .rotationEffect(.degrees(spin ? 360 : 0))
                        .animation(.linear(duration: 1).repeatForever(autoreverses: false), value: spin)
                        .onAppear { spin = true }
                        .onDisappear { spin = false }
                }
                Image(systemName: "power").font(.system(size: 50, weight: .semibold))
                    .foregroundStyle(connected ? Color.green : .white.opacity(enabled ? 0.9 : 0.4))
            }
            .frame(width: 128, height: 128)
            .shadow(color: connected ? Color.green.opacity(0.55) : .clear, radius: 22)
            .scaleEffect(hovering ? 1.03 : 1)
            .animation(Theme.spring, value: hovering)
            .animation(Theme.spring, value: connected)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(connected ? "Disconnect" : "Connect")
        .accessibilityLabel(connected ? "Disconnect VPN" : "Connect VPN")
    }
}

/// Where the server is chosen: your own VPNs, the free library, or VPN Gate, with search.
private struct ServerPicker: View {
    @Binding var isPresented: Bool
    @StateObject private var vpn = VPNManager.shared
    @State private var source: Source = .mine
    @State private var search = ""

    enum Source: String, CaseIterable { case mine = "Mine", library = "Free library", vpnGate = "VPN Gate" }

    private var list: [VPNProfile] {
        let all: [VPNProfile]
        switch source {
        case .mine: all = vpn.profiles
        case .library: all = vpn.library
        case .vpnGate: all = vpn.vpnGate
        }
        return search.isEmpty ? all : all.filter { $0.name.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        VStack(spacing: 8) {
            Picker("", selection: $source) { ForEach(Source.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
                .pickerStyle(.segmented).labelsHidden()
            TextField("Search", text: $search).textFieldStyle(.roundedBorder).font(.system(size: 12))
            ScrollView {
                LazyVStack(spacing: 2) {
                    if list.isEmpty {
                        Text(source == .mine ? "Nothing saved yet. Add a custom VPN or import a file." : (vpn.loadingLibrary || vpn.loadingGate ? "Loading…" : "No servers found."))
                            .font(.system(size: 12)).foregroundStyle(.secondary).padding(.top, 20)
                    }
                    ForEach(list) { p in
                        // Not a Button wrapping a Button: the row picks the server, the star saves it.
                        HStack {
                            Text(p.kind.rawValue).font(.system(size: 9, weight: .bold)).padding(.horizontal, 5).padding(.vertical, 2)
                                .background(Theme.accent.opacity(0.3), in: Capsule())
                            Text(p.name).font(.system(size: 12)).lineLimit(1)
                            Spacer()
                            if vpn.selected?.id == p.id { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)) }
                            if source != .mine {
                                Button { vpn.add(p) } label: { Image(systemName: "star") }.buttonStyle(.plain).help("Save to Mine")
                            }
                        }
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .contentShape(Rectangle())
                        .onTapGesture { vpn.selected = p; isPresented = false }
                    }
                }
            }
        }
        .padding(12).frame(width: 320, height: 340)
        .onChange(of: source) { _, new in
            Task { if new == .library, vpn.library.isEmpty { await vpn.loadLibrary() }; if new == .vpnGate, vpn.vpnGate.isEmpty { await vpn.loadVPNGate() } }
        }
    }
}

/// Adds your VPN app in one click. No server addresses, usernames, passwords or config files: the app does the connecting.
private struct AddVPNAppSheet: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vpn = VPNManager.shared

    private struct Found: Identifiable { let id: String; let name: String; let url: URL }

    /// The known VPN apps that are installed on this Mac.
    private var found: [Found] {
        KnownVPNApps.all.compactMap { app in
            NSWorkspace.shared.urlForApplication(withBundleIdentifier: app.bundleID).map { Found(id: app.bundleID, name: app.name, url: $0) }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Add your VPN app").font(.title3.bold())
            Text("Pick the VPN app you already use. Notch apple opens it for you and shows whether your Mac is connected. You don't type any addresses or passwords.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if found.isEmpty {
                Text("No well-known VPN apps found. Choose yours below.").font(.callout).foregroundStyle(.secondary).padding(.vertical, 6)
            } else {
                ScrollView {
                    VStack(spacing: 4) {
                        ForEach(found) { app in
                            HStack(spacing: 10) {
                                Image(nsImage: NSWorkspace.shared.icon(forFile: app.url.path)).resizable().frame(width: 28, height: 28)
                                Text(app.name).font(.system(size: 13, weight: .medium))
                                Spacer()
                                Button("Add") { vpn.addApp(at: app.url); dismiss() }
                            }
                            .padding(.horizontal, 8).padding(.vertical, 4)
                        }
                    }
                }
                .frame(maxHeight: 220)
            }
            HStack {
                Button("Choose another app…") { chooseApp() }
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
            }
        }
        .padding(20).frame(width: 420)
    }

    private func chooseApp() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.application]
        panel.directoryURL = URL(fileURLWithPath: "/Applications")
        panel.allowsMultipleSelection = false
        panel.message = "Choose your VPN app"
        NSApp.activate(ignoringOtherApps: true)
        if panel.runModal() == .OK, let url = panel.url { vpn.addApp(at: url); dismiss() }
    }
}
