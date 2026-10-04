//
//  HomeView.swift
//  Notch apple
//
//  Home (Pro): your own dashboard in the notch. Add widgets, pick a size for
//  each (small = one column, medium = two, large = the full width) and put them
//  in any order. Plugin widgets (Ultimate) show your plugins' output.
//  Everything is read on this Mac from the features that already exist.
//

import SwiftUI

struct HomeWidget: Codable, Identifiable, Equatable {
    enum Kind: String, Codable, CaseIterable, Identifiable {
        case clock, weather, battery, nextEvent, nowPlaying, timer, todos, markets, plugin
        var id: String { rawValue }
        var title: String {
            switch self {
            case .clock: "Clock"
            case .weather: "Weather"
            case .battery: "Battery"
            case .nextEvent: "Next event"
            case .nowPlaying: "Now Playing"
            case .timer: "Timer"
            case .todos: "To-do"
            case .markets: "Markets"
            case .plugin: "Plugin"
            }
        }
        var symbol: String {
            switch self {
            case .clock: "clock"
            case .weather: "cloud.sun"
            case .battery: "battery.75percent"
            case .nextEvent: "calendar"
            case .nowPlaying: "music.note"
            case .timer: "timer"
            case .todos: "checklist"
            case .markets: "chart.line.uptrend.xyaxis"
            case .plugin: "puzzlepiece.extension"
            }
        }
    }
    enum Size: Int, Codable, CaseIterable { case small = 1, medium = 2, large = 4
        var title: String { self == .small ? "Small" : self == .medium ? "Medium" : "Large" }
    }

    var id = UUID()
    var kind: Kind
    var size: Size
    /// For plugin widgets: the plugin's file name.
    var plugin: String? = nil
}

@MainActor
final class HomeLayout: ObservableObject {
    static let shared = HomeLayout()
    @Published var widgets: [HomeWidget] { didSet { UserDefaults.standard.set(try? JSONEncoder().encode(widgets), forKey: "home.widgets") } }
    @Published var editing = false

    private init() {
        widgets = UserDefaults.standard.data(forKey: "home.widgets").flatMap { try? JSONDecoder().decode([HomeWidget].self, from: $0) } ?? [
            HomeWidget(kind: .clock, size: .small), HomeWidget(kind: .weather, size: .small), HomeWidget(kind: .battery, size: .small),
            HomeWidget(kind: .timer, size: .small), HomeWidget(kind: .nextEvent, size: .medium), HomeWidget(kind: .nowPlaying, size: .medium),
            HomeWidget(kind: .todos, size: .large),
        ]
    }

    /// Drag-and-drop: puts the dragged widget where the target is.
    func move(id: UUID, before target: UUID) {
        guard id != target, let from = widgets.firstIndex(where: { $0.id == id }) else { return }
        let item = widgets.remove(at: from)
        let to = widgets.firstIndex(where: { $0.id == target }) ?? widgets.count
        widgets.insert(item, at: to)
    }

    func move(_ w: HomeWidget, by step: Int) {
        guard let i = widgets.firstIndex(of: w), widgets.indices.contains(i + step) else { return }
        widgets.swapAt(i, i + step)
    }
}

