//
//  AppActionsMenu.swift
//  Notch apple
//
//  A small colour-coded menu: Settings (purple), Relaunch (orange) and
//  Quit (red). Opened from the power button in the notch header.
//

import SwiftUI

struct AppActionsButton: View {
    let close: () -> Void
    @State private var showing = false

    var body: some View {
        IconButton(systemImage: "power", help: "Settings, relaunch or quit") { showing.toggle() }
            .popover(isPresented: $showing, arrowEdge: .bottom) {
                AppActionsMenu { showing = false; close() }
            }
    }
}

struct AppActionsMenu: View {
    let dismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Notch apple").font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                .padding(.horizontal, 4)
            row("Open Settings", "gearshape.fill", Color(red: 0.62, green: 0.4, blue: 1)) {
                dismiss(); AppDelegate.openSettingsWindow()
            }
            row("Relaunch", "arrow.clockwise", .orange) { dismiss(); AppRelauncher.relaunch() }
            row("Quit Notch apple", "xmark.circle.fill", .red) { NSApp.terminate(nil) }
        }
        .padding(10)
        .frame(width: 220)
    }

    private func row(_ title: String, _ symbol: String, _ color: Color, action: @escaping () -> Void) -> some View {
        ActionRow(title: title, symbol: symbol, color: color, action: action)
    }
}

private struct ActionRow: View {
    let title: String, symbol: String, color: Color
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol).font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 26, height: 26).background(color.gradient, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(hovering ? color : .primary)
                Spacer()
            }
            .padding(6)
            .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(color.opacity(hovering ? 0.16 : 0)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}
