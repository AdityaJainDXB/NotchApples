//
//  NotchSettings.swift
//  Notch apple
//
//  Settings → Notch: how it opens, when it steps aside, its size, edge zones,
//  tabs per display, gestures and feedback. Pro options show a badge and stay
//  visible (so you can see what they do) but are disabled until unlocked.
//

import SwiftUI

struct NotchSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @ObservedObject private var entitlements = Entitlements.shared
    @AppStorage("notch.hoverDelay") private var hoverDelay = 0.15
    @AppStorage("notch.autoHideFullscreen") private var autoHideFullscreen = true
    @AppStorage("notch.autoHideRecording") private var autoHideRecording = false
    @AppStorage("notch.panelWidth") private var panelWidth = 740.0
    @AppStorage("notch.panelHeight") private var panelHeight = 420.0
    @AppStorage("notch.edgeTrigger") private var edgeTrigger = "off"
    @AppStorage("notch.sounds") private var sounds = false
    @AppStorage("notch.haptics") private var haptics = false

    private var notch: NotchWindowController? { AppDelegate.current?.notch }

    var body: some View {
        Form {
            Section {
                Toggle(isOn: $settings.globalHotkeyEnabled) {
                    Text("Open and close with \(HotkeyBinding.notch.label)")
                    Text("Works in any app. Change the shortcut in Shortcuts & Hotkeys.")
                }
                Toggle(isOn: $settings.hoverToOpen) {
                    Text("Open on hover")
                    Text("Opens when the pointer rests on the notch and closes when it moves away. Click inside to keep it open.")
                }
                LabeledContent("Hover delay") {
                    HStack {
                        Slider(value: $hoverDelay, in: 0...1, step: 0.05).frame(width: 180)
                        Text(hoverDelay == 0 ? "Instant" : String(format: "%.2f s", hoverDelay)).monospacedDigit().frame(width: 60, alignment: .trailing)
                    }
                }
                .disabled(!settings.hoverToOpen && edgeTrigger == "off")
                Toggle(isOn: $settings.stickyNotch) {
                    Text("Keep open when clicking elsewhere")
                    Text("Otherwise the notch closes when you click outside it or press Esc.")
                }
            } header: {
                Text("Opening")
            } footer: {
                Text("Click the notch, press \(HotkeyBinding.notch.label), drag a file onto it, or (with Open on hover) rest the pointer on it. In the open notch, ⌘1–⌘9 jump to a tab and ⌘[ / ⌘] step through them.")
            }

            Section {
                Toggle(isOn: $autoHideFullscreen) {
                    Text("Hide in fullscreen apps")
                    Text("Videos, games and presentations get the whole screen. The hotkey still opens the notch.")
                }
                .onChange(of: autoHideFullscreen) { _, _ in notch?.recheckFullscreen(); notch?.updateAutoHide() }
                Toggle(isOn: $autoHideRecording) {
                    Text("Hide while the screen is recorded")
                    Text("While Notch apple's recorder or the system recorder (⌘⇧5) is running. Other apps' screen sharing can't be detected.")
                }
                .onChange(of: autoHideRecording) { _, _ in notch?.updateAutoHide() }
            } header: {
                Text("Stepping aside")
            }

            Section {
                LabeledContent("Width") {
                    HStack {
                        Slider(value: $panelWidth, in: NotchPrefs.widthRange, step: 10) { editing in preview(editing) }.frame(width: 200)
                        Text("\(Int(panelWidth)) pt").monospacedDigit().frame(width: 60, alignment: .trailing)
                    }
                }
                LabeledContent("Height") {
                    HStack {
                        Slider(value: $panelHeight, in: NotchPrefs.heightRange, step: 10) { editing in preview(editing) }.frame(width: 200)
                        Text("\(Int(panelHeight)) pt").monospacedDigit().frame(width: 60, alignment: .trailing)
                    }
                }
                Button("Reset size") { panelWidth = 740; panelHeight = 420; notch?.reposition() }
            } header: {
                proHeader("Size", .notchResize)
            } footer: {
                Text("The notch opens while you drag, so you can see the size live. You can also pinch on the open notch.")
            }
            .disabled(!entitlements.canUse(.notchResize))
            .onChange(of: panelWidth) { _, _ in notch?.reposition() }
            .onChange(of: panelHeight) { _, _ in notch?.reposition() }

            Section {
                Picker("Open from the top edge", selection: $edgeTrigger) {
                    Text("Off").tag("off")
                    Text("Near the notch").tag("wide")
                    Text("Anywhere along the top").tag("edge")
                }
                .onChange(of: edgeTrigger) { _, _ in notch?.applyEdgeTrigger() }
            } header: {
                proHeader("Edge trigger zones", .edgeTrigger)
            } footer: {
                Text("Push the pointer against the top of the screen to open the notch, without aiming for it. Menu bar clicks still work.")
            }
            .disabled(!entitlements.canUse(.edgeTrigger))

            DisplayTabsSection()
            GestureSection()

            Section {
                Toggle("Sound when the notch opens and closes", isOn: $sounds)
                Toggle("Trackpad haptics", isOn: $haptics)
            } header: {
                Text("Feedback")
            } footer: {
                Text("Both are off by default. Haptics need a Force Touch trackpad.")
            }
        }
        .formStyle(.grouped)
    }

    private func proHeader(_ title: String, _ feature: Feature) -> some View {
        HStack(spacing: 6) {
            Text(title)
            if !entitlements.canUse(feature) { TierBadge(tier: feature.tier).help(feature.benefit) }
        }
    }

    /// Opens the notch while a size slider is dragged, so the change is visible.
    private func preview(_ editing: Bool) {
        if editing { notch?.expand() }
    }
}

