//
//  HomeScreenView.swift
//  Notch apple
//
//  The Home page, the first tab. It replaces the old Today page.
//
//   • A glance row: the date, weather, your next event and battery, with screenshot and record buttons.
//   • Small cards that are always there: Devices, Notifications, Quick Add (and Claude usage if you add it).
//   • Accordions that stay closed until you click them: Clipboard, Now Playing, Quick Notes.
//
//  Settings → Modules & Layout (and the chooser after an update) decide what appears here; a feature moved
//  to its own tab or to Non-Necessities leaves this page.
//

import SwiftUI

struct HomeScreenView: View {
    @StateObject private var model = TodayModel.shared
    @StateObject private var location = LocationProvider.shared
    @StateObject private var rain = RainWatcher.shared
    @ObservedObject private var layout = ModuleLayout.shared
    @EnvironmentObject private var state: NotchState
    @State private var open: Set<Module> = []
    @State private var seeded = false

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                glance
                let widgets = layout.homeWidgets.filter(\.expanded).map(\.module)
                if !widgets.isEmpty {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                        ForEach(widgets) { m in
                            GlassCard { HomeWidgetCard(module: m) }
                                .frame(height: m == .alerts ? 150 : 124)
                        }
                    }
                }
                // Accordions: the three that start closed, plus any card the person chose to keep closed.
                ForEach(accordionItems, id: \.module) { item in
                    accordion(item.module)
                }
            }
            .padding(.bottom, 4)
        }
        .scrollIndicators(.hidden)
        .onAppear {
            model.refresh()
            if SettingsManager.shared.rainAlert && Entitlements.shared.canUse(.rainAlert) { rain.checkIfDue() }
            if location.useCurrentLocation && location.status == .notDetermined { location.requestLocation() }
            if !seeded {
                seeded = true
                open = Set((layout.homeAccordions + layout.homeWidgets).filter(\.expanded).map(\.module))
            }
        }
    }

    private var accordionItems: [(module: Module, expanded: Bool)] {
        let all = layout.homeAccordions + layout.homeWidgets.filter { !$0.expanded }
        return all
    }

    // MARK: Glance

    private var glance: some View {
        GlassCard {
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(Date.now.formatted(.dateTime.weekday(.wide))).sectionTitle()
                    Text(Date.now.formatted(.dateTime.day().month(.wide)))
                        .font(.system(size: 22, weight: .bold, design: .rounded)).foregroundStyle(.white)
                }
                Divider().frame(height: 34).overlay(Theme.separator)
                if let w = model.weather {
                    HStack(spacing: 6) {
                        Image(systemName: w.symbol).symbolRenderingMode(.multicolor).font(.system(size: 22))
                        VStack(alignment: .leading, spacing: 0) {
                            Text("\(Int(w.temperature.rounded()))°").font(.system(size: 18, weight: .semibold, design: .rounded)).foregroundStyle(.white)
                            Text(w.location).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                        }
                        ForecastButton()
                    }
                } else if location.useCurrentLocation && location.status == .notDetermined {
                    Button { location.requestLocation() } label: { Label("Use my location", systemImage: "location.fill") }
                        .buttonStyle(PurpleButtonStyle(prominent: false))
                } else {
                    Label("Loading weather…", systemImage: "cloud").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
                Divider().frame(height: 34).overlay(Theme.separator)
                nextEvent
                Spacer(minLength: 0)
                ScreenCaptureButtons()
                if let b = model.battery {
                    Label("\(b.percent)%", systemImage: b.charging ? "battery.100percent.bolt" : LiveActivityCenter.batterySymbol(b.percent))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(b.percent <= 20 && !b.pluggedIn ? .red : Theme.textSecondary)
                        .help(b.charging ? "Charging" : b.pluggedIn ? "Plugged in" : "Battery")
                }
            }
        }
    }

    @ViewBuilder private var nextEvent: some View {
        switch model.calendarAccess {
        case .fullAccess:
            if let e = model.events.first {
                HStack(spacing: 8) {
                    Capsule().fill(e.color).frame(width: 4, height: 30)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(e.title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                        Text(eventTime(e)).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                    }
                    if let url = e.joinURL, e.end > .now {
                        Button("Join") { NSWorkspace.shared.open(url); AppDelegate.current?.notch?.closeNotch() }.buttonStyle(PurpleButtonStyle())
                    }
                }
                .frame(maxWidth: 230, alignment: .leading)
            } else {
                Text("Nothing else on your calendar").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
        case .notDetermined:
            Button("Allow calendar access", action: model.requestCalendarAccess).buttonStyle(PurpleButtonStyle(prominent: false))
        default:
            Text("Calendar is off in Privacy settings").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
        }
    }

    private func eventTime(_ e: TodayModel.Event) -> String {
        let day = Calendar.current.isDateInToday(e.start) ? "Today" : "Tomorrow"
        return e.isAllDay ? "\(day) · All day" : "\(day) · \(e.start.formatted(date: .omitted, time: .shortened))"
    }

    // MARK: Accordions

    private func accordion(_ m: Module) -> some View {
        let isOpen = open.contains(m)
        return VStack(spacing: 0) {
            Button {
                withAnimation(.snappy(duration: 0.25)) { if isOpen { open.remove(m) } else { open.insert(m) } }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: m.symbol).frame(width: 20).foregroundStyle(Theme.accentBright)
                    Text(m == .notes ? "Quick Notes" : m.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.textSecondary)
                        .rotationEffect(.degrees(isOpen ? 90 : 0))
                }
                .padding(.horizontal, 12).frame(height: 38).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if isOpen {
                Divider().overlay(Theme.separator)
                ModuleContentView(module: m).id(m)
                    .frame(height: 250).padding(10).clipped()
                    .transition(.opacity)
            }
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }
}

