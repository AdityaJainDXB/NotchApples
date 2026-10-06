//
//  LidFoldSettings.swift
//  Notch apple, Lid Fold
//
//  Original to Notch apple. Settings → Lid Fold.
//

import SwiftUI
import NotchKit

struct LidFoldSettings: View {
    @ObservedObject private var module = LidFoldModule.shared
    @State private var granted = ScreenPermission.isGranted
    @State private var binding = HotkeyBinding.lidFold
    @State private var blocked = GlobalHotkeyManager.shared.isBlocked(.foldToggle)
    private let poll = Timer.publish(every: 2, on: .main, in: .common).autoconnect()

    var body: some View {
        Form {
            Section {
                Toggle(isOn: $module.enabled) {
                    Text("Lid Fold")
                    Text("Folds, tilts and frosts your desktop. Off by default: nothing is captured until you turn this on.")
                }
                Text(module.status).font(.callout).foregroundStyle(.secondary)
            }

            Section {
                HStack {
                    Image(systemName: granted ? "checkmark.circle.fill" : "exclamationmark.circle")
                        .foregroundStyle(granted ? .green : .orange)
                    Text(granted ? "Screen Recording is allowed" : "Screen Recording is not allowed")
                    Spacer()
                    if !granted {
                        Button("Allow") { ScreenPermission.request() }.buttonStyle(.borderedProminent)
                        Button("Open Settings…") { ScreenPermission.openSettings() }
                        Button("Relaunch") { AppRelauncher.relaunch() }.help("macOS applies Screen Recording only after the app restarts")
                    }
                }
                Text(ModulePermission.screenRecording.explanation).font(.caption).foregroundStyle(.secondary)
            } header: { Text("Permission") } footer: {
                if !granted { Text("Limited mode: Preview and the hotkey work with a plain backdrop, but your own desktop is not shown. Following the real lid needs the permission.") }
            }

            Section {
                HStack {
                    Button("Preview") { module.preview() }.disabled(!module.canTrigger)
                    Button("Timed demo") { module.runDemo() }.disabled(!module.canTrigger)
                    if module.isShowing { Button("Bring my desktop back") { module.dismiss() } }
                }
                LabeledContent("Fold and hold") {
                    ShortcutRecorder(slot: .lidFold, binding: $binding) {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { blocked = GlobalHotkeyManager.shared.isBlocked(.foldToggle) }
                    }
                }
                if blocked && module.enabled {
                    Label("macOS didn't accept \(binding.label): another app may use it. Pick a different shortcut.", systemImage: "exclamationmark.triangle.fill")
                        .font(.callout).foregroundStyle(.orange)
                }
            } header: { Text("Try it") } footer: {
                Text("Preview folds once and ends by itself after about 4 seconds. The timed demo holds for up to 12 seconds, and the hotkey holds for up to 30. Click anywhere, press Esc or the hotkey to remove the fold at any moment.")
            }

            Section {
                Toggle(isOn: $module.followLid) {
                    Text("Follow the lid")
                    Text("Fold as you close the lid, unfold as you reopen it. Needs a MacBook with a lid-angle sensor and Screen Recording.")
                }
                .disabled(!module.enabled)
                if module.followLid {
                    LabeledContent("Sensor") { Text(module.sensorMessage.isEmpty ? "—" : module.sensorMessage) }
                    LabeledContent("Lid angle") { Text(module.sensorAngle.map { "\(Int($0))°" } ?? "—").monospacedDigit() }
                }
            } header: { Text("Optional trigger") } footer: {
                Text("Not every Mac has the sensor (for example the M1 MacBook Air and 13-inch MacBook Pro do not). Without it this switch turns itself off; everything else keeps working.")
            }
        }
        .formStyle(.grouped)
        .onReceive(poll) { _ in granted = ScreenPermission.isGranted }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in granted = ScreenPermission.isGranted }
    }
}
