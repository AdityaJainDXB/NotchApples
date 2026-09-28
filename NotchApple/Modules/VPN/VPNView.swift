//
//  VPNView.swift
//  Notch apple
//
//  Sleek client UI over `VPNManager`: saved profiles on the left, the free
//  VPN Gate relay list on the right.
//

import SwiftUI
import UniformTypeIdentifiers

struct VPNView: View {
    @StateObject private var vpn = VPNManager.shared
    @State private var importing = false

    var body: some View {
        VStack(spacing: 10) {
            statusBar
            HStack(alignment: .top, spacing: 12) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("My Profiles").sectionTitle()
                            Spacer()
                            Button { importing = true } label: { Image(systemName: "plus") }
                                .buttonStyle(PurpleButtonStyle(prominent: false)).help("Import .conf / .ovpn")
                        }
                        if vpn.profiles.isEmpty {
                            Text("Import a WireGuard .conf or OpenVPN .ovpn file.").font(.caption).foregroundStyle(Theme.textSecondary)
                        }
                        ScrollView { VStack(spacing: 4) { ForEach(vpn.profiles) { row($0, saved: true) } } }
                    }
                }
                GlassCard {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("VPN Gate · Free relays").sectionTitle()
                            Spacer()
                            if vpn.loadingGate { ProgressView().controlSize(.mini) }
                            Button { Task { await vpn.loadVPNGate() } } label: { Image(systemName: "arrow.clockwise") }
                                .buttonStyle(PurpleButtonStyle(prominent: false))
                        }
                        ScrollView { VStack(spacing: 4) { ForEach(vpn.vpnGate) { row($0, saved: false) } } }
                    }
                }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data, .plainText], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { urls.forEach(vpn.importProfile) }
        }
    }

    private var statusBar: some View {
        HStack {
            Circle().fill(vpn.status == .connected ? Color.green : Theme.textSecondary).frame(width: 8, height: 8)
            Text(vpn.status.label).font(.callout.weight(.semibold)).foregroundStyle(.white)
            if let msg = vpn.message { Text(msg).font(.caption).foregroundStyle(Theme.textSecondary).lineLimit(2) }
            Spacer()
            if vpn.status == .connected || vpn.status == .connecting {
                Button("Disconnect", action: vpn.disconnect).buttonStyle(PurpleButtonStyle())
            }
        }
    }

    private func row(_ p: VPNProfile, saved: Bool) -> some View {
        HStack(spacing: 8) {
            Text(p.kind.rawValue).font(.system(size: 9, weight: .bold))
                .padding(.horizontal, 5).padding(.vertical, 2)
                .background(Theme.accent.opacity(0.3), in: Capsule())
            VStack(alignment: .leading, spacing: 0) {
                Text(p.name).font(.caption).foregroundStyle(.white).lineLimit(1)
                Text(p.server).font(.caption2).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            Spacer()
            Button("Connect") { Task { await vpn.connect(p) } }.buttonStyle(PurpleButtonStyle())
        }
        .contextMenu {
            if saved { Button("Delete", role: .destructive) { vpn.remove(p) } }
            else { Button("Save to My Profiles") { vpn.add(p) } }
        }
    }
}

/// Compact VPN status shown in the notch header whenever the VPN module is on.
/// Click to disconnect, or to jump to the VPN tab when not connected.
struct VPNQuickStatus: View {
    @StateObject private var vpn = VPNManager.shared
    @EnvironmentObject private var state: NotchState

    private var connected: Bool { vpn.status == .connected || vpn.status == .connecting }

    var body: some View {
        Button {
            if connected { vpn.disconnect() }
            else { withAnimation(Theme.spring) { state.selected = .vpn } }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: connected ? "lock.shield.fill" : "lock.open")
                Text(connected ? "VPN On" : "VPN Off").font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(connected ? Color.green : Theme.textSecondary)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(Color.white.opacity(0.08), in: Capsule())
        }
        .buttonStyle(.plain)
        .help(connected ? "Disconnect VPN" : "Open VPN")
    }
}
