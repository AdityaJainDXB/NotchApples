//
//  ExtrasSettings.swift
//  Notch apple
//
//  Settings → Notch Extras: the small things around the closed notch.
//

import SwiftUI

struct ExtrasSettings: View {
    @EnvironmentObject private var settings: SettingsManager

    var body: some View {
        Form {
            Section {
                Toggle("Low battery warning at 20% and 10%", isOn: $settings.lowBatteryAlert)
                Toggle("Charging animation when you plug in", isOn: $settings.showChargingActivity)
                Toggle("Album cover while music plays (Now Playing)", isOn: $settings.musicActivity)
                Toggle("Download and copy progress", isOn: $settings.downloadProgress).requires(.downloadProgress)
                Toggle("Keep Awake countdown", isOn: $settings.keepAwakeActivity)
                Toggle("“Join” before video calls in your calendar", isOn: $settings.meetingAlert).requires(.meetingAlert)
                Toggle("Rain alert (“rain in 15 min”)", isOn: $settings.rainAlert).requires(.rainAlert)
                Toggle("Microphone and camera in use (Devices add-on)", isOn: $settings.privacyIndicator)
                Toggle("Accessory low battery (Devices add-on)", isOn: $settings.accessoryBatteryAlert)
                Toggle("New notifications (Notifications add-on)", isOn: $settings.flashNotifications)
            } header: {
                Text("Beside the closed notch")
            } footer: {
                Text("Timers, the stopwatch, screen recordings and live scores always show while they run.")
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
            } header: {
                Text("Recording and music")
            } footer: {
                Text("Lyrics come from LRCLIB (free); the song title and artist are sent to look them up.")
            }
        }
        .formStyle(.grouped)
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
