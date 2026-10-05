//
//  PurgeView.swift
//  Notch apple
//
//  Ultimate: the Purge tab. Disk cleaning is done by the Purge app (io.getpurge.app, MIT, purgemac.com): this
//  tab is a small menu for it. It shows whether Purge is installed, offers to install it if it isn't, and opens
//  Purge or its "removed apps" review. Purge has no way for other apps to start a clean, so the cleaning itself
//  happens in Purge, with its own preview and everything going to the Trash. Notch apple deletes nothing.
//

import AppKit
import SwiftUI

enum PurgeApp {
    static let bundleID = "io.getpurge.app"
    static let downloadPage = URL(string: "https://github.com/jithin-sabu/purge-app/releases/latest")!
    static let website = URL(string: "https://purgemac.com")!
    /// Purge's own link for reviewing apps that were removed and left files behind.
    static let removedApps = URL(string: "purge://removed-apps")!

    static var appURL: URL? { NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) }
    static var isInstalled: Bool { appURL != nil }

    static var version: String? {
        guard let url = appURL, let bundle = Bundle(url: url) else { return nil }
        return bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    }

    static func open() {
        guard let url = appURL else { return }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
    }

    static func openRemovedApps() {
        guard let url = appURL else { return }
        NSWorkspace.shared.open([removedApps], withApplicationAt: url, configuration: NSWorkspace.OpenConfiguration())
    }
}

struct PurgeView: View {
    @State private var installed = PurgeApp.isInstalled
    @AppStorage("purge.installDeclined") private var declined = false

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    Image(systemName: "internaldrive.fill").font(.system(size: 22)).foregroundStyle(Theme.accentGradient)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Purge").font(.title3.bold()).foregroundStyle(.white)
                        Text(installed ? (PurgeApp.version.map { "Purge \($0) is installed" } ?? "Purge is installed") : "Purge isn't installed")
                            .font(.caption).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                }
                if installed { menu } else { installPrompt }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)

            GlassCard {
                VStack(alignment: .leading, spacing: 8) {
                    Text("What Purge does").font(.headline).foregroundStyle(.white)
                    Text("Frees up your Mac by clearing the caches and junk it piles up. It shows you what it found first, and everything it removes goes to the Trash, so nothing is lost.")
                        .font(.callout).foregroundStyle(Theme.textSecondary)
                    Text("Cleaning happens inside Purge. Notch apple only opens it for you and never deletes anything itself.")
                        .font(.caption).foregroundStyle(Theme.textSecondary)
                    Spacer(minLength: 0)
                    Button("About Purge") { NSWorkspace.shared.open(PurgeApp.website) }.buttonStyle(.plain).foregroundStyle(Theme.accentBright).font(.caption)
                }
            }
            .frame(width: 250)
        }
        .onAppear { installed = PurgeApp.isInstalled }
    }

    // MARK: Installed: the menu

    private var menu: some View {
        VStack(spacing: 8) {
            row("Free up space", "Open Purge to scan and clean", "sparkles", prominent: true) { PurgeApp.open() }
            row("Review removed apps", "Find leftovers from apps you deleted", "trash.slash.fill", prominent: false) { PurgeApp.openRemovedApps() }
        }
    }

    private func row(_ title: String, _ detail: String, _ symbol: String, prominent: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(prominent ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Color.gray.opacity(0.45)), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    Text(detail).font(.caption).foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.textSecondary)
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.07)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Not installed: ask

    private var installPrompt: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Do you want to install Purge?").font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
            Text(declined
                 ? "No problem. You can install it whenever you like."
                 : "It's a free, open-source app that frees up disk space. Installing opens its download page: open the disk image and drag Purge to Applications.")
                .font(.callout).foregroundStyle(Theme.textSecondary)
            HStack {
                Button { NSWorkspace.shared.open(PurgeApp.downloadPage) } label: { Label("Install Purge", systemImage: "arrow.down.circle.fill") }
                    .buttonStyle(PurpleButtonStyle())
                if !declined { Button("Not now") { declined = true }.buttonStyle(.plain).foregroundStyle(Theme.textSecondary) }
                Button("I've installed it") { installed = PurgeApp.isInstalled }.buttonStyle(.plain).font(.caption).foregroundStyle(Theme.textSecondary)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.07)))
    }
}
