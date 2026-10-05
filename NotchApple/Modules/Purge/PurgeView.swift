//
//  PurgeView.swift
//  Notch apple
//
//  Ultimate: the Purge tab. Disk cleaning is done by the Purge app (io.getpurge.app), not by Notch apple:
//  this tab shows whether it's installed, opens it in one click, and links to it when it isn't.
//  Notch apple never scans or deletes anything itself.
//

import AppKit
import SwiftUI

enum PurgeApp {
    static let bundleID = "io.getpurge.app"
    static let homepage = URL(string: "https://github.com/jithin-sabu/purge-app")!

    static var appURL: URL? { NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) }
    static var isInstalled: Bool { appURL != nil }

    static var version: String? {
        guard let url = appURL, let bundle = Bundle(url: url) else { return nil }
        return bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    }

    static func open() {
        guard let url = appURL else { NSWorkspace.shared.open(homepage); return }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
    }
}

struct PurgeView: View {
    @State private var installed = PurgeApp.isInstalled

    var body: some View {
        VStack(spacing: 14) {
            Spacer(minLength: 0)
            Image(systemName: "internaldrive.fill")
                .font(.system(size: 40)).foregroundStyle(Theme.accentGradient)
            Text("Purge").font(.title2.bold()).foregroundStyle(.white)
            Text(installed
                 ? "Free up disk space with the Purge app: caches, build leftovers and more, with a preview before anything is removed."
                 : "Purge is a separate app that frees up disk space. Install it, then open it from here.")
                .multilineTextAlignment(.center).foregroundStyle(Theme.textSecondary).frame(maxWidth: 420)
            if installed {
                if let v = PurgeApp.version { Text("Purge \(v) is installed").font(.caption).foregroundStyle(Theme.textSecondary) }
                Button { PurgeApp.open() } label: { Label("Open Purge", systemImage: "arrow.up.forward.app.fill").frame(minWidth: 180) }
                    .buttonStyle(PurpleButtonStyle())
            } else {
                Button { NSWorkspace.shared.open(PurgeApp.homepage) } label: { Label("Get Purge", systemImage: "arrow.down.circle.fill").frame(minWidth: 180) }
                    .buttonStyle(PurpleButtonStyle())
                Button("I've installed it") { installed = PurgeApp.isInstalled }
                    .buttonStyle(.plain).font(.caption).foregroundStyle(Theme.textSecondary)
            }
            Text("Notch apple doesn't scan or delete anything itself. Purge does the cleaning.")
                .font(.caption2).foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { installed = PurgeApp.isInstalled }
    }
}
