//
//  TabChoicesView.swift
//  Notch Apple
//
//  Shown once inside the notch after an update (and on a new install): "What should stay on your screen?". Every tab the owner
//  labelled is listed in three groups. Recommended ones start on, Not recommended ones start off, and Not many people use it keeps
//  what is on now. Nothing changes until the person presses a button, and the screen comes back every time the notch opens until
//  they do (like the top bar chooser): there is no skip, but "Keep everything as it is" is one of the two ways to finish.
//

import SwiftUI

@MainActor
final class TabChoices: ObservableObject {
    static let shared = TabChoices()
    private let key = "tabChoices.chosen.v1"
    @Published private(set) var revision = 0
    var chosen: Bool { UserDefaults.standard.bool(forKey: key) }
    func finish() { UserDefaults.standard.set(true, forKey: key); revision += 1 }
}

struct TabChoicesView: View {
    @ObservedObject private var settings = SettingsManager.shared
    @ObservedObject private var entitlements = Entitlements.shared
    @ObservedObject private var model = TabChoices.shared
    @State private var selection: [String: Bool] = [:]
    @State private var current: [String: Bool] = [:]
    @State private var fewOpen = false

    private let groups = TabChoicesLogic.groups(available: Module.allCases.map(\.rawValue))

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("What should stay on your screen?").font(.system(size: 17, weight: .bold, design: .rounded)).foregroundStyle(Theme.textPrimary)
            Text("Switch off what you don't want in the notch. Recommended ones start on, and you can change any of this later in Settings → Modules. Nothing changes until you press a button.")
                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(groups, id: \.pick) { g in
                        if g.pick == .fewUse {
                            DisclosureGroup(isExpanded: $fewOpen) { rows(g.modules) } label: { header(g.pick, count: g.modules.count) }
                        } else {
                            VStack(alignment: .leading, spacing: 4) { header(g.pick, count: g.modules.count); rows(g.modules) }
                        }
                    }
                }
                .padding(.trailing, 6)
            }
            HStack {
                Text(TabChoicesLogic.summary(selection: selection, current: current)).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                Spacer()
                Button("Keep everything as it is") { model.finish() }.buttonStyle(PurpleButtonStyle(prominent: false))
                Button("Use these choices") { apply() }.buttonStyle(PurpleButtonStyle())
            }
        }
        .padding(.top, 6)
        .onAppear(perform: load)
    }

    private func header(_ pick: TabPick, count: Int) -> some View {
        HStack(spacing: 6) {
            Text(pick.title).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textPrimary)
            Text("\(count) · \(pick.detail)").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
        }
    }

    private func rows(_ ids: [String]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(ids, id: \.self) { id in
                if let m = Module(rawValue: id) {
                    let locked = !allowed(m)
                    let fixed = TabChoicesLogic.alwaysOn.contains(id)
                    Toggle(isOn: Binding(get: { selection[id] ?? false }, set: { selection[id] = $0 })) {
                        HStack(spacing: 8) {
                            Image(systemName: m.symbol).frame(width: 18).foregroundStyle(Theme.accentBright)
                            VStack(alignment: .leading, spacing: 0) {
                                HStack(spacing: 5) {
                                    Text(m.title).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.textPrimary)
                                    if let f = m.feature, locked { Text(f.tier.name).font(.system(size: 9, weight: .semibold)).padding(.horizontal, 5).background(Capsule().fill(Theme.surfaceHover)).foregroundStyle(Theme.textSecondary) }
                                }
                                Text(fixed ? "Shows up when something is inside it" : m.blurb).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                            }
                        }
                    }
                    .toggleStyle(.switch).controlSize(.mini)
                    .disabled(locked || fixed)
                }
            }
        }
    }

    private func allowed(_ m: Module) -> Bool { m.feature.map { entitlements.canUse($0) } ?? true }

    private func load() {
        var cur: [String: Bool] = [:], sel: [String: Bool] = [:]
        for g in groups {
            for id in g.modules {
                guard let m = Module(rawValue: id) else { continue }
                let on = settings.isEnabled(m)
                cur[id] = on
                sel[id] = TabChoicesLogic.startsOn(pick: g.pick, currentlyOn: on, entitled: allowed(m))
            }
        }
        current = cur; selection = sel
    }

    private func apply() {
        for (id, on) in TabChoicesLogic.changes(selection: selection, current: current) {
            if let m = Module(rawValue: id) { settings.binding(for: m).wrappedValue = on }
        }
        model.finish()
    }
}
