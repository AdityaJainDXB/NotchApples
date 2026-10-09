//
//  ExtrasSettings.swift
//  Notch apple
//
//  Settings → Notch Extras: the small things around the closed notch.
//

import SwiftUI

struct ExtrasSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @AppStorage("notch.stackActivities") private var stack = true
    @AppStorage("extras.eventCountdown") private var eventCountdown = true
    @StateObject private var watch = SystemWatch.shared
    @State private var confirmAddHooks = false
    @State private var hookMessage: String?

    var body: some View {
        Form {
            Section {
                Toggle("Low battery warning at 20% and 10%", isOn: $settings.lowBatteryAlert)
                Toggle("Charging animation when you plug in", isOn: $settings.showChargingActivity)
                Toggle("Album cover while music plays (Now Playing)", isOn: $settings.musicActivity)
                Toggle("Download and copy progress", isOn: $settings.downloadProgress).requires(.downloadProgress)
                Toggle("Keep Awake countdown", isOn: $settings.keepAwakeActivity)
                Toggle("Countdown to your next event (15 minutes before)", isOn: $eventCountdown)
                Toggle("“Join” before video calls in your calendar", isOn: $settings.meetingAlert).requires(.meetingAlert)
                Toggle("Rain alert (“rain in 15 min”)", isOn: $settings.rainAlert).requires(.rainAlert)
                Toggle("Microphone and camera in use (Devices add-on)", isOn: $settings.privacyIndicator)
                Toggle("Accessory low battery (Devices add-on)", isOn: $settings.accessoryBatteryAlert)
                Toggle("New notifications (Notifications add-on)", isOn: $settings.flashNotifications)
                Toggle("Show two activities at once, one in each ear", isOn: $stack).requires(.activityStacking)
            } header: {
                Text("Beside the closed notch")
            } footer: {
                Text("Timers, the stopwatch, screen recordings and live scores always show while they run.")
            }
            Section {
                Toggle("Remind me to unplug", isOn: $watch.batteryCare)
                if watch.batteryCare { Stepper("When charging reaches \(watch.batteryLimit)%", value: $watch.batteryLimit, in: 50...100, step: 5) }
                Toggle("Warn when disk space is low", isOn: $watch.diskAlert)
                if watch.diskAlert { Stepper("Below \(watch.diskGB) GB free", value: $watch.diskGB, in: 2...200, step: 2) }
                Toggle("Tell me when the internet drops", isOn: $watch.internetAlert)
            } header: {
                Text("Guards")
            } footer: {
                Text("Battery care and the disk warning only read this Mac. The internet alert fetches a tiny Apple page every 20 seconds to check you're online and how fast it answers; nothing else is sent. The speed test in the Stats tab downloads about 20 MB from Cloudflare when you press it.")
            }
            Section {
                Text(verbatim: "open -g \"notchapple://activity?id=build&title=Build&text=42%&symbol=hammer.fill&progress=0.42\"")
                    .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                Text(verbatim: "open -g \"notchapple://activity/end?id=build\"")
                    .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                Link("How to use it (README) →", destination: URL(string: "https://github.com/AdityaJainDXB/NotchApples#live-activities-api")!)
            } header: {
                HStack(spacing: 6) {
                    Text("Activities from your apps and scripts")
                    if !Entitlements.shared.canUse(.liveActivityAPI) { TierBadge(tier: .ultimate).help(Feature.liveActivityAPI.benefit) }
                }
            } footer: {
                Text("Builds, uploads, deploys, anything: show its progress beside the notch from Terminal, Shortcuts or your own app. It stays on this Mac.")
            }
            Section {
                Toggle("Claude Code status dot", isOn: $settings.claudeCodeDot)
                Toggle("Also flash the whole screen", isOn: $settings.claudeCodeScreenFlash)
                    .disabled(!settings.claudeCodeDot)
                    .help("A half-second wash of green or yellow over every screen. It never takes focus or clicks.")
                HStack {
                    Button(ClaudeCodeStatus.hooksInstalled ? "Hooks added ✓" : "Add to Claude Code…") { confirmAddHooks = true }
                        .disabled(ClaudeCodeStatus.hooksInstalled)
                    Button("Copy the hooks") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(ClaudeCodeStatusLogic.snippet(), forType: .string)
                    }
                    Spacer()
                    Button("Try green") { ClaudeCodeStatus.shared.show(.green) }
                    Button("Try yellow") { ClaudeCodeStatus.shared.show(.yellow) }
                }
                if let m = hookMessage { Text(m).font(.caption).foregroundStyle(.secondary) }
            } header: {
                Text("Claude Code")
            } footer: {
                Text("A green dot for 4 seconds when a Claude Code task finishes; a yellow one for 4 seconds when it needs your input or approval, or finishes with warnings or errors. It shows beside the closed notch and in the open notch's header. “Add to Claude Code” adds two hooks to ~/.claude/settings.json (after saving a copy); or run open -g \"notchapple://claude-code?status=done\" (or attention) from any script.")
            }
            Section {
                MusicPlayerPicker()
                Toggle("Music bars move with the song", isOn: $settings.musicBarsFollowAudio)
            } header: {
                Text("Music")
            } footer: {
                Text("Now Playing shows whatever is playing on your Mac. The default player is what Play and Open Player start when nothing is playing. To make the bars move with the song, Notch apple listens to your Mac's sound while music plays (it needs the System Audio Recording permission); nothing is recorded or saved.")
            }
            Section {
                Toggle("Trim recordings when you stop", isOn: $settings.trimAfterRecording)
                Toggle("Synced lyrics in Now Playing", isOn: $settings.showLyrics).requires(.lyrics)
                Toggle("Cassette mode in Now Playing", isOn: $settings.cassetteMode)
                Text("Shows the song as a tape with the controls beside it. It stays this way until you change it.").font(.caption).foregroundStyle(.secondary)
            } header: {
                Text("Recording and music")
            } footer: {
                Text("Lyrics come from LRCLIB (free); the song title and artist are sent to look them up.")
            }
        }
        .formStyle(.grouped)
        .alert("Add the hooks to Claude Code?", isPresented: $confirmAddHooks) {
                Button("Add") { hookMessage = ClaudeCodeStatus.installHooks() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This edits ~/.claude/settings.json to run a tiny command when Claude Code finishes or needs you. A backup copy is saved next to it.")
            }
    }
}

private struct MusicPlayerPicker: View {
    @ObservedObject private var monitor = NowPlayingMonitor.shared

    var body: some View {
        Picker("Default music app", selection: $monitor.defaultPlayer) {
            ForEach(monitor.installedPlayers, id: \.id) { Text($0.name).tag($0.id) }
        }
        Picker("Show in Now Playing", selection: $monitor.sourceRaw) {
            ForEach(NowPlayingMonitor.Source.allCases) { Text($0.title).tag($0.rawValue) }
        }
        Button("Choose another app…") { monitor.chooseOtherPlayer() }
    }
}
