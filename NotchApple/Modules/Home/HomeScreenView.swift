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
                if editing { editBar }
                todayCard
                ForEach(rows, id: \.self) { row in
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(row, id: \.self) { name in
                            if let m = Module(rawValue: name) { homeItem(m) }
                        }
                        if row.count == 1, let m = Module(rawValue: row[0]), !isFull(m) { Color.clear.frame(maxWidth: .infinity) }
                    }
                }
            }
            .padding(.bottom, 4)
        }
        .scrollIndicators(.hidden)
        .onAppear {
            model.refresh()
            if SettingsManager.shared.rainAlert && Entitlements.shared.canUse(.rainAlert) { rain.checkIfDue() }
            if location.useCurrentLocation && location.status == .notDetermined { location.requestLocation() }
            seeded = true
        }
    }

    // MARK: Editing Home from the notch

    @State private var editing = false

    private var rows: [[String]] {
        ModuleLayoutLogic.packRows(layout.homeItems.map { (name: $0.rawValue, size: layout.size($0), closed: layout.choice($0) == .homeHidden) })
    }

    private func isFull(_ m: Module) -> Bool { layout.choice(m) == .homeHidden || layout.size(m).fullWidth }

    @ViewBuilder private func homeItem(_ m: Module) -> some View {
        VStack(spacing: 4) {
            if editing { editControls(m) }
            if layout.choice(m) == .homeHidden {
                accordion(m)
            } else {
                GlassCard { m == .todo ? AnyView(TodoView()) : AnyView(HomeWidgetCard(module: m)) }
                    .frame(height: layout.size(m).height)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func editControls(_ m: Module) -> some View {
        HStack(spacing: 6) {
            IconButton(systemImage: "chevron.up", help: "Move up") { withAnimation(Theme.spring) { layout.moveHome(m, by: -1) } }
            IconButton(systemImage: "chevron.down", help: "Move down") { withAnimation(Theme.spring) { layout.moveHome(m, by: 1) } }
            Picker("", selection: Binding(get: { layout.size(m) }, set: { layout.setSize($0, for: m) })) {
                ForEach(ModuleLayoutLogic.WidgetSize.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented).labelsHidden().controlSize(.mini).frame(width: 130)
            .disabled(layout.choice(m) == .homeHidden)
            Spacer(minLength: 0)
            IconButton(systemImage: layout.choice(m) == .homeHidden ? "rectangle.expand.vertical" : "rectangle.compress.vertical",
                       help: layout.choice(m) == .homeHidden ? "Show the card" : "Collapse to a row") {
                withAnimation(Theme.spring) { layout.setHomeClosed(layout.choice(m) != .homeHidden, for: m) }
            }
            IconButton(systemImage: "xmark.circle.fill", help: "Remove from Home (it moves to its own tab)") {
                withAnimation(Theme.spring) { layout.removeFromHome(m) }
            }
        }
        .padding(.horizontal, 6)
    }

    private var editBar: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Editing Home").sectionTitle()
                    Spacer()
                    Button("Done") { withAnimation(Theme.spring) { editing = false } }.buttonStyle(PurpleButtonStyle())
                }
                if layout.addableToHome.isEmpty {
                    Text("Everything that can live on Home is already here.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                } else {
                    Text("Add to Home").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    HStack(spacing: 6) {
                        ForEach(layout.addableToHome) { m in
                            Button { withAnimation(Theme.spring) { layout.addToHome(m) } } label: { Label(m.title, systemImage: m.symbol) }
                                .buttonStyle(PurpleButtonStyle(prominent: false))
                        }
                    }
                }
            }
        }
    }

    // MARK: Today: your calendar, the one thing, countdowns and pinned notes

    private var todayCard: some View {
        GlassCard {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Up next").sectionTitle()
                    switch model.calendarAccess {
                    case .fullAccess:
                        if model.events.isEmpty {
                            Text("Nothing else on your calendar today or tomorrow.").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                        }
                        ForEach(model.events.prefix(4)) { event in eventRow(event) }
                    case .notDetermined:
                        Text("See your next events here.").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                        Button("Allow calendar access", action: model.requestCalendarAccess).buttonStyle(PurpleButtonStyle())
                    default:
                        Text("Calendar access is off. Turn it on in System Settings → Privacy & Security → Calendars.")
                            .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Today").sectionTitle()
                    OneThingToday()
                    CountdownsList()
                    PinnedNotesToday()
                }
                .frame(width: 250, alignment: .topLeading)
            }
        }
    }

    private func eventRow(_ event: TodayModel.Event) -> some View {
        HStack(spacing: 8) {
            Capsule().fill(event.color).frame(width: 4, height: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(event.title).font(.system(size: 12, weight: .medium)).foregroundStyle(.white).lineLimit(1)
                Text(eventTime(event)).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 4)
            if let url = event.joinURL, event.end > .now, event.start.timeIntervalSinceNow < 900 {
                Button("Join") { NSWorkspace.shared.open(url); AppDelegate.current?.notch?.closeNotch() }.buttonStyle(PurpleButtonStyle())
            } else if let url = event.joinURL {
                IconButton(systemImage: "video.fill", help: "Join the video call") { NSWorkspace.shared.open(url); AppDelegate.current?.notch?.closeNotch() }
            }
            if Entitlements.shared.canUse(.meetingSummaries), !event.isAllDay {
                IconButton(systemImage: "record.circle", help: "Record this meeting and summarise it") {
                    VoiceNotesModel.shared.startMeeting(title: event.title)
                    state.selected = .voiceNotes
                }
            }
            if Entitlements.shared.canUse(.meetingNotes), !event.isAllDay {
                IconButton(systemImage: "note.text.badge.plus", help: "Start notes for this meeting") { startNotes(for: event) }
            }
            if event.start <= .now && event.end > .now {
                Text("Now").font(.system(size: 10, weight: .bold)).padding(.horizontal, 6).padding(.vertical, 2).background(Theme.accent.opacity(0.4), in: Capsule())
            }
        }
    }

    /// Opens the note for this meeting (making it on first use) in the Notes tab.
    private func startNotes(for e: TodayModel.Event) {
        let day = e.start.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
        let time = "\(e.start.formatted(date: .omitted, time: .shortened)) – \(e.end.formatted(date: .omitted, time: .shortened))"
        NotesStore.shared.noteForMeeting(title: e.title, day: day, time: time)
        UserDefaults.standard.set("notes", forKey: "notes.page")
        state.selected = .notes
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
                Spacer(minLength: 0)
                ScreenCaptureButtons()
                IconButton(systemImage: editing ? "checkmark.circle.fill" : "slider.horizontal.3",
                           help: editing ? "Done editing" : "Edit Home: move, resize, add or remove widgets") {
                    withAnimation(Theme.spring) { editing.toggle() }
                }
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
            case .todo: TodoView()
            case .devices: DevicesCard()
            case .alerts: NotificationsCard()
            case .clipboard: ClipboardCard()
            case .nowPlaying: NowPlayingCard()
            case .notes: NotesCard()
            case .claudeUsage: PremiumRegistry.claudePace?() ?? AnyView(EmptyView())
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

private struct ClipboardCard: View {
    @StateObject private var history = ClipboardHistory.shared
    @State private var copied: UUID?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("Clipboard").sectionTitle()
            let recent = Array(history.items.prefix(4))
            if recent.isEmpty {
                Text("Things you copy show up here.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            ForEach(recent) { item in
                Button {
                    history.copy(item)
                    copied = item.id
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { if copied == item.id { copied = nil } }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: item.kind == .image ? "photo" : item.kind == .files ? "doc" : item.kind == .link ? "link" : "text.alignleft")
                            .font(.system(size: 10)).frame(width: 14).foregroundStyle(Theme.accentBright)
                        Text(copied == item.id ? "Copied" : item.title).font(.system(size: 11)).foregroundStyle(copied == item.id ? Color.green : .white).lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 6).frame(height: 22)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain).help("Copy it again")
            }
            Spacer(minLength: 0)
        }
    }
}

