//
//  VPNView.swift
//  Notch apple
//
//  One big power button in the middle: tap it to connect to the chosen server, tap again to disconnect.
//  The server picker sits discreetly on the right (your own VPNs, the free library, VPN Gate), with a
//  way to add a VPN by hand. The VPN status stays on this page and no longer shows in the notch header.
//

import SwiftUI
import NetworkExtension
import UniformTypeIdentifiers

struct VPNView: View {
    @StateObject private var vpn = VPNManager.shared
    @State private var importing = false
    @State private var picking = false
    @State private var editing: VPNProfile?
    @State private var addingCustom = false

    private var connected: Bool { vpn.status == .connected }
    private var busy: Bool { vpn.status == .connecting || vpn.status == .reasserting || vpn.status == .disconnecting }

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(spacing: 10) {
                if let client = vpn.needsVPNClient { clientBanner(client) }
                Spacer(minLength: 0)
                PowerButton(connected: connected, busy: busy, enabled: vpn.selected != nil || connected || busy) { toggle() }
                Text(vpn.selected == nil && !connected && !busy ? "Pick a server to connect" : (connected || busy ? vpn.status.label : "Not connected"))
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
                        Button { addingCustom = true } label: { Label("Custom", systemImage: "plus") }
                        Button { importing = true } label: { Label("Import", systemImage: "square.and.arrow.down") }
                    }
                    .buttonStyle(PurpleButtonStyle(prominent: false)).font(.system(size: 11))
                    if let s = vpn.selected, vpn.profiles.contains(where: { $0.id == s.id }) {
                        HStack(spacing: 6) {
                            if s.isCustom == true { Button("Edit") { editing = s }.buttonStyle(PurpleButtonStyle(prominent: false)) }
                            Button("Remove", role: .destructive) { vpn.remove(s) }.buttonStyle(PurpleButtonStyle(prominent: false))
                        }
                        .font(.system(size: 11))
                    }
                    Spacer(minLength: 0)
                }
            }
            .frame(width: 190)
        }
        .onAppear { if vpn.library.isEmpty { Task { await vpn.loadLibrary() } } }
        .sheet(isPresented: $addingCustom) { CustomVPNSheet(profile: nil) }
        .sheet(item: $editing) { CustomVPNSheet(profile: $0) }
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

/// Add or edit a VPN by hand. The password and shared secret go to Notch apple's private secrets file.
private struct CustomVPNSheet: View {
    let profile: VPNProfile?
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vpn = VPNManager.shared
    @State private var name = ""
    @State private var kind: VPNProfile.Kind = .ikev2
    @State private var server = ""
    @State private var username = ""
    @State private var password = ""
    @State private var sharedSecret = ""
    @State private var config = ""

    private var valid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && (kind == .ikev2 ? !server.trimmingCharacters(in: .whitespaces).isEmpty : !config.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(profile == nil ? "Add a custom VPN" : "Edit VPN").font(.title3.bold())
            Form {
                TextField("Name", text: $name)
                Picker("Type", selection: $kind) {
                    Text("IKEv2").tag(VPNProfile.Kind.ikev2)
                    Text("OpenVPN").tag(VPNProfile.Kind.openVPN)
                    Text("WireGuard").tag(VPNProfile.Kind.wireGuard)
                }
                if kind == .ikev2 {
                    TextField("Server address", text: $server)
                    TextField("Username", text: $username)
                    SecureField("Password", text: $password)
                    SecureField("Shared secret (optional)", text: $sharedSecret)
                } else {
                    TextField("Username (optional)", text: $username)
                    SecureField("Password (optional)", text: $password)
                    Text(kind == .openVPN ? "Paste the .ovpn file's contents:" : "Paste the WireGuard .conf file's contents:").font(.caption).foregroundStyle(.secondary)
                    TextEditor(text: $config).font(.system(size: 11, design: .monospaced)).frame(height: 110)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(.secondary.opacity(0.3)))
                }
            }
            .formStyle(.columns)
            Text("Your password stays on this Mac, in Notch apple's private file (readable only by you).")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Save") { save() }.keyboardShortcut(.defaultAction).disabled(!valid)
            }
        }
        .padding(20).frame(width: 440)
        .onAppear {
            guard let p = profile else { return }
            name = p.name; kind = p.kind; server = p.server; username = p.username ?? ""; config = p.config
            let s = vpn.secret(for: p.id); password = s.password; sharedSecret = s.sharedSecret
        }
    }

    private func save() {
        let isWG = kind == .wireGuard
        let parsed = kind == .ikev2 ? server : (VPNManager.parseServer(config, wireGuard: isWG) ?? "custom")
        var p = profile ?? VPNProfile(name: name, kind: kind, server: parsed, config: "")
        p.name = name.trimmingCharacters(in: .whitespaces)
        p.kind = kind
        p.server = parsed
        p.config = kind == .ikev2 ? "" : config
        p.username = username.isEmpty ? nil : username
        vpn.saveCustom(p, secret: VPNSecret(password: password, sharedSecret: sharedSecret))
        dismiss()
    }
}
