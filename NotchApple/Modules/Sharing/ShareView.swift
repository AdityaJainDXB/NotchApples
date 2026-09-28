//
//  ShareView.swift
//  Notch apple
//
//  Two ways to share: Apple AirDrop via `NSSharingService`, and PairDrop for
//  local sharing with a 6-digit code.
//
//  PairDrop has two clear modes:
//   • Receive — shows your code. Read it out to the sender. That's it.
//   • Send    — type the other device's code and pick files. No need to pick
//               a device; the right one is found automatically.
//

import SwiftUI
import UniformTypeIdentifiers

struct ShareView: View {
    @StateObject private var pairDrop = PairDropService.shared
    @State private var airDropTargeted = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            airDropCard.frame(width: 200)
            PairDropCard(pairDrop: pairDrop)
        }
        .onAppear { pairDrop.start() }
    }

    // MARK: AirDrop

    private var airDropCard: some View {
        GlassCard {
            VStack(spacing: 12) {
                Text("AirDrop").sectionTitle().frame(maxWidth: .infinity, alignment: .leading)
                ZStack {
                    Circle().fill(Theme.accentGradient.opacity(airDropTargeted ? 0.9 : 0.35))
                        .frame(width: 96, height: 96)
                        .scaleEffect(airDropTargeted ? 1.08 : 1)
                    Image(systemName: "airplayaudio").font(.system(size: 34)).foregroundStyle(.white)
                }
                .animation(Theme.spring, value: airDropTargeted)
                .onDrop(of: [.fileURL], isTargeted: $airDropTargeted) { providers in
                    loadURLs(providers) { airDrop($0) }
                    return true
                }
                .accessibilityLabel("AirDrop drop zone")
                Text("Drop files here").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                Button("Choose files…") { pickFiles { airDrop($0) } }.buttonStyle(PurpleButtonStyle(prominent: false))
                Spacer(minLength: 0)
            }
        }
    }

    private func airDrop(_ urls: [URL]) {
        guard let service = NSSharingService(named: .sendViaAirDrop), service.canPerform(withItems: urls) else { return }
        service.perform(withItems: urls)
    }
}

private struct PairDropCard: View {
    @ObservedObject var pairDrop: PairDropService
    @State private var mode: Mode = .receive
    @State private var codeEntry = ""
    @State private var dropTargeted = false
    @State private var chosenPeer: PairDropPeer?

    enum Mode: String, CaseIterable { case receive = "Receive", send = "Send" }

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("PairDrop").sectionTitle()
                    Text("Same Wi-Fi, no internet needed").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Picker("", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented).labelsHidden().frame(width: 170)
                }

                if mode == .receive { receiveView } else { sendView }

                Spacer(minLength: 0)
                Label(pairDrop.status, systemImage: pairDrop.isSending ? "arrow.up.circle" : "info.circle")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(2)
            }
        }
    }

    // MARK: Receive

    private var receiveView: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Give this code to the person sending you files:")
                .font(.system(size: 13)).foregroundStyle(.white)
            HStack(spacing: 8) {
                Text(pairDrop.pairingCode.map(String.init).joined(separator: " "))
                    .font(.system(size: 34, weight: .bold, design: .monospaced))
                    .foregroundStyle(Theme.accentBright)
                    .textSelection(.enabled)
                    .accessibilityLabel("Your code is \(pairDrop.pairingCode.map(String.init).joined(separator: " "))")
                IconButton(systemImage: "arrow.clockwise", help: "New code") { pairDrop.regenerateCode() }
            }
            Label("Files you receive are saved to Downloads.", systemImage: "arrow.down.circle")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
        }
    }

    // MARK: Send

    private var sendView: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                TextField("Their 6-digit code", text: $codeEntry)
                    .textFieldStyle(.plain)
                    .font(.system(size: 18, weight: .semibold, design: .monospaced))
                    .padding(.horizontal, 12).frame(height: 36)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                    .frame(width: 200)
                    .onChange(of: codeEntry) { _, v in codeEntry = String(v.filter(\.isNumber).prefix(6)) }
                Button {
                    pickFiles { pairDrop.send($0, code: codeEntry, to: chosenPeer) }
                } label: { Label("Choose files…", systemImage: "paperplane.fill") }
                .buttonStyle(PurpleButtonStyle())
                .disabled(codeEntry.count != 6 || pairDrop.isSending)
            }

            // Drop zone — drag files here once the code is entered.
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(dropTargeted ? Theme.accentBright : Theme.separator,
                              style: StrokeStyle(lineWidth: dropTargeted ? 2 : 1, dash: [5, 4]))
                .background(RoundedRectangle(cornerRadius: 10).fill(dropTargeted ? Theme.accent.opacity(0.15) : .clear))
                .overlay(Text(codeEntry.count == 6 ? "…or drop files here to send" : "Enter the code, then drop files here")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary))
                .frame(height: 56)
                .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in
                    guard codeEntry.count == 6 else { return false }
                    loadURLs(providers) { pairDrop.send($0, code: codeEntry, to: chosenPeer) }
                    return true
                }

            // Optional: pick a specific device instead of auto-finding by code.
            Menu {
                Button("Find automatically by code") { chosenPeer = nil }
                if !pairDrop.peers.isEmpty { Divider() }
                ForEach(pairDrop.peers) { peer in Button(peer.displayName) { chosenPeer = peer } }
            } label: {
                Label(chosenPeer?.displayName ?? "\(pairDrop.peers.count) nearby device\(pairDrop.peers.count == 1 ? "" : "s") · automatic",
                      systemImage: "laptopcomputer.and.iphone")
                    .font(.system(size: 12))
            }
            .menuStyle(.borderlessButton).fixedSize()
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
    let lock = NSLock()
    for p in providers {
        group.enter()
        _ = p.loadObject(ofClass: URL.self) { url, _ in
            if let url { lock.lock(); urls.append(url); lock.unlock() }
            group.leave()
        }
    }
    group.notify(queue: .main) { completion(urls) }
}
