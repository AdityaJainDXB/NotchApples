//
//  TopBarPrefs.swift
//  Notch apple
//
//  Which of the always-there header buttons (coffee, pin, settings, close) show in the notch. New installs and
//  updates see a one-time chooser; Settings → Notch has the same switches. The power menu is always shown.
//

import SwiftUI

final class TopBarPrefs: ObservableObject {
    static let shared = TopBarPrefs()
    private static let hiddenKey = "topbar.hidden"
    private static let chosenKey = "topbar.chosen"

    @Published private(set) var revision = 0

    var hidden: [String] { UserDefaults.standard.stringArray(forKey: Self.hiddenKey) ?? [] }
    var chosen: Bool { UserDefaults.standard.bool(forKey: Self.chosenKey) }

    func shown(_ item: String) -> Bool { ModuleLayoutLogic.topBarShown(item, hidden: hidden) }

    func set(_ item: String, shown: Bool) {
        UserDefaults.standard.set(ModuleLayoutLogic.topBar(setting: item, shown: shown, hidden: hidden), forKey: Self.hiddenKey)
        revision += 1
    }

    func finishChoosing() {
        UserDefaults.standard.set(true, forKey: Self.chosenKey)
        revision += 1
    }

    static let titles: [(id: String, title: String, symbol: String, detail: String)] = [
        ("coffee", "Keep awake", "cup.and.saucer", "Stops the Mac sleeping until you click it again."),
        ("pin", "Pin open", "pin", "Keeps the notch open while you drag files in."),
        ("settings", "Settings", "gearshape.fill", "A shortcut to Settings (also in the power menu)."),
        ("close", "Close arrow", "chevron.up", "Closes the notch (Esc and ⌘E also work)."),
    ]
}

/// The switches, used by the first-run chooser and by Settings → Notch.
struct TopBarSwitches: View {
    @ObservedObject private var prefs = TopBarPrefs.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(TopBarPrefs.titles, id: \.id) { item in
                Toggle(isOn: Binding(get: { prefs.shown(item.id) }, set: { prefs.set(item.id, shown: $0) })) {
                    Label {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(item.title).font(.system(size: 13, weight: .semibold))
                            Text(item.detail).font(.system(size: 11)).foregroundStyle(.secondary)
                        }
                    } icon: { Image(systemName: item.symbol).frame(width: 20) }
                }
                .toggleStyle(.switch)
            }
            Label("The power menu (Settings, Relaunch, Quit) is always there.", systemImage: "power")
                .font(.system(size: 11)).foregroundStyle(.secondary)
        }
    }
}

/// Shown once inside the notch after installing or updating.
struct TopBarChooserView: View {
    @ObservedObject private var prefs = TopBarPrefs.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Choose your top bar").font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(.white)
            Text("These buttons sit at the top right of the notch. Keep the ones you use. You can change this any time in Settings → Notch.")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            GlassCard { TopBarSwitches() }
            HStack {
                Spacer()
                Button("Done") { prefs.finishChoosing() }.buttonStyle(PurpleButtonStyle())
            }
        }
        .padding(.top, 6)
    }
}