/// The card for a module that lives on Home: a small live summary, never the whole tab.
struct HomeWidgetCard: View {
    let module: Module
    @EnvironmentObject private var state: NotchState
    @ObservedObject private var entitlements = Entitlements.shared

    var body: some View {
        if let f = module.feature, !entitlements.canUse(f) {
            VStack(alignment: .leading, spacing: 6) {
                Text(module.title).sectionTitle()
                Label("Pro feature", systemImage: "lock.fill").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                Button("See what it does") { state.selected = module }.buttonStyle(PurpleButtonStyle(prominent: false))
            }
        } else {
            switch module {
            case .devices: DevicesCard()
            case .alerts: NotificationsCard()
            case .quickAdd: QuickAddCard()
            case .claudeUsage: ClaudePaceCard()
            default: EmptyView()
            }
        }
    }
}

private struct DevicesCard: View {
    @StateObject private var battery = DeviceBatteryModel.shared
    @StateObject private var privacy = PrivacyMonitor.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Devices").sectionTitle()
            let list = battery.devices.prefix(3)
            if list.isEmpty {
                Text(battery.loading ? "Looking…" : "No accessories reporting battery.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            ForEach(Array(list)) { d in
                HStack(spacing: 6) {
                    Image(systemName: d.symbol).frame(width: 16).foregroundStyle(Theme.accentBright)
                    Text(d.name + (d.part.map { " \($0)" } ?? "")).font(.system(size: 11)).foregroundStyle(.white).lineLimit(1)
                    Spacer()
                    Text("\(d.percent)%").font(.system(size: 11, weight: .semibold)).monospacedDigit()
                        .foregroundStyle(d.percent <= 15 ? .red : Theme.textSecondary)
                }
            }
            Spacer(minLength: 0)
            HStack(spacing: 10) {
                Label(privacy.micInUse ? "Mic in use" : "Mic idle", systemImage: privacy.micInUse ? "mic.fill" : "mic")
                    .foregroundStyle(privacy.micInUse ? .orange : Theme.textSecondary)
                Label(privacy.cameraInUse ? "Camera on" : "Camera off", systemImage: privacy.cameraInUse ? "video.fill" : "video.slash")
                    .foregroundStyle(privacy.cameraInUse ? .green : Theme.textSecondary)
            }
            .font(.system(size: 10))
        }
        .onAppear { battery.refreshIfDue(every: 120) }
    }
}