private struct NowPlayingCard: View {
    @StateObject private var monitor = NowPlayingMonitor.shared
    @AppStorage("nowPlaying.cassette") private var cassette = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Now playing").sectionTitle()
                Spacer()
                Button { withAnimation(Theme.spring) { cassette.toggle() } } label: {
                    Image(systemName: cassette ? "rectangle.stack.fill" : "recordingtape").font(.system(size: 11))
                }
                .buttonStyle(.plain).foregroundStyle(Theme.accentBright)
                .help(cassette ? "Back to the normal player" : "Cassette mode")
                .accessibilityLabel(cassette ? "Switch to the normal player" : "Switch to cassette mode")
            }
            if cassette {
                CassetteView(monitor: monitor)
            } else {
            HStack(spacing: 10) {
                Group {
                    if let art = monitor.artwork { Image(nsImage: art).resizable().scaledToFill() }
                    else { Image(systemName: "music.note").font(.system(size: 18)).foregroundStyle(Theme.textSecondary) }
                }
                .frame(width: 52, height: 52).background(Theme.surface).clipShape(RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 1) {
                    Text(monitor.current?.title ?? "Nothing playing").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                    Text(monitor.current?.artist ?? "Press play to start your player").font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            Spacer(minLength: 0)
            HStack(spacing: 18) {
                Spacer()
                IconButton(systemImage: "backward.fill", help: "Previous") { MediaControl.send(.previous) }
                Button { monitor.playPause() } label: {
                    Image(systemName: monitor.current?.isPlaying == true ? "pause.circle.fill" : "play.circle.fill").font(.system(size: 28))
                }
                .buttonStyle(.plain).foregroundStyle(Theme.accentBright).help("Play or pause")
                IconButton(systemImage: "forward.fill", help: "Next") { MediaControl.send(.next) }
                Spacer()
            }
            }
        }
    }
}

private struct NotesCard: View {
    @StateObject private var store = NotesStore.shared
    @State private var draft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("Quick notes").sectionTitle()
            HStack(spacing: 6) {
                TextField("Jot something down…", text: $draft).textFieldStyle(.plain).font(.system(size: 11)).foregroundStyle(.white)
                    .onSubmit(save)
                Button("Save", action: save).buttonStyle(PurpleButtonStyle()).disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(6).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
            let recent = Array(store.notes.sorted { $0.updated > $1.updated }.prefix(3))
            ForEach(recent) { note in
                Text(note.title.isEmpty ? "New note" : note.title).font(.system(size: 11)).foregroundStyle(.white).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Spacer(minLength: 0)
        }
    }

    private func save() {
        let t = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        _ = store.add(t)
        draft = ""
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
