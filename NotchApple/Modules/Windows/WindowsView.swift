//
//  WindowsView.swift
//  Notch apple
//
//  The Windows tab: snap the window you were using, tile every window on the
//  screen at once, and save / restore whole window layouts.
//

import SwiftUI

struct WindowsView: View {
    @StateObject private var manager = WindowManager.shared
    @StateObject private var store = SavedLayoutStore.shared
    @State private var hovered: SnapLayout?

    private let columns = Array(repeating: GridItem(.fixed(60), spacing: 8), count: 8)

    var body: some View {
        if !manager.isTrusted {
            permissionPrompt
        } else {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(hovered?.title ?? "Snap the front window").sectionTitle()
                        Spacer()
                        if manager.canRestore {
                            Button { manager.restoreLast() } label: { Label("Undo", systemImage: "arrow.uturn.backward") }
                                .buttonStyle(PurpleButtonStyle(prominent: false))
                        }
                    }
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
                        ForEach(SnapLayout.dropRows.flatMap { $0 }) { layout in
                            Button { manager.snapFrontWindow(layout) } label: {
                                LayoutGlyph(layout: layout, active: hovered == layout).frame(width: 60, height: 40)
                            }
                            .buttonStyle(.plain)
                            .onHover { hovered = $0 ? layout : (hovered == layout ? nil : hovered) }
                            .help(layout.title)
                            .accessibilityLabel(layout.title)
                        }
                    }

                    Text("Arrange all windows").sectionTitle().padding(.top, 4)
                    HStack(spacing: 8) {
                        ForEach(TileArrangement.allCases) { arrangement in
                            Button { manager.tile(arrangement) } label: {
                                VStack(spacing: 4) {
                                    Image(systemName: arrangement.symbol).font(.system(size: 18))
                                    Text(arrangement.title).font(.system(size: 10, weight: .medium)).lineLimit(1)
                                }
                                .frame(width: 88, height: 46)
                            }
                            .buttonStyle(PurpleButtonStyle(prominent: false))
                            .help("Tile the visible windows: \(arrangement.title.lowercased())")
                        }
                    }

                    HStack {
                        Button { manager.moveFrontWindowToNextScreen() } label: { Label("Next display", systemImage: "display.2") }
                            .buttonStyle(PurpleButtonStyle(prominent: false))
                        Spacer()
                        Text(manager.lastMessage ?? "Tip: drag a window up to the notch, or use ⌃⌥ + arrows.")
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                    }
                }

                savedLayouts
            }
            .padding(4)
        }
    }

    private var savedLayouts: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Saved layouts").sectionTitle()
                Spacer()
                IconButton(systemImage: "plus", help: "Save where every window is now") {
                    let formatter = DateFormatter()
                    formatter.dateFormat = "EEE HH:mm"
                    if let layout = manager.captureLayout(named: "Layout · \(formatter.string(from: Date()))") {
                        store.add(layout)
                    }
                }
            }
            if store.layouts.isEmpty {
                Text("Save your windows' positions and put them all back in one click.")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxHeight: .infinity, alignment: .top)
            } else {
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(store.layouts) { layout in
                            HStack(spacing: 6) {
                                Button { manager.apply(layout) } label: {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(layout.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                                        Text("\(layout.entries.count) windows · \(Set(layout.entries.map(\.appName)).count) apps")
                                            .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(8)
                                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                }
                                .buttonStyle(.plain)
                                .help("Restore this layout")
                                IconButton(systemImage: "trash", help: "Delete layout") { store.delete(layout) }
                            }
                        }
                    }
                }
            }
        }
        .frame(width: 150)
    }

    private var permissionPrompt: some View {
        VStack(spacing: 10) {
            Image(systemName: "rectangle.split.2x2.fill").font(.system(size: 30)).foregroundStyle(Theme.accent)
            Text("Snap and tile your windows").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
            Text("Notch apple needs Accessibility access to move and resize other apps' windows.\nTurn on Notch apple in System Settings → Privacy & Security → Accessibility.\nAlready on but not working? Select it, press −, then click Allow again.")
                .font(.system(size: 12))
                .multilineTextAlignment(.center)
                .foregroundStyle(Theme.textSecondary)
            HStack {
                Button("Allow Accessibility…") { manager.requestAccess() }.buttonStyle(PurpleButtonStyle())
                Button("I've turned it on") { manager.refreshTrust() }.buttonStyle(PurpleButtonStyle(prominent: false))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { manager.refreshTrust() }
    }
}

/// Settings → Windows.
struct WindowsSettings: View {
    @EnvironmentObject private var settings: SettingsManager
    @StateObject private var manager = WindowManager.shared

    var body: some View {
        Form {
            Section {
                Toggle("Show Windows in the notch", isOn: $settings.windowsEnabled)
                LabeledContent("Accessibility") {
                    if manager.isTrusted {
                        Label("Allowed", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    } else {
                        Button("Allow…") { manager.requestAccess() }
                    }
                }
            } footer: {
                Text("Moving other apps' windows needs Accessibility access. If you update Notch apple, macOS may ask again: remove it from the list and turn it back on.")
            }
            Section("Snapping") {
                Toggle("Show snap zones when I drag a window to the notch", isOn: $settings.windowDragToNotch)
                Toggle("Keyboard shortcuts", isOn: $settings.windowShortcuts)
                LabeledContent("Gap between windows") {
                    HStack {
                        Slider(value: $settings.windowGap, in: 0...24, step: 2).frame(width: 160)
                        Text("\(Int(settings.windowGap)) pt").monospacedDigit().frame(width: 40, alignment: .trailing)
                    }
                }
            }
            Section("Shortcuts") {
                shortcut("⌃⌥←", "Left half")
                shortcut("⌃⌥→", "Right half")
                shortcut("⌃⌥↑", "Top half")
                shortcut("⌃⌥↓", "Bottom half")
                shortcut("⌃⌥↩", "Fill screen")
                shortcut("⌃⌥C", "Center")
                shortcut("⌃⌥⌫", "Undo last snap")
            }
        }
        .formStyle(.grouped)
        .onAppear { manager.refreshTrust() }
    }

    private func shortcut(_ keys: String, _ action: String) -> some View {
        LabeledContent(action) { Text(keys).font(.system(.body, design: .monospaced)).foregroundStyle(.secondary) }
    }
}
