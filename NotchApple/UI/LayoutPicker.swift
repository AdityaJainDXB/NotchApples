//
//  LayoutPicker.swift
//  Notch apple
//
//  The little menu that says where a feature lives (on Home, its own tab, Non-Necessities, or off). Used by
//  Settings → Modules & Layout and by the chooser shown after an update, so both always agree.
//

import SwiftUI

struct LayoutPicker: View {
    let module: Module
    /// When set, the choice is held here until the person confirms (the chooser), instead of applied at once.
    var draft: Binding<LayoutChoice>?
    /// Use the short names where space is tight.
    var compact = false
    @ObservedObject private var layout = ModuleLayout.shared

    private var current: LayoutChoice { draft?.wrappedValue ?? layout.choice(module) }

    var body: some View {
        Menu {
            ForEach(layout.options(module)) { c in
                Button {
                    if let draft { draft.wrappedValue = c } else { layout.set(c, for: module) }
                } label: {
                    if c == current { Label(c.title, systemImage: "checkmark") } else { Text(c.title) }
                }
            }
        } label: {
            Text(compact ? current.shortTitle : current.title).font(.system(size: 12)).lineLimit(1)
        }
        .menuStyle(.borderlessButton).fixedSize()
    }
}
