//
//  NewFeaturesWindow.swift
//  Notch apple
//
//  After an update: one small window listing the new things that are switched off (or optional), each with a
//  toggle, and the choice to turn them on. Shown once per update (see WhatsNew.pendingOffers).
//

import SwiftUI
import AppKit

struct NewFeatureOffer: Identifiable {
    let id: String
    let title: String
    let detail: String
    let key: String            // UserDefaults bool key the setting lives in
    var defaultOn = false
}

struct NewFeaturesView: View {
    let version: String
    let offers: [NewFeatureOffer]
    let finish: () -> Void
    @State private var on: Set<String>

    init(version: String, offers: [NewFeatureOffer], finish: @escaping () -> Void) {
        self.version = version; self.offers = offers; self.finish = finish
        _on = State(initialValue: Set(offers.filter { UserDefaults.standard.object(forKey: $0.key) as? Bool ?? $0.defaultOn }.map(\.id)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "sparkles").font(.system(size: 24)).foregroundStyle(Theme.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Notch apple \(version) is here").font(.title3.bold())
                    Text("Choose which new things to switch on. You can change any of them later in Settings.")
                        .font(.callout).foregroundStyle(.secondary)
                }
            }
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(offers) { o in
                        Toggle(isOn: Binding(get: { on.contains(o.id) }, set: { if $0 { on.insert(o.id) } else { on.remove(o.id) } })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(o.title).font(.system(size: 13, weight: .semibold))
                                Text(o.detail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .toggleStyle(.switch)
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: 10).fill(.quaternary.opacity(0.5)))
                    }
                }
            }
            HStack {
                Button("Turn all on") { on = Set(offers.map(\.id)) }
                Spacer()
                Button("Done") { apply(); finish() }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 460, height: min(120 + CGFloat(offers.count) * 72, 520))
    }

    private func apply() {
        for o in offers { UserDefaults.standard.set(on.contains(o.id), forKey: o.key) }
        AppDelegate.current?.applyBrightnessBlackoutPreference()
    }
}

@MainActor
enum NewFeaturesWindow {
    private static var window: NSWindow?

    /// Shows the window if this update has offers the person hasn't been asked about yet.
    static func showIfNeeded() {
        guard window == nil, !DemoHooks.isDemo else { return }
        let offers = WhatsNew.pendingOffers()
        guard !offers.isEmpty else { WhatsNew.markOffered(); return }
        WhatsNew.markOffered()   // asked once: never nag
        let w = NSWindow(contentRect: .zero, styleMask: [.titled, .closable], backing: .buffered, defer: false)
        w.title = "What's new"
        w.isReleasedWhenClosed = false
        w.contentView = NSHostingView(rootView: NewFeaturesView(version: WhatsNew.currentVersion, offers: offers) {
            window?.close(); window = nil
        })
        w.center()
        window = w
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
    }
}
