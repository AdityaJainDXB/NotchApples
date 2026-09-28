//
//  VPNView.swift
//  Notch apple
//
//  Sleek client UI over `VPNManager`: saved profiles on the left, free servers
//  on the right (the free .ovpn library by default, or VPN Gate).
//

import SwiftUI
import UniformTypeIdentifiers

struct VPNView: View {
    @StateObject private var vpn = VPNManager.shared
    @State private var importing = false
    @State private var source: FreeSource = .library
    @State private var search = ""

    enum FreeSource: String, CaseIterable { case library = "Free library", vpnGate = "VPN Gate" }

    private var freeServers: [VPNProfile] {
        let list = source == .library ? vpn.library : vpn.vpnGate
        guard !search.isEmpty else { return list }
        return list.filter { $0.name.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        VStack(spacing: 10) {
            statusBar
            HStack(alignment: .top, spacing: 12) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("My profiles").sectionTitle()
                            Spacer()
                            IconButton(systemImage: "plus", help: "Import a .ovpn or .conf file") { importing = true }
                        }
                        if vpn.profiles.isEmpty {
                            Text("Import a WireGuard .conf or OpenVPN .ovpn file, or save one from the free servers.")
                                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                        }
                        ScrollView { VStack(spacing: 2) { ForEach(vpn.profiles) { VPNRow(profile: $0, saved: true) } } }
                    }
                }
                .frame(width: 260)

                GlassCard {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Picker("Source", selection: $source) {
                                ForEach(FreeSource.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                            }
                            .pickerStyle(.segmented).labelsHidden().frame(width: 200)
                            if vpn.loadingLibrary || vpn.loadingGate { ProgressView().controlSize(.small) }
                            Spacer()
                            IconButton(systemImage: "arrow.clockwise", help: "Refresh servers") { reload() }
                        }
                        TextField("Search country", text: $search)
                            .textFieldStyle(.plain).font(.system(size: 12))
                            .padding(.horizontal, 10).frame(height: 28)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                        ScrollView { LazyVStack(spacing: 2) { ForEach(freeServers) { VPNRow(profile: $0, saved: false) } } }
                    }
                }
            }
        }
        .onAppear { if vpn.library.isEmpty { reload() } }
        .onChange(of: source) { _, _ in if freeServers.isEmpty { reload() } }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data, .plainText], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { urls.forEach(vpn.importProfile) }
        }
    }

    private func reload() {
        Task { source == .library ? await vpn.loadLibrary() : await vpn.loadVPNGate() }
    }

    private var statusBar: some View {
        HStack(spacing: 8) {
            Circle().fill(vpn.status == .connected ? Color.green : Theme.textSecondary).frame(width: 8, height: 8)
            Text(vpn.status == .invalid ? "Pick a server to connect" : vpn.status.label)
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
            if let msg = vpn.message {
                Text(msg).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(2)
            }
            Spacer()
            if vpn.status == .connected || vpn.status == .connecting {
                Button("Disconnect", action: vpn.disconnect).buttonStyle(PurpleButtonStyle())
            }
        }
    }
}

/// One server / profile row with a hover highlight and a full-height hit area.
private struct VPNRow: View {
    let profile: VPNProfile
    let saved: Bool
    @ObservedObject private var vpn = VPNManager.shared
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 8) {
            Text(profile.kind.rawValue).font(.system(size: 10, weight: .bold))
                .padding(.horizontal, 6).padding(.vertical, 3)
                .background(Theme.accent.opacity(0.3), in: Capsule())
            VStack(alignment: .leading, spacing: 1) {
                Text(profile.name).font(.system(size: 12, weight: .medium)).foregroundStyle(.white).lineLimit(1)
                Text("\(profile.server) · \(profile.credentialsHint ?? (profile.credentialsURL != nil ? "login on provider's page" : ""))")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            Spacer(minLength: 4)
            if !saved {
                IconButton(systemImage: "star", help: "Save to My profiles") { vpn.add(profile) }
            }
            Button("Connect") { Task { await vpn.connect(profile) } }.buttonStyle(PurpleButtonStyle())
        }
        .padding(.horizontal, 6).padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 8).fill(hovering ? Theme.surface : .clear))
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .contextMenu {
            if saved { Button("Delete", role: .destructive) { vpn.remove(profile) } }
            else { Button("Save to My profiles") { vpn.add(profile) } }
            if let page = profile.credentialsURL { Button("Open login page") { NSWorkspace.shared.open(page) } }
        }
    }
}

/// Compact VPN status shown in the notch header whenever the VPN module is on.
/// Click to disconnect, or to jump to the VPN tab when not connected.
struct VPNQuickStatus: View {
    @StateObject private var vpn = VPNManager.shared
    @EnvironmentObject private var state: NotchState
    @State private var hovering = false

    private var connected: Bool { vpn.status == .connected || vpn.status == .connecting }

    var body: some View {
        Button {
            if connected { vpn.disconnect() }
            else { withAnimation(Theme.spring) { state.selected = .vpn } }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: connected ? "lock.shield.fill" : "lock.open")
                Text(connected ? "VPN on" : "VPN off").font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(connected ? Color.green : Theme.textSecondary)
            .padding(.horizontal, 10).frame(height: Theme.minTarget)
            .background(hovering ? Theme.surfaceHover : Theme.surface, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(connected ? "Disconnect VPN" : "Open VPN")
    }
}
