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
    @AppStorage("notch.keepInFullscreen") private var keepInFullscreen = true
    @AppStorage("notch.autoHideRecording") private var autoHideRecording = false
    @AppStorage("notch.panelWidth") private var panelWidth = 740.0
    @AppStorage("notch.panelHeight") private var panelHeight = 420.0
    @AppStorage("notch.edgeTrigger") private var edgeTrigger = "off"
    @AppStorage("notch.sounds") private var sounds = false
    @AppStorage("notch.haptics") private var haptics = false
    @AppStorage("ui.paletteHotkey") private var palette = true
    @AppStorage("notch.swipeDownOpens") private var swipeDownOpens = false
    @AppStorage("notch.peek") private var peek = true
    @AppStorage("focus.behavior") private var focusBehavior = "hush"
    @AppStorage("focus.active") private var focusOn = false
    @AppStorage("focus.profile") private var focusProfile = ""
    @AppStorage("updates.weekly") private var weeklyUpdates = false

    private var notch: NotchWindowController? { AppDelegate.current?.notch }

    var body: some View {
        Form {
            Section("Top bar") {
                TopBarSwitches()
            }
            Section {
                Toggle(isOn: $weeklyUpdates) {
                    Text("Update at most once a week")
                    Text("Off: you hear about every release. On: Notch apple asks about the newest update once a week instead of announcing each one. Required security updates still appear straight away. Also in Settings → Updates.")
                }
            } header: {
                Text("Updates")
            }
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
                Toggle(isOn: $swipeDownOpens) {
                    Text("Swipe down on the notch to open it")
                    Text("Two fingers down over the closed notch opens it, instead of changing the volume.")
                }
                Toggle(isOn: $peek) {
                    Text("Peek on hover")
                    Text("Resting the pointer on the closed notch shows a one-line glance (what's playing, your next event or the weather). Click to open.")
                }
                .disabled(settings.hoverToOpen)
                Toggle(isOn: $settings.stickyNotch) {
                    Text("Keep open when clicking elsewhere")
                    Text("Otherwise the notch closes when you click outside it or press Esc.")
                }
                HStack {
                    Toggle(isOn: $palette) {
                        Text("Command palette with \(HotkeyBinding.palette.label)")
                        Text("Search and run everything: tabs, timers, snippets, saved prompts, apps, Settings, or ask the AI.")
                    }
                    .disabled(!entitlements.canUse(.commandPalette))
                    .onChange(of: palette) { _, _ in AppDelegate.current?.reapplyHotkeys() }
                    if !entitlements.canUse(.commandPalette) { TierBadge(tier: .pro).help(Feature.commandPalette.benefit) }
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
                .disabled(keepInFullscreen)
                .onChange(of: autoHideFullscreen) { _, _ in notch?.recheckFullscreen(); notch?.updateAutoHide() }
                Toggle(isOn: $keepInFullscreen) {
                    Text("Keep the notch visible in full-screen apps")
                    Text("For Macs without a hardware notch (like the base M1), where the notch would otherwise disappear when an app goes full screen. Overrides “Hide in fullscreen apps”.")
                }
                .onChange(of: keepInFullscreen) { _, _ in notch?.reassertWindowLevels(); notch?.recheckFullscreen(); notch?.updateAutoHide() }
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

            Section {
                Picker("While a Focus is on", selection: $focusBehavior) {
                    Text("Carry on as usual").tag("nothing")
                    Text("Stay quiet (no alerts or flashes)").tag("hush")
                    Text("Hide the notch").tag("hide")
                }
                .onChange(of: focusBehavior) { _, _ in notch?.updateAutoHide() }
                LabeledContent("Focus is") { Text(focusOn ? "On\(focusProfile.isEmpty ? "" : " · \(focusProfile)")" : "Off").foregroundStyle(.secondary) }
                Button("Set it up in Shortcuts…") { NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Shortcuts.app")) }
                Button("Focus timer settings…") { SettingsRouter.shared.showFocus = true }
            } header: {
                Text("Focus")
            } footer: {
                Text("macOS doesn't tell apps about Focus, so let Shortcuts do it: Automation → New → Focus → your Focus → When turning on → Open URL notchapple://focus?on=1&profile=Work. Add another for turning off with notchapple://focus?on=0. With Pro, the profile with that name switches on too.")
            }

            DisplayTabsSection()
            GestureSection()
            HotCornersSection()

            Section {
                Toggle(isOn: $settings.useDuoAnimations) {
                    Text("Use iPhone Duo animations")
                    Text("The notch pops out and morphs like the Dynamic Island: the panel springs open, the highlight slides between tabs and pages scale into place. Off for the plain animations. Reduce Motion always wins.")
                }
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
            Toggle(isOn: Binding(get: { !settings.disableSwipeModuleSwitch }, set: { settings.disableSwipeModuleSwitch = !$0 })) {
                Text("Swipe on the tab bar switches tabs")
                Text("Off by default, so a two-finger swipe only scrolls through the tabs. Turn on to also change tab as you swipe.")
            }
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
            Text("Defaults: scroll for volume, swipe for tracks, long-press for quick actions, swipe up to close. A sideways swipe on the tab bar scrolls the tabs (it changes tab too only if you turn that on).")
        }
    }
}
