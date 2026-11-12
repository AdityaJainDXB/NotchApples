//
//  NotchAIScreenView.swift
//  Notch Apple
//
//  The Screen section (Pro): the switch, permission, what NotchAI may read, and the actions. Everything is on
//  demand; the "Capturing" badge shows only while a capture runs. Text is read on this Mac with Apple Vision; the
//  question that goes to the model passes the Local-first guard like any other.
//

import SwiftUI

struct NotchAIScreenView: View {
    @ObservedObject private var screen = ScreenIntelligence.shared
    @ObservedObject private var config = AIConfig.shared
    @State private var scope: ScreenScope = .window
    private var unlocked: Bool { NotchAITier.allows(.pro) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if !unlocked {
                    Label(NotchAITier.lockedMessage(.pro), systemImage: "lock.fill").font(.system(size: 11)).foregroundStyle(.orange)
                }
                HStack {
                    Toggle("Screen awareness", isOn: $screen.isOn).toggleStyle(.switch).controlSize(.small).disabled(!unlocked)
                    Spacer()
                    if screen.capturing {
                        Label("Capturing", systemImage: "record.circle.fill").font(.system(size: 10, weight: .semibold)).foregroundStyle(.red)
                    }
                }
                permissionRow
                HStack {
                    Text("Read").font(.system(size: 11)).foregroundStyle(.white).frame(width: 60, alignment: .leading)
                    Picker("", selection: $scope) { ForEach(ScreenScope.allCases) { Text($0.title).tag($0) } }.labelsHidden().frame(width: 150)
                    Text("of the app you were just using").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                HStack(spacing: 8) {
                    Button("Explain my screen") { screen.ask(ScreenContextLogic.explainQuestion, label: "Explain my screen", scope: scope) }
                    Button("Summarise this app") { screen.ask(ScreenContextLogic.summariseQuestion, label: "Summarise this app", scope: scope) }
                    Button("Read the text only") { screen.readText(scope: scope) }
                }
                .disabled(!unlocked || !screen.isOn || screen.capturing)
                Toggle(isOn: $screen.sendImage) {
                    Text("Send the screenshot too")
                    Text(config.provider.likelySupportsVision(config.model)
                         ? "\(config.model) can read images. Off by default: only the text is sent."
                         : "\(config.model) is text only, so the image would be ignored.")
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                .toggleStyle(.switch).controlSize(.small).disabled(!config.provider.likelySupportsVision(config.model))
                if let s = screen.status {
                    Text(s).font(.system(size: 11)).foregroundStyle(.orange).frame(maxWidth: .infinity, alignment: .leading)
                }
                if let t = screen.lastText {
                    ScrollView { Text(t).font(.system(size: 11, design: .monospaced)).foregroundStyle(.white).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading) }
                        .frame(height: 90).padding(6).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                }
                NotchAITeachingCard().disabled(!unlocked || !screen.isOn)
                Divider().opacity(0.3)
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("Never capture these apps").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                        Spacer()
                        Button("Add the app I was using") { screen.excludeCurrentApp() }.controlSize(.small)
                        Button("Reset") { screen.exclusions = ScreenContextLogic.defaultExclusions }.controlSize(.small)
                    }
                    ForEach(screen.exclusions, id: \.self) { id in
                        HStack {
                            Text(id).font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.textSecondary)
                            Spacer()
                            Button { screen.exclusions = screen.exclusions.filter { $0 != id } } label: { Image(systemName: "xmark.circle") }.buttonStyle(.plain)
                        }
                    }
                }
                Text("Nothing is captured until you press a button, nothing is stored, and the screenshot is not sent unless you turn that on. The text is read on this Mac; the question and that text go only to the model you chose, and Local first applies.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
        }
        .onAppear { screen.refreshPermission() }
    }

    private var permissionRow: some View {
        HStack(spacing: 8) {
            Image(systemName: screen.permissionGranted ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                .foregroundStyle(screen.permissionGranted ? NotchAIView.green : .orange)
            Text(screen.permissionGranted ? "Screen Recording is allowed for Notch Apple." : "Screen Recording is not allowed yet.")
                .font(.system(size: 11)).foregroundStyle(.white)
            Spacer()
            if !screen.permissionGranted { Button("Allow screen access") { screen.requestPermission() }.controlSize(.small) }
        }
    }
}
