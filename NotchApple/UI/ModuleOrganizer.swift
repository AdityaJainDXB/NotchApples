//
//  ModuleOrganizer.swift
//  Notch apple
//
//  One place to choose and arrange the notch's tabs, used by the welcome tour and by
//  Settings → Appearance. No arrows: every tab is a card you drag.
//
//   • "In your notch": the tabs you use, numbered in the order they appear. Drag a card and the
//     others make room as you move (live), or press ✕ to take it out.
//   • "Add more": the rest. Click a card, or drag it up into the row where you want it.
//   • Drag a card from the notch row down into "Add more" to remove it.
//
//  Everything writes straight to the same settings as Settings → Modules, so there is only one list.
//

import SwiftUI
import UniformTypeIdentifiers

struct ModuleOrganizer: View {
    @ObservedObject private var settings = SettingsManager.shared
    @ObservedObject private var entitlements = Entitlements.shared
    @State private var dragging: Module?
    @State private var overOff = false

    private let columns = [GridItem(.adaptive(minimum: 158), spacing: 8)]

    var body: some View {
        let on = settings.enabledTabs
        let off = Module.allCases.filter { $0.isTab && !settings.isEnabled($0) }
        VStack(alignment: .leading, spacing: 14) {
            zoneHeader("In your notch", detail: on.isEmpty ? "Nothing yet. Add a tab below." : "Drag to reorder. The first tab opens first.")
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(Array(on.enumerated()), id: \.element) { index, module in
                    card(module, number: index + 1)
                        .onDrop(of: [.text], delegate: CardDrop(
                            enter: { place(dragging, before: module) },
                            done: { dragging = nil }))
                }
            }
            // Dropping on empty space at the end moves the card to the end.
            .onDrop(of: [.text], delegate: CardDrop(enter: {}, done: { if let d = dragging { place(d, before: nil) }; dragging = nil }))
            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: on)

            zoneHeader("Add more", detail: "Click a tab to add it, or drag it up to the spot you want.")
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(off) { module in card(module, number: nil) }
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(overOff ? 0.1 : 0.03)))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.accent.opacity(overOff ? 0.7 : 0), style: StrokeStyle(lineWidth: 1.5, dash: [5])))
            .onDrop(of: [.text], delegate: CardDrop(
                enter: { overOff = true; if let d = dragging, settings.isEnabled(d) { remove(d) } },
                done: { overOff = false; dragging = nil },
                exit: { overOff = false }))
            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: off)
        }
        // A drag cancelled somewhere else never leaves a card stuck as "being dragged".
        .onDrop(of: [.text], delegate: CardDrop(enter: {}, done: { dragging = nil; overOff = false }))
    }

    // MARK: Pieces

    private func zoneHeader(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.headline).foregroundStyle(.white)
            Text(detail).font(.caption).foregroundStyle(.secondary)
        }
    }

    private func card(_ module: Module, number: Int?) -> some View {
        let isOn = number != nil
        return HStack(spacing: 8) {
            if let number {
                Text("\(number)").font(.system(size: 10, weight: .bold).monospacedDigit()).foregroundStyle(.white.opacity(0.8))
                    .frame(width: 16)
            }
            Image(systemName: module.symbol)
                .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 26, height: 26)
                .background(isOn ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Color.gray.opacity(0.5)), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            VStack(alignment: .leading, spacing: 0) {
                Text(module.title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                if let f = module.feature, !entitlements.canUse(f) {
                    Text(f.tier.name).font(.system(size: 9, weight: .bold)).foregroundStyle(f.tier == .ultimate ? Color.pink : Color.orange)
                }
            }
            Spacer(minLength: 0)
            Button { isOn ? remove(module) : add(module) } label: {
                Image(systemName: isOn ? "xmark.circle.fill" : "plus.circle.fill")
                    .font(.system(size: 15)).foregroundStyle(isOn ? Color.secondary : Theme.accent)
            }
            .buttonStyle(.plain)
            .help(isOn ? "Remove from the notch" : "Add to the notch")
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .frame(height: 42)
        .background(RoundedRectangle(cornerRadius: 11).fill(Color.white.opacity(isOn ? 0.1 : 0.05)))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(dragging == module ? Theme.accent : Color.white.opacity(0.08), lineWidth: dragging == module ? 1.5 : 1))
        .opacity(dragging == module ? 0.55 : 1)
        .contentShape(RoundedRectangle(cornerRadius: 11))
        .onTapGesture { if !isOn { add(module) } }
        .onDrag {
            dragging = module
            return NSItemProvider(object: module.rawValue as NSString)
        }
        .contextMenu {
            if isOn {
                Button("Move to the start") { place(module, before: settings.enabledTabs.first) }
                Button("Move to the end") { place(module, before: nil) }
                Divider()
                Button("Remove from the notch") { remove(module) }
            } else {
                Button("Add to the notch") { add(module) }
            }
        }
        .accessibilityLabel(module.title)
        .accessibilityValue(isOn ? "Tab \(number ?? 0), in your notch" : "Not in your notch")
        .accessibilityAction(named: isOn ? "Remove" : "Add") { isOn ? remove(module) : add(module) }
    }

    // MARK: Changes

    private func add(_ module: Module) {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { place(module, before: nil) }
    }

    private func remove(_ module: Module) {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { settings.binding(for: module).wrappedValue = false }
    }

    /// Puts `module` in the notch, just before `target` (or last).
    private func place(_ module: Module?, before target: Module?) {
        guard let module, module != target else { return }
        if !settings.isEnabled(module) { settings.binding(for: module).wrappedValue = true }
        var list = settings.enabledTabs.filter { $0 != module }
        let index = target.flatMap { list.firstIndex(of: $0) } ?? list.endIndex
        list.insert(module, at: index)
        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { settings.setEnabledTabOrder(list) }
    }
}

/// Reorders live as a card is dragged over another one.
private struct CardDrop: DropDelegate {
    let enter: () -> Void
    let done: () -> Void
    var exit: () -> Void = {}

    func dropEntered(info: DropInfo) { enter() }
    func dropExited(info: DropInfo) { exit() }
    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }
    func validateDrop(info: DropInfo) -> Bool { info.hasItemsConforming(to: [.text]) }
    func performDrop(info: DropInfo) -> Bool { done(); return true }
}

extension SettingsManager {
    /// Saves the order of the tabs that are on; turned-off modules keep their old places.
    func setEnabledTabOrder(_ enabledOrder: [Module]) {
        var queue = enabledOrder
        let full = orderedTabs.map { isEnabled($0) && !queue.isEmpty ? queue.removeFirst() : $0 }
        setTabOrder(full)
    }
}