struct HomeView: View {
    @StateObject private var layout = HomeLayout.shared
    @ObservedObject private var entitlements = Entitlements.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Home").sectionTitle()
                Spacer()
                if layout.editing {
                    Menu {
                        ForEach(HomeWidget.Kind.allCases.filter { $0 != .plugin }) { k in
                            Button { layout.widgets.append(HomeWidget(kind: k, size: .small)) } label: { Label(k.title, systemImage: k.symbol) }
                        }
                        if entitlements.canUse(.pluginSDK) {
                            Section("Plugins") {
                                ForEach(PluginHost.shared.plugins) { p in
                                    Button(p.name) { layout.widgets.append(HomeWidget(kind: .plugin, size: .medium, plugin: p.url.lastPathComponent)) }
                                }
                            }
                        }
                    } label: { Label("Add widget", systemImage: "plus") }
                    .menuStyle(.borderlessButton).fixedSize()
                }
                if layout.editing { Text("Drag to reorder").font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
                Button(layout.editing ? "Done" : "Edit") { withAnimation(Theme.spring) { layout.editing.toggle() } }
                    .buttonStyle(PurpleButtonStyle(prominent: layout.editing))
            }
            ScrollView {
                // A four-column grid: small = 1, medium = 2, large = 4 columns.
                FlowGrid(widgets: layout.widgets) { w in
                    WidgetCard(widget: w, editing: layout.editing)
                        // Edit mode: drag a widget onto another to move it there.
                        .onDrag { layout.editing ? NSItemProvider(object: w.id.uuidString as NSString) : NSItemProvider() }
                        .onDrop(of: [.text], isTargeted: nil) { providers in
                            guard layout.editing, let p = providers.first else { return false }
                            _ = p.loadObject(ofClass: NSString.self) { obj, _ in
                                guard let s = obj as? String, let id = UUID(uuidString: s) else { return }
                                DispatchQueue.main.async { withAnimation(Theme.spring) { layout.move(id: id, before: w.id) } }
                            }
                            return true
                        }
                }
            }
        }
        .onAppear { PluginHost.shared.start(); TodayModel.shared.refresh() }
    }
}

/// Lays widgets out in rows of four columns.
private struct FlowGrid<Cell: View>: View {
    let widgets: [HomeWidget]
    @ViewBuilder let cell: (HomeWidget) -> Cell

    var body: some View {
        let rows = Self.rows(widgets)
        GeometryReader { g in
            let unit = (g.size.width - 3 * 8) / 4
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack(spacing: 8) {
                        ForEach(row) { w in
                            cell(w).frame(width: unit * CGFloat(w.size.rawValue) + 8 * CGFloat(w.size.rawValue - 1), height: 96)
                        }
                    }
                }
            }
        }
        .frame(height: CGFloat(rows.count) * 104)
    }

    static func rows(_ widgets: [HomeWidget]) -> [[HomeWidget]] {
        var rows: [[HomeWidget]] = [], current: [HomeWidget] = [], used = 0
        for w in widgets {
            if used + w.size.rawValue > 4 { rows.append(current); current = []; used = 0 }
            current.append(w); used += w.size.rawValue
        }
        if !current.isEmpty { rows.append(current) }
        return rows
    }
}

private struct WidgetCard: View {
    let widget: HomeWidget
    let editing: Bool
    @ObservedObject private var layout = HomeLayout.shared
    @ObservedObject private var today = TodayModel.shared
    @ObservedObject private var music = NowPlayingMonitor.shared
    @ObservedObject private var timer = CountdownTimer.shared
    @ObservedObject private var todos = TodoStore.shared
    @ObservedObject private var markets = MarketsModel.shared
    @ObservedObject private var plugins = PluginHost.shared

