//
//  AudioView.swift
//  Notch apple
//
//  Audio hub: output routing, master volume, and native per-app volume + EQ.
//

import SwiftUI

/// Per-app EQ settings (bundle ID → dB per band), persisted in UserDefaults.
final class EQStore: ObservableObject {
    static let shared = EQStore()
    static let bands = ["32", "64", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"]

    static let presets: [(name: String, gains: [Double])] = [
        ("Flat", Array(repeating: 0, count: 10)),
        ("Bass boost", [6, 5, 4, 2, 0, 0, 0, 0, 0, 0]),
        ("Vocal", [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1]),
        ("Treble boost", [0, 0, 0, 0, 0, 1, 2, 4, 5, 6]),
        ("Podcast", [-4, -3, -1, 1, 3, 4, 3, 2, 0, -2]),
    ]

    @Published var gains: [String: [Double]] = [:] {
        didSet { UserDefaults.standard.set(gains, forKey: "eq.gains") }
    }

    init() { gains = UserDefaults.standard.dictionary(forKey: "eq.gains") as? [String: [Double]] ?? [:] }

    func gains(for bundleID: String) -> [Double] { gains[bundleID] ?? Array(repeating: 0, count: Self.bands.count) }

    func set(_ bundleID: String, band: Int, db: Double) {
        var g = gains(for: bundleID); g[band] = db; gains[bundleID] = g
        AudioDeviceController.shared.reapply(bundleID: bundleID)
    }

    func set(_ bundleID: String, all: [Double]) {
        gains[bundleID] = all
        AudioDeviceController.shared.reapply(bundleID: bundleID)
    }
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
                    Picker("Output device", selection: Binding(get: { audio.defaultOutput }, set: audio.setDefaultOutput)) {
                        ForEach(audio.outputs) { Text($0.name).tag($0.id) }
                    }
                    .labelsHidden()

                    Text("Volume").sectionTitle().padding(.top, 4)
                    HStack {
                        Image(systemName: "speaker.fill").foregroundStyle(Theme.textSecondary)
                        Slider(value: Binding(get: { Double(audio.volume) }, set: { audio.setVolume(Float($0)) }), in: 0...1)
                            .accessibilityLabel("Output volume")
                        Image(systemName: "speaker.wave.3.fill").foregroundStyle(Theme.textSecondary)
                    }
                    Text("\(Int(audio.volume * 100))%").font(.system(size: 30, weight: .bold, design: .rounded))
                        .foregroundStyle(Theme.accentGradient)
                        .contentTransition(.numericText())
                    Spacer(minLength: 0)
                }
            }
            .frame(width: 230)

            GlassCard {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        if let app = eqApp {
                            IconButton(systemImage: "chevron.left", help: "Back to apps") { withAnimation(Theme.spring) { eqApp = nil } }
                            Text("Equalizer · \(app.name)").sectionTitle()
                        } else {
                            Text("Apps").sectionTitle()
                            Text("Volume and EQ for each app").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                        }
                        Spacer()
                        IconButton(systemImage: "arrow.clockwise", help: "Refresh apps") { audio.refresh() }
                    }
                    backendNotice
                    if let app = eqApp { eqEditor(app) } else { perAppList }
                }
            }
        }
        .onAppear { audio.refresh() }
    }

    @ViewBuilder
    private var backendNotice: some View {
        if let error = audio.appAudioError {
            Label(error, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 11)).foregroundStyle(.yellow).lineLimit(3)
        } else if audio.backend == .unavailable {
            Label("Per-app audio needs macOS 14.2, or the BackgroundMusic driver included in the Notch apple DMG.",
                  systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 11)).foregroundStyle(.yellow)
        }
    }

    private var perAppList: some View {
        ScrollView {
            VStack(spacing: 2) {
                ForEach(audio.appVolumes) { app in
                    HStack(spacing: 10) {
                        if let icon = NSRunningApplication(processIdentifier: app.pid)?.icon {
                            Image(nsImage: icon).resizable().frame(width: 20, height: 20)
                        }
                        Text(app.name).font(.system(size: 12)).foregroundStyle(.white)
                            .frame(width: 110, alignment: .leading).lineLimit(1)
                        Slider(value: Binding(get: { app.level }, set: { audio.setAppVolume(app, level: $0) }), in: 0...150)
                            .disabled(audio.backend == .unavailable)
                            .accessibilityLabel("\(app.name) volume")
                        Text("\(Int(app.level))%").font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(Theme.textSecondary).frame(width: 38, alignment: .trailing)
                        IconButton(systemImage: "slider.vertical.3", help: "Equalizer for \(app.name)") {
                            withAnimation(Theme.spring) { eqApp = app }
                        }
                        .disabled(audio.backend != .native)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    private func eqEditor(_ app: AppVolume) -> some View {
        let gains = eq.gains(for: app.bundleID)
        return VStack(spacing: 10) {
            HStack(alignment: .bottom, spacing: 8) {
                ForEach(Array(EQStore.bands.enumerated()), id: \.offset) { i, band in
                    VStack(spacing: 4) {
                        Text(String(format: "%+.0f", gains[i])).font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(Theme.textSecondary)
                        Slider(value: Binding(get: { gains[i] }, set: { eq.set(app.bundleID, band: i, db: $0) }), in: -12...12)
                            .rotationEffect(.degrees(-90))
                            .frame(width: 130, height: 28)
                            .frame(width: 28, height: 130)
                            .accessibilityLabel("\(band) hertz")
                        Text(band).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            HStack(spacing: 6) {
                ForEach(EQStore.presets, id: \.name) { preset in
                    Button(preset.name) { eq.set(app.bundleID, all: preset.gains) }
                        .buttonStyle(PurpleButtonStyle(prominent: gains == preset.gains))
                }
            }
        }
    }
}
