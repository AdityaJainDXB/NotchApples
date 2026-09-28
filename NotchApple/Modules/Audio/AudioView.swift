//
//  AudioView.swift
//  Notch apple
//
//  Audio hub: output routing, master volume, per-app volume (via the
//  BackgroundMusic driver) and a per-app EQ scaffold.
//

import SwiftUI

/// Per-app EQ presets. Stored locally; applying them to live audio requires an
/// Audio Server Plugin / AU host (see README → Audio). The UI and persistence
/// are ready so a DSP backend can plug in via `EQStore.apply`.
final class EQStore: ObservableObject {
    static let shared = EQStore()
    static let bands = ["32", "64", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"]

    @Published var gains: [String: [Double]] = [:] {   // bundleID → dB per band
        didSet { UserDefaults.standard.set(gains, forKey: "eq.gains") }
    }

    init() { gains = UserDefaults.standard.dictionary(forKey: "eq.gains") as? [String: [Double]] ?? [:] }

    func gains(for bundleID: String) -> [Double] { gains[bundleID] ?? Array(repeating: 0, count: Self.bands.count) }

    func set(_ bundleID: String, band: Int, db: Double) {
        var g = gains(for: bundleID); g[band] = db; gains[bundleID] = g
        apply(bundleID)
    }

    /// Integration point for a DSP backend (e.g. an AU graph inside a BackgroundMusic fork).
    func apply(_ bundleID: String) {}
}

struct AudioView: View {
    @StateObject private var audio = AudioDeviceController.shared
    @StateObject private var eq = EQStore.shared
    @State private var eqApp: AppVolume?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            GlassCard {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Output").sectionTitle()
                    Picker("", selection: Binding(get: { audio.defaultOutput }, set: audio.setDefaultOutput)) {
                        ForEach(audio.outputs) { Text($0.name).tag($0.id) }
                    }
                    .labelsHidden()

                    Text("Master Volume").sectionTitle()
                    HStack {
                        Image(systemName: "speaker.fill").foregroundStyle(Theme.textSecondary)
                        Slider(value: Binding(get: { Double(audio.volume) }, set: { audio.setVolume(Float($0)) }), in: 0...1)
                        Image(systemName: "speaker.wave.3.fill").foregroundStyle(Theme.textSecondary)
                    }
                    Text("\(Int(audio.volume * 100))%").font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(Theme.accentGradient)
                        .contentTransition(.numericText())
                }
            }
            .frame(width: 220)

            GlassCard {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(eqApp.map { "EQ · \($0.name)" } ?? "Per-App Volume").sectionTitle()
                        Spacer()
                        if eqApp != nil { Button("Done") { withAnimation(Theme.spring) { eqApp = nil } }.buttonStyle(PurpleButtonStyle(prominent: false)) }
                    }
                    if let app = eqApp { eqEditor(app) } else { perAppList }
                }
            }
        }
        .onAppear { audio.refresh() }
    }

    @ViewBuilder
    private var perAppList: some View {
        if audio.backgroundMusicDevice == nil {
            VStack(alignment: .leading, spacing: 6) {
                Label("BackgroundMusic driver not found", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption).foregroundStyle(.yellow)
                Text("Per-app volume needs the free, open-source BackgroundMusic audio driver. Install it, then select “Background Music” as output.")
                    .font(.caption).foregroundStyle(Theme.textSecondary)
                Link("Get BackgroundMusic →", destination: URL(string: "https://github.com/kyleneideck/BackgroundMusic")!)
                    .font(.caption.bold())
            }
        }
        ScrollView {
            VStack(spacing: 6) {
                ForEach(audio.appVolumes) { app in
                    HStack(spacing: 8) {
                        if let icon = NSRunningApplication(processIdentifier: app.pid)?.icon {
                            Image(nsImage: icon).resizable().frame(width: 18, height: 18)
                        }
                        Text(app.name).font(.caption).foregroundStyle(.white).frame(width: 90, alignment: .leading).lineLimit(1)
                        Slider(value: Binding(get: { app.level }, set: { audio.setAppVolume(app, level: $0) }), in: 0...100)
                            .disabled(audio.backgroundMusicDevice == nil)
                        Button { withAnimation(Theme.spring) { eqApp = app } } label: { Image(systemName: "slider.vertical.3") }
                            .buttonStyle(.plain).foregroundStyle(Theme.textSecondary).help("App EQ")
                    }
                }
            }
        }
    }

    private func eqEditor(_ app: AppVolume) -> some View {
        let gains = eq.gains(for: app.bundleID)
        return HStack(alignment: .bottom, spacing: 10) {
            ForEach(Array(EQStore.bands.enumerated()), id: \.offset) { i, band in
                VStack(spacing: 4) {
                    Slider(value: Binding(get: { gains[i] }, set: { eq.set(app.bundleID, band: i, db: $0) }), in: -12...12)
                        .rotationEffect(.degrees(-90))
                        .frame(width: 110, height: 20)
                        .frame(width: 20, height: 110)
                    Text(band).font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}
