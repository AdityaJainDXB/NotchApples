//
//  RequiredUpdateView.swift
//  Notch apple
//
//  (With skippable: true it is the request shown when a new version comes out and every 4th or 5th time the notch
//  is opened after that: it lists what is in the update and has "Skip for now". Updates are only compulsory when
//  the developer asks for it.)
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
            let security = UpdateChecker.securityNote(release.notes)
            Text(skippable ? "A new Notch apple is ready" : security != nil ? "Critical security update" : "Update Notch apple to keep using it").font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
            if let security, !skippable {
                Text(security.isEmpty ? "This version has security problems that are fixed in the update." : security)
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(.orange).multilineTextAlignment(.center).frame(maxWidth: 520)
            }
            Text(skippable ? "Version \(release.version) is ready. It takes under a minute; your settings and data are kept and Notch apple reopens by itself." : "Version \(release.version) is required: this copy is out of date. It takes under a minute; your settings and data are kept and Notch apple reopens by itself.")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center).frame(maxWidth: 520)
            let inside = ReleaseNotesLogic.whatsInside(release.notes)
            if !inside.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("What's in this update").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                    ScrollView {
                        Text(LocalizedStringKey(UpdatesSettings.readable(inside)))
                            .font(.system(size: 11)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxHeight: 96)
                }
                .padding(10).frame(maxWidth: 520, alignment: .leading)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
            }
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
