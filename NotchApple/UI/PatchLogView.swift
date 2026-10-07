//
//  PatchLogView.swift
//  Notch apple
//
//  The update patch log, inside the notch. After an update the notch opens on what changed in this version, with a
//  switch for each new optional feature and one "Got it" button that returns to the tabs. No separate window or
//  system alert is used. Settings → About → What's New opens the same card.
//

import SwiftUI

struct NewFeatureOffer: Identifiable {
    let id: String
    let title: String
    let detail: String
    let key: String            // UserDefaults bool key the setting lives in
    var defaultOn = false
}

@MainActor
final class PatchLog: ObservableObject {
    static let shared = PatchLog()
    @Published var isShowing = false

    /// Called at launch: after an update (or with features not yet offered), open the notch on the patch log, once.
    func showAfterUpdateIfNeeded() {
        guard !DemoHooks.isDemo, WhatsNew.hasUnseen || !WhatsNew.pendingOffers().isEmpty else { return }
        guard !WhatsNew.seenVersion.isEmpty, WhatsNew.releases.contains(where: { $0.version == WhatsNew.currentVersion }) else { WhatsNew.markOffered(); return }
        open()
    }

    func open() {
        isShowing = true
        AppDelegate.current?.openNotch()
    }

    func dismiss() {
        isShowing = false
        WhatsNew.markSeen()
        WhatsNew.markOffered()
    }
}

struct PatchLogView: View {
    @ObservedObject private var log = PatchLog.shared
    @State private var on: Set<String>
    private let offers: [NewFeatureOffer]
    private let release: ReleaseNote?

    init() {
        let pending = WhatsNew.pendingOffers()
        offers = pending
        release = WhatsNew.releases.first { $0.version == WhatsNew.currentVersion } ?? WhatsNew.releases.first
        _on = State(initialValue: Set(pending.filter { UserDefaults.standard.object(forKey: $0.key) as? Bool ?? $0.defaultOn }.map(\.id)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "sparkles").font(.system(size: 22)).foregroundStyle(Theme.accentGradient)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Notch apple \(release?.version ?? WhatsNew.currentVersion)").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                    if let r = release { Text(r.headline).font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
                }
                Spacer()
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if let r = release {
                        ForEach(r.items, id: \.self) { item in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text("•").foregroundStyle(Theme.textSecondary)
                                Text(item).fixedSize(horizontal: false, vertical: true)
                            }
                            .font(.system(size: 12)).foregroundStyle(.white)
                        }
                    }
                    if !offers.isEmpty {
                        Text("Switch on what you want").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary).padding(.top, 4)
                        ForEach(offers) { o in
                            Toggle(isOn: Binding(get: { on.contains(o.id) }, set: { if $0 { on.insert(o.id) } else { on.remove(o.id) } })) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(o.title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                                    Text(o.detail).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                                }
                            }
                            .toggleStyle(.switch)
                        }
                    }
                }
            }
            HStack {
                if !offers.isEmpty { Button("Turn all on") { on = Set(offers.map(\.id)) }.buttonStyle(PurpleButtonStyle(prominent: false)) }
                Spacer()
                Button("Got it") { apply(); log.dismiss() }.buttonStyle(PurpleButtonStyle())
            }
        }
        .padding(.top, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func apply() {
        for o in offers { UserDefaults.standard.set(on.contains(o.id), forKey: o.key) }
        AppDelegate.current?.applyBrightnessBlackoutPreference()
    }
}