    var body: some View {
        ZStack(alignment: .topTrailing) {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(10)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            if editing {
                HStack(spacing: 2) {
                    Menu {
                        ForEach(HomeWidget.Size.allCases, id: \.self) { s in
                            Button(s.title) { if let i = layout.widgets.firstIndex(of: widget) { layout.widgets[i].size = s } }
                        }
                    } label: { Image(systemName: "arrow.up.left.and.arrow.down.right") }
                    .menuStyle(.borderlessButton).fixedSize()
                    Button { layout.move(widget, by: -1) } label: { Image(systemName: "chevron.left") }
                    Button { layout.move(widget, by: 1) } label: { Image(systemName: "chevron.right") }
                    Button {
                        let before = layout.widgets
                        layout.widgets.removeAll { $0.id == widget.id }
                        UndoCenter.shared.offer("Widget removed") { layout.widgets = before }
                    } label: { Image(systemName: "minus.circle.fill").foregroundStyle(.red) }
                }
                .buttonStyle(.plain).font(.system(size: 11)).padding(4)
                .background(.black.opacity(0.5), in: Capsule()).padding(4)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var content: some View {
        switch widget.kind {
        case .clock:
            VStack(alignment: .leading, spacing: 2) {
                TimelineView(.periodic(from: .now, by: 30)) { _ in
                    Text(Date.now.formatted(date: .omitted, time: .shortened)).font(.system(size: 26, weight: .bold, design: .rounded)).foregroundStyle(.white)
                }
                Text(Date.now.formatted(.dateTime.weekday(.wide).day().month())).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
        case .weather:
            if let w = today.weather {
                VStack(alignment: .leading, spacing: 2) {
                    Label("\(Int(w.temperature.rounded()))°", systemImage: w.symbol).font(.system(size: 24, weight: .bold)).foregroundStyle(.white)
                    Text(widget.size == .small ? w.location : "\(w.summary) · \(w.location)").font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                }
            } else { placeholder("Weather", "Allow Location in Permissions") }
        case .battery:
            if let b = today.battery {
                VStack(alignment: .leading, spacing: 2) {
                    Label("\(b.percent)%", systemImage: b.charging ? "battery.100percent.bolt" : LiveActivityCenter.batterySymbol(b.percent))
                        .font(.system(size: 24, weight: .bold)).foregroundStyle(b.percent <= 20 && !b.pluggedIn ? .orange : .white)
                    Text(b.charging ? "Charging" : b.pluggedIn ? "Plugged in" : "On battery").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
            } else { placeholder("Battery", "No battery") }
        case .nextEvent:
            if let e = today.events.first(where: { $0.end > .now }) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(e.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white).lineLimit(2)
                    Text(e.isAllDay ? "All day" : e.start > .now ? "in \(e.start.formatted(.relative(presentation: .numeric)).replacingOccurrences(of: "in ", with: ""))" : "Now, until \(e.end.formatted(date: .omitted, time: .shortened))")
                        .font(.system(size: 11)).foregroundStyle(Theme.accentBright)
                }
            } else { placeholder("Next event", today.calendarAccess == .fullAccess ? "Nothing else today" : "Allow Calendar in Permissions") }
        case .nowPlaying:
            if let t = music.current, !t.title.isEmpty {
                HStack(spacing: 8) {
                    if let art = music.artwork { Image(nsImage: art).resizable().frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: 8)) }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(t.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                        Text(t.artist).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                        Button { MediaControl.send(.playPause) } label: { Image(systemName: t.isPlaying ? "pause.fill" : "play.fill") }.buttonStyle(.plain).foregroundStyle(.white)
                    }
                }
            } else { placeholder("Now Playing", "Nothing playing") }
        case .timer:
            VStack(alignment: .leading, spacing: 4) {
                Text(timer.timerRunning ? FocusTimer.format(timer.remaining) : "Timer").font(.system(size: 22, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(.white)
                HStack(spacing: 6) {
                    ForEach([5, 15, 25], id: \.self) { m in
                        Button("\(m)m") { timer.startTimer(seconds: Double(m * 60)) }.buttonStyle(.plain)
                            .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.accentBright)
                    }
                }
            }
        case .todos:
            let open = todos.items.filter { !$0.done }
            VStack(alignment: .leading, spacing: 3) {
                Text("\(open.count) to do").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                ForEach(open.prefix(widget.size == .large ? 3 : 2)) { t in
                    Button { todos.toggle(t) } label: { Label(t.text, systemImage: "circle").lineLimit(1) }
                        .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
            }
        case .markets:
            VStack(alignment: .leading, spacing: 2) {
                ForEach(markets.symbols.prefix(widget.size == .small ? 2 : 4), id: \.self) { s in
                    if let q = markets.quotes[s] {
                        Text("\(s) \(MarketsModel.short(q.price)) \(q.change >= 0 ? "▲" : "▼")\(String(format: "%.1f", abs(q.change)))%")
                            .font(.system(size: 11, weight: .semibold)).monospacedDigit().foregroundStyle(q.change >= 0 ? .green : .red)
                    } else { Text(s).font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
                }
            }
            .onAppear { markets.refreshIfDue(force: true) }
        case .plugin:
            if Entitlements.shared.canUse(.pluginSDK), let p = plugins.plugins.first(where: { $0.url.lastPathComponent == widget.plugin }) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.headline).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white).lineLimit(2)
                    ForEach(p.lines.prefix(widget.size == .small ? 2 : 4)) { l in
                        Text(l.text).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                    }
                }
            } else { placeholder("Plugin", widget.plugin ?? "Ultimate") }
        }
    }

    private func placeholder(_ title: String, _ note: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(title, systemImage: widget.kind.symbol).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
            Text(note).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
        }
    }
}