private struct NotificationsCard: View {
    @StateObject private var mirror = NotificationMirror.shared
    /// Reading other apps' notifications is opt-in, as it always was: the card waits until it is switched on.
    @AppStorage(Module.alerts.storageKey) private var on = false

    var body: some View {
        if !on {
            VStack(alignment: .leading, spacing: 6) {
                Text("Notifications").sectionTitle()
                Text("See notifications from other apps here. Needs Full Disk Access; it only reads them, on this Mac.")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                Button("Turn on") { on = true }.buttonStyle(PurpleButtonStyle(prominent: false))
                Spacer(minLength: 0)
            }
        } else {
            list
        }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text("Notifications").sectionTitle()
                Spacer()
                if mirror.unseen > 0 { Text("\(mirror.unseen)").font(.system(size: 10, weight: .bold)).padding(.horizontal, 6).background(Theme.accent, in: Capsule()) }
            }
            if !mirror.hasAccess {
                Text("Needs Full Disk Access to read them.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                Button("Allow…") { PermissionsModel.openPrivacy("Privacy_AllFiles") }.buttonStyle(PurpleButtonStyle(prominent: false))
            } else if mirror.items.isEmpty {
                Text("No notifications yet.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            } else {
                ForEach(mirror.items.prefix(3)) { item in
                    Button { mirror.open(item) } label: {
                        HStack(spacing: 6) {
                            Text(item.appName).font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.accentBright).frame(width: 62, alignment: .leading).lineLimit(1)
                            Text(item.title.isEmpty ? item.body : item.title).font(.system(size: 11)).foregroundStyle(.white).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            Spacer(minLength: 0)
        }
        .onAppear { mirror.setRunning(true) }
    }
}

private struct QuickAddCard: View {
    @StateObject private var model = QuickAddModel.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Quick add").sectionTitle()
            HStack(spacing: 6) {
                TextField("Dentist tomorrow 3pm", text: $model.text)
                    .textFieldStyle(.plain).font(.system(size: 12)).foregroundStyle(.white)
                    .onSubmit(model.add)
                Button("Add", action: model.add).buttonStyle(PurpleButtonStyle()).disabled(model.parsed == nil)
            }
            .padding(8).background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
            if let p = model.parsed {
                Text("\(p.kind.rawValue): \(p.title)\(p.date.map { " · " + $0.formatted(date: .abbreviated, time: p.hasTime ? .shortened : .omitted) } ?? "")")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            } else if let m = model.message {
                Text(m).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(2)
            } else {
                Text("An event or a reminder, in plain words.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 0)
        }
    }
}

/// Screenshot and screen recording, from the glance row.
struct ScreenCaptureButtons: View {
    @StateObject private var capture = ScreenCaptureActions.shared
    @StateObject private var recorder = ScreenRecorder.shared

    var body: some View {
        HStack(spacing: 6) {
            IconButton(systemImage: "camera.viewfinder", help: "Take a screenshot of the main display, without the notch") { capture.takeScreenshot() }
            if recorder.isRecording {
                IconButton(systemImage: recorder.isPaused ? "play.fill" : "pause.fill", help: recorder.isPaused ? "Resume recording" : "Pause recording") { recorder.togglePause() }
                Button { recorder.stop() } label: {
                    Label { Text(CountdownTimer.long(recorder.elapsed)).monospacedDigit() } icon: { Image(systemName: "stop.circle.fill") }
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(PurpleButtonStyle())
                .help("Stop recording")
            } else {
                IconButton(systemImage: "record.circle", help: "Record the screen (the notch is left out). You can pause, and trim when you stop.") { recorder.start() }
            }
        }
    }
}
