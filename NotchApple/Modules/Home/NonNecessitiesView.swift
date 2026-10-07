//
//  NonNecessitiesView.swift
//  Notch apple
//
//  One tab for the things you use now and then: Focus, World Clock, Audio, Snippets, Shortcuts, Timers, Plugins,
//  Voice Notes, Screen Time and Smart Home (and anything else you chose to tuck away). A row of pages along the
//  top; each page is the feature's own screen.
//

import SwiftUI

struct NonNecessitiesView: View {
    @ObservedObject private var layout = ModuleLayout.shared
    @EnvironmentObject private var settings: SettingsManager
    @AppStorage("nonNecessities.page") private var pageRaw = ""

    private var pages: [Module] { layout.nonNecessities }
    private var current: Module? { pages.first { $0.rawValue == pageRaw } ?? pages.first }

    var body: some View {
        VStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(pages) { m in
                        let on = m == current
                        Button { pageRaw = m.rawValue } label: {
                            Label(m.title, systemImage: m.symbol)
                                .font(.system(size: 11, weight: .semibold)).lineLimit(1)
                                .padding(.horizontal, 10).frame(height: 26)
                                .background(Capsule().fill(on ? AnyShapeStyle(Theme.accent.opacity(0.45)) : AnyShapeStyle(Theme.surface)))
                                .foregroundStyle(.white)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            if let m = current {
                ModuleContentView(module: m).id(m)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "tray").font(.largeTitle).foregroundStyle(Theme.accent)
                    Text("Nothing is tucked away here").foregroundStyle(.white)
                    Text("Move features here from Settings → Modules & Layout.").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}