/// Tabs per display (Pro): untick a tab to hide it on that display only.
private struct DisplayTabsSection: View {
    @EnvironmentObject private var settings: SettingsManager
    @ObservedObject private var entitlements = Entitlements.shared
    @State private var screenIndex = 0
    @State private var refresh = 0

    var body: some View {
        let screens = NSScreen.screens
        let screen = screens.indices.contains(screenIndex) ? screens[screenIndex] : screens.first
        Section {
            Picker("Show the notch on", selection: $settings.notchDisplayMode) {
                Text("Built-in display").tag("builtin")
                Text("The display with the pointer").tag("pointer")
                Text("Main display (menu bar)").tag("main")
            }
            .onChange(of: settings.notchDisplayMode) { _, _ in AppDelegate.current?.notch?.applyDisplayMode() }
            if let screen {
                if screens.count > 1 {
                    Picker("Tabs on", selection: $screenIndex) {
                        ForEach(screens.indices, id: \.self) { i in Text(screens[i].localizedName).tag(i) }
                    }
                }
                let hidden = DisplayLayouts.hidden(on: screen)
                ForEach(settings.enabledTabs) { module in
                    Toggle(module.title, isOn: Binding(
                        get: { !hidden.contains(module.rawValue) },
                        set: { show in
                            var h = DisplayLayouts.hidden(on: screen)
                            if show { h.remove(module.rawValue) } else { h.insert(module.rawValue) }
                            DisplayLayouts.setHidden(h, on: screen)
                            refresh += 1
                            AppDelegate.current?.notch?.reposition()
                        }))
                    .disabled(!entitlements.canUse(.displayLayouts))
                }
                .id(refresh)
            }
        } header: {
            HStack(spacing: 6) {
                Text("Displays")
                if !entitlements.canUse(.displayLayouts) { TierBadge(tier: .pro).help(Feature.displayLayouts.benefit) }
            }
        } footer: {
            Text("Displays without a notch get a virtual one in the middle of the menu bar. With Pro, choose which tabs appear on each display.")
        }
    }
}

/// Remappable gestures (Pro). Without Pro the defaults are shown and used.
private struct GestureSection: View {
    @EnvironmentObject private var settings: SettingsManager
    @ObservedObject private var entitlements = Entitlements.shared
    @State private var refresh = 0

    var body: some View {
        Section {
            Toggle("Gestures on the closed notch", isOn: $settings.notchGestures)
            ForEach(NotchGesture.allCases) { g in
                Picker(g.title, selection: Binding(
                    get: { entitlements.canUse(.gestureRemap) ? g.storedAction() : g.defaultAction },
                    set: { g.set($0); refresh += 1 })) {
                    ForEach(g.choices) { Text($0.title).tag($0) }
                }
                .disabled(!entitlements.canUse(.gestureRemap))
            }
            .id(refresh)
        } header: {
            HStack(spacing: 6) {
                Text("Gestures")
                if !entitlements.canUse(.gestureRemap) { TierBadge(tier: .pro).help(Feature.gestureRemap.benefit) }
            }
        } footer: {
            Text("Defaults: scroll for volume, swipe for tracks, long-press for quick actions, swipe on the tab bar to change tabs, swipe up to close.")
        }
    }
}
