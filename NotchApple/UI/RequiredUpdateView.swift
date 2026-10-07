//
//  RequiredUpdateView.swift
//  Notch apple
//
//  (With skippable: true it is the gentler reminder shown every 4th or 5th time the notch is opened.)
//
//  Shown in the open notch instead of the tabs when the newest release is marked as required (its GitHub release
//  notes contain the line `[required-update]`). The only way forward is Update; Settings and the menu bar stay
//  usable. If GitHub can't be reached nothing is blocked, so being offline never locks anybody out.
//

import SwiftUI

struct RequiredUpdateView: View {
    @ObservedObject private var updater = UpdateChecker.shared
    let release: UpdateChecker.Release
    /// A reminder can be skipped for now; a required update can't.
    var skippable = false

    var body: some View {
        VStack(spacing: 14) {
            Spacer(minLength: 0)
            Image(systemName: "arrow.down.circle.fill").font(.system(size: 34)).foregroundStyle(Theme.accentGradient)
            Text(skippable ? "A new Notch apple is ready" : "Update Notch apple to keep using it").font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
            Text("Version \(release.version) is \(skippable ? "available" : "a required update"). It takes under a minute; your settings and data are kept and Notch apple reopens by itself.")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center).frame(maxWidth: 520)
            switch updater.phase {
            case .downloading(let v): ProgressView("Downloading…", value: v).frame(maxWidth: 280)
            case .installing: ProgressView("Installing… Notch apple will quit and reopen.").progressViewStyle(.linear).frame(maxWidth: 320)
            case .failed(let m):
                Text(m).font(.system(size: 11)).foregroundStyle(.orange).multilineTextAlignment(.center).frame(maxWidth: 480)
                actions(label: "Try again")
            default: actions(label: "Update now")
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func actions(label: String) -> some View {
        HStack(spacing: 10) {
            Button(label) { updater.install() }.buttonStyle(PurpleButtonStyle())
            if skippable { Button("Skip for now") { updater.snoozeReminder() }.buttonStyle(PurpleButtonStyle(prominent: false)) }
            Link("Download from GitHub", destination: release.pageURL).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
        }
    }
}
