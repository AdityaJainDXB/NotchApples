//
//  ShareView.swift
//  Notch apple
//
//  Two ways to share: Apple AirDrop via `NSSharingService`, and PairDrop for
//  local cross-device sharing with a 6-digit pairing code.
//

import SwiftUI
import UniformTypeIdentifiers

struct ShareView: View {
    @StateObject private var pairDrop = PairDropService.shared
    @State private var airDropTargeted = false
    @State private var selectedPeer: PairDropPeer?
    @State private var codeEntry = ""

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            airDropCard.frame(width: 190)
            pairDropCard
        }
    }

    // MARK: AirDrop

    private var airDropCard: some View {
        GlassCard {
            VStack(spacing: 10) {
                Text("AirDrop").sectionTitle().frame(maxWidth: .infinity, alignment: .leading)
                ZStack {
                    Circle().fill(Theme.accentGradient.opacity(airDropTargeted ? 0.9 : 0.35))
                        .frame(width: 92, height: 92)
                        .scaleEffect(airDropTargeted ? 1.08 : 1)
                    Image(systemName: "airplayaudio").font(.system(size: 32)).foregroundStyle(.white)
                }
                .animation(Theme.spring, value: airDropTargeted)
                .onDrop(of: [.fileURL], isTargeted: $airDropTargeted) { providers in
                    loadURLs(providers) { airDrop($0) }
                    return true
                }
                Text("Drop files to AirDrop").font(.caption).foregroundStyle(Theme.textSecondary)
                Button("Choose…") { pickFiles { airDrop($0) } }.buttonStyle(PurpleButtonStyle(prominent: false))
            }
        }
    }

    private func airDrop(_ urls: [URL]) {
        guard let service = NSSharingService(named: .sendViaAirDrop), service.canPerform(withItems: urls) else { return }
        service.perform(withItems: urls)
    }

    // MARK: PairDrop

    private var pairDropCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("PairDrop · Local Wi-Fi").sectionTitle()
                    Spacer()
                    Toggle("", isOn: Binding(get: { pairDrop.isRunning },
                                             set: { $0 ? pairDrop.start() : pairDrop.stop() }))
                        .toggleStyle(.switch).controlSize(.mini).labelsHidden()
                }

                if pairDrop.isRunning {
                    HStack(spacing: 6) {
                        Text("Your code").font(.caption).foregroundStyle(Theme.textSecondary)
                        Text(pairDrop.pairingCode.map(String.init).joined(separator: " "))
                            .font(.system(size: 18, weight: .bold, design: .monospaced))
                            .foregroundStyle(Theme.accentBright)
                        Button { pairDrop.regenerateCode() } label: { Image(systemName: "arrow.clockwise") }
                            .buttonStyle(.plain).foregroundStyle(Theme.textSecondary)
                    }

                    Text("Nearby").font(.caption).foregroundStyle(Theme.textSecondary)
                    if pairDrop.peers.isEmpty {
                        Label("Searching…", systemImage: "antenna.radiowaves.left.and.right")
                            .font(.caption).foregroundStyle(Theme.textSecondary)
                    }
                    ScrollView {
                        ForEach(pairDrop.peers) { peer in
                            Button { selectedPeer = peer } label: {
                                HStack {
                                    Image(systemName: "laptopcomputer.and.iphone")
                                    Text(peer.id).lineLimit(1)
                                    Spacer()
                                    if selectedPeer == peer { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accentBright) }
                                }
                                .padding(6)
                                .background(selectedPeer == peer ? Theme.accent.opacity(0.2) : .clear, in: RoundedRectangle(cornerRadius: 8))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .frame(maxHeight: 80)

                    if let peer = selectedPeer {
                        HStack {
                            TextField("Their 6-digit code", text: $codeEntry)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 140)
                                .onChange(of: codeEntry) { _, v in codeEntry = String(v.filter(\.isNumber).prefix(6)) }
                            Button("Send File…") {
                                pickFiles { urls in urls.forEach { pairDrop.send($0, to: peer, code: codeEntry) } }
                            }
                            .buttonStyle(PurpleButtonStyle())
                            .disabled(codeEntry.count != 6)
                        }
                    }
                }

                Text(pairDrop.status).font(.caption2).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
        }
    }

    // MARK: Helpers

    private func pickFiles(_ completion: @escaping ([URL]) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        NSApp.activate(ignoringOtherApps: true)
        if panel.runModal() == .OK { completion(panel.urls) }
    }

    private func loadURLs(_ providers: [NSItemProvider], _ completion: @escaping ([URL]) -> Void) {
        let group = DispatchGroup()
        var urls: [URL] = []
        for p in providers {
            group.enter()
            _ = p.loadObject(ofClass: URL.self) { url, _ in
                if let url { DispatchQueue.main.async { urls.append(url) } }
                group.leave()
            }
        }
        group.notify(queue: .main) { completion(urls) }
    }
}
