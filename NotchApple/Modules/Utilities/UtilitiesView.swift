//
//  UtilitiesView.swift
//  Notch Apple
//
//  The Utilities tab: Mac stats, Shelf, World clock, Purge, Convert and the app Launcher on one screen. Each panel shows
//  what is useful at a glance; tap its title to open the full module (with a back button). Shelf takes files dropped on it.
//  Purge and Convert are Ultimate: their panels open the real module, which says so when it is locked.
//

import SwiftUI
import UniformTypeIdentifiers

struct UtilitiesView: View {
    @State private var open: Module?

    var body: some View {
        if let open {
            VStack(alignment: .leading, spacing: 6) {
                Button { withAnimation(Theme.spring) { self.open = nil } } label: {
                    Label("Utilities", systemImage: "chevron.left").font(.system(size: 12, weight: .semibold))
                }
                .buttonStyle(MetalPlainStyle()).foregroundStyle(Theme.accentBright).hitTarget()
                ModuleContentView(module: open)
            }
        } else {
            let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)
            LazyVGrid(columns: columns, spacing: 8) {
                StatsPanel { show(.stats) }
                ShelfPanel { show(.shelf) }
                ClockPanel { show(.worldClock) }
                SimplePanel(title: "Purge", symbol: "internaldrive.fill", line: "Free up disk space", action: { show(.cacheCleaner) })
                SimplePanel(title: "Convert", symbol: "arrow.triangle.2.circlepath", line: "Images, video, audio, documents", action: { show(.convert) })
                LauncherPanel { show(.launcher) }
            }
            .frame(maxHeight: .infinity, alignment: .top)
        }
    }

    private func show(_ m: Module) { withAnimation(Theme.spring) { open = m } }
}

/// One panel: a title row that opens the full module, and the panel's own content underneath.
private struct Panel<Content: View>: View {
    let title: String
    let symbol: String
    var targeted = false
    let open: () -> Void
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Button(action: open) {
                HStack(spacing: 5) {
                    Image(systemName: symbol).font(.system(size: 11, weight: .semibold))
                    Text(title).font(.system(size: 11, weight: .semibold))
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold))
                }
                .foregroundStyle(Theme.textSecondary)
                .frame(minHeight: 20).contentShape(Rectangle())
            }
            .buttonStyle(MetalPlainStyle())
            content.frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)
        }
        .padding(9)
        .frame(maxWidth: .infinity, minHeight: 92, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(targeted ? Theme.surfaceHover : Theme.surface))
        .animation(Theme.quick, value: targeted)
    }
}

private struct SimplePanel: View {
    let title: String
    let symbol: String
    let line: String
    let action: () -> Void
    var body: some View {
        Panel(title: title, symbol: symbol, open: action) {
            Text(line).font(.system(size: 12)).foregroundStyle(.white).lineLimit(2)
            Text("Open").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.accentBright)
        }
    }
}

// MARK: Mac stats

private struct StatsPanel: View {
    let open: () -> Void
    @StateObject private var monitor = SystemStatsMonitor()

    var body: some View {
        let s = monitor.stats
        Panel(title: "Mac stats", symbol: "cpu", open: open) {
            VStack(alignment: .leading, spacing: 4) {
                row("CPU", s.cpuPercent / 100, "\(Int(s.cpuPercent))%")
                row("Memory", s.ramFraction, "\(Int(s.ramFraction * 100))%")
                if let b = s.batteryPercent { row("Battery", Double(b) / 100, "\(b)%") }
            }
        }
        .onAppear { monitor.start() }
        .onDisappear { monitor.stop() }
    }

    private func row(_ name: String, _ fraction: Double, _ value: String) -> some View {
        HStack(spacing: 5) {
            Text(name).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).frame(width: 44, alignment: .leading)
            ProgressView(value: min(max(fraction, 0), 1)).progressViewStyle(.linear).tint(Theme.accentBright)
            Text(value).font(.system(size: 10, weight: .semibold).monospacedDigit()).foregroundStyle(.white).frame(width: 30, alignment: .trailing)
        }
    }
}

// MARK: Shelf

private struct ShelfPanel: View {
    let open: () -> Void
    @ObservedObject private var store = FileShelfStore.shared
    @State private var targeted = false

    var body: some View {
        Panel(title: "Shelf", symbol: "tray.fill", targeted: targeted, open: open) {
            if store.items.isEmpty {
                Text("Drop files here to hold them").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            } else {
                Text("\(store.items.count) item\(store.items.count == 1 ? "" : "s") held").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                Text(store.items.suffix(2).reversed().map(\.name).joined(separator: ", "))
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(2)
            }
        }
        .onDrop(of: [.fileURL], isTargeted: $targeted) { providers in
            for provider in providers {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    if let url { DispatchQueue.main.async { withAnimation(Theme.spring) { store.add(url) } } }
                }
            }
            return true
        }
    }
}

// MARK: World clock

private struct ClockPanel: View {
    let open: () -> Void
    @AppStorage("worldClock.zones") private var zonesData = "Europe/London\nAmerica/New_York\nAsia/Tokyo"

    private var zones: [String] {
        zonesData.split(separator: "\n").map(String.init).filter { TimeZone(identifier: WorldClockView.zoneID($0)) != nil }
    }

    var body: some View {
        Panel(title: "World clock", symbol: "clock.fill", open: open) {
            TimelineView(.periodic(from: .now, by: 15)) { context in
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(zones.prefix(4), id: \.self) { z in
                        HStack {
                            Text(WorldClockView.city(z)).font(.system(size: 11)).foregroundStyle(.white).lineLimit(1)
                            Spacer(minLength: 4)
                            if let tz = TimeZone(identifier: WorldClockView.zoneID(z)) {
                                Text(context.date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, timeZone: tz)))
                                    .font(.system(size: 11).monospacedDigit()).foregroundStyle(Theme.textSecondary)
                            }
                        }
                    }
                    if zones.isEmpty { Text("Add a city").font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
                }
            }
        }
    }
}

// MARK: Launcher

private struct LauncherPanel: View {
    let open: () -> Void
    @ObservedObject private var store = LauncherStore.shared

    var body: some View {
        Panel(title: "Launcher", symbol: "square.grid.2x2.fill", open: open) {
            if store.apps.isEmpty {
                Text("Add your apps to open them from here").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            } else {
                let columns = Array(repeating: GridItem(.fixed(24), spacing: 5), count: 4)
                LazyVGrid(columns: columns, spacing: 5) {
                    ForEach(store.apps.prefix(8)) { app in
                        Button { store.launch(app) } label: {
                            Image(nsImage: NSWorkspace.shared.icon(forFile: app.path)).resizable().frame(width: 24, height: 24)
                        }
                        .buttonStyle(MetalPlainStyle()).help(app.name)
                    }
                }
            }
        }
    }
}
