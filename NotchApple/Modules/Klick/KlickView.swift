//
//  KlickView.swift
//  Notch apple
//
//  The Klick tab (Pro): the on / off switch, the eight sounds as cards (click one to choose it and hear it; the chosen
//  one has its own volume slider), a key-up option and a box to try it. See KlickEngine.
//

import SwiftUI

struct KlickView: View {
    @StateObject private var klick = KlickEngine.shared
    @State private var tryText = ""

    private let columns = [GridItem(.adaptive(minimum: 128), spacing: 8)]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            if klick.needsAccessibility { permissionNote }
            ScrollView {
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(KlickEngine.packs) { card($0) }
                }
            }
            HStack(spacing: 10) {
                Toggle("Key-up sound", isOn: $klick.keyUpSound).toggleStyle(.switch).controlSize(.mini).font(.system(size: 11))
                TextField("Type here to try it…", text: $tryText).textFieldStyle(.roundedBorder).font(.system(size: 11))
            }
        }
        .onAppear { klick.refreshPermission() }
    }

    private var header: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 9).fill(klick.isOn ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Theme.surface))
                Image(systemName: "keyboard.fill").font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
            }
            .frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 1) {
                Text("Klick").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                Text(klick.isOn ? "\(klick.pack.name) · every key you type, in any app" : "Mechanical keyboard sounds as you type")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            Spacer()
            // A little light that flashes on each key.
            TimelineView(.periodic(from: .now, by: 0.05)) { ctx in
                let lit = klick.isOn && ctx.date.timeIntervalSince(klick.lastKey) < 0.08
                Circle().fill(lit ? Theme.accentBright : Theme.surface).frame(width: 8, height: 8)
                    .shadow(color: lit ? Theme.accentBright : .clear, radius: 4)
            }
            .frame(width: 10, height: 10)
            Toggle("", isOn: $klick.isOn).toggleStyle(.switch).labelsHidden()
                .help(klick.isOn ? "Turn Klick off" : "Turn Klick on")
        }
    }

    private var permissionNote: some View {
        HStack(spacing: 8) {
            Image(systemName: "lock.shield").foregroundStyle(.orange)
            Text("To hear keys in other apps, allow Notch apple in Privacy & Security → Accessibility and Input Monitoring. Already on but silent after an update? Select Notch apple there, press −, then add it again. Until then only keys typed in Notch apple click.")
                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            VStack(spacing: 4) {
                Button("Accessibility") {
                    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") { NSWorkspace.shared.open(url) }
                }
                Button("Input Monitoring") {
                    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent") { NSWorkspace.shared.open(url) }
                }
            }
            .buttonStyle(PurpleButtonStyle(prominent: false))
        }
        .padding(8)
        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }

    private func card(_ p: KlickEngine.Pack) -> some View {
        let chosen = p.id == klick.packID
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: p.symbol).font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(chosen ? Theme.accentBright : Theme.textSecondary)
                Text(p.name).font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                Spacer(minLength: 0)
                if chosen { Image(systemName: "checkmark.circle.fill").font(.system(size: 12)).foregroundStyle(Theme.accentBright) }
            }
            Text(p.blurb).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            if chosen {
                // The chosen sound's own volume.
                HStack(spacing: 4) {
                    Image(systemName: "speaker.fill").font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
                    Slider(value: Binding(get: { klick.volume(for: p.id) }, set: { klick.setVolume($0, for: p.id) }), in: 0...1,
                           onEditingChanged: { editing in if !editing { klick.play("down") } })
                        .controlSize(.mini)
                    Image(systemName: "speaker.wave.3.fill").font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
                }
                .help("\(p.name) volume: \(Int(klick.volume(for: p.id) * 100))%")
            }
        }
        .padding(9)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 11).fill(chosen ? Theme.accent.opacity(0.2) : Theme.surface))
        .overlay(RoundedRectangle(cornerRadius: 11).strokeBorder(chosen ? Theme.accent : .clear, lineWidth: 1.2))
        .contentShape(Rectangle())
        .onTapGesture { klick.preview(p.id) }
        .help("Choose \(p.name) and hear it")
    }
}
