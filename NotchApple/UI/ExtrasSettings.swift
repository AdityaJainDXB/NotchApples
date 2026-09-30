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
                Picker("Show the notch on", selection: $settings.notchDisplayMode) {
                    Text("Built-in display").tag("builtin")
                    Text("The display with the pointer").tag("pointer")
                    Text("Main display (menu bar)").tag("main")
                }
            } header: {
                Text("Displays")
            } footer: {
                Text("On displays without a notch (like an external monitor), Notch apple draws a virtual one in the middle of the menu bar.")
            }
            Section {
                Toggle("Scroll on the notch to change volume, swipe to skip tracks", isOn: $settings.notchGestures)
            } header: {
                Text("Gestures")
            } footer: {
                Text("Two fingers up or down over the closed notch changes the volume; a sideways swipe plays the next or previous track.")
            }
            Section {
                Toggle("Low battery warning at 20% and 10%", isOn: $settings.lowBatteryAlert)
                Toggle("Charging animation when you plug in", isOn: $settings.showChargingActivity)
                Toggle("Album cover while music plays (Now Playing)", isOn: $settings.musicActivity)
                Toggle("Download and copy progress", isOn: $settings.downloadProgress)
                Toggle("Keep Awake countdown", isOn: $settings.keepAwakeActivity)
                Toggle("“Join” before video calls in your calendar", isOn: $settings.meetingAlert)
                Toggle("Rain alert (“rain in 15 min”)", isOn: $settings.rainAlert)
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
            } header: {
                Text("Music")
            } footer: {
                Text("Now Playing shows whatever is playing on your Mac. The default player is what Play and Open Player start when nothing is playing.")
            }
            Section {
                Toggle("Trim recordings when you stop", isOn: $settings.trimAfterRecording)
                Toggle("Synced lyrics in Now Playing", isOn: $settings.showLyrics)
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
