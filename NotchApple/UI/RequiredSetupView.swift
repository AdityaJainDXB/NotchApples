//
//  RequiredSetupView.swift
//  Notch apple
//
//  Shown in the open notch until the Accessibility permission is on. It says what the permission is for, walks
//  through the three steps, and continues by itself the moment macOS reports it as granted.
//

import SwiftUI

struct RequiredSetupView: View {
    @ObservedObject private var setup = RequiredSetup.shared

    var body: some View {
        VStack(spacing: 14) {
            Spacer(minLength: 0)
            Image(systemName: "hand.raised.fill").font(.system(size: 34)).foregroundStyle(Theme.accentGradient)
            Text("One required step before Notch apple works").font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
            Text("Notch apple needs the Accessibility permission. It's what lets it show the volume and brightness gauge in the notch when you press the keys, snap windows, paste your snippets and read selected text. Nothing leaves your Mac.")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center).frame(maxWidth: 560)
            VStack(alignment: .leading, spacing: 4) {
                step("1", "Click **Open Accessibility Settings** below.")
                step("2", "Switch **Notch apple** on in the list (if it isn't there, click + and add it from Applications).")
                step("3", "Come back here. This screen continues by itself.")
            }
            HStack(spacing: 10) {
                Button("Open Accessibility Settings") { setup.openSettings() }.buttonStyle(PurpleButtonStyle())
                Button("Relaunch Notch apple") { AppRelauncher.relaunch() }
                    .buttonStyle(PurpleButtonStyle(prominent: false))
                    .help("If it's already switched on but this screen stays, switch it off and on again, then relaunch.")
                Button("Quit") { NSApp.terminate(nil) }.buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Waiting for the permission…").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
    }

    private func step(_ n: String, _ text: LocalizedStringKey) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(n).font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                .frame(width: 18, height: 18).background(Theme.accent, in: Circle())
            Text(text).font(.system(size: 12)).foregroundStyle(.white)
        }
    }
}
