//
//  HumanizerView.swift
//  Notch Apple
//
//  Tools → Humanizer: paste text, press Humanize, and the model chosen in NotchAI rewrites it so it reads like a person wrote it.
//  Shows how many words are left this month, and what to do when they run out. The rules are in HumanizerLogic.swift.
//

import SwiftUI

struct HumanizerView: View {
    @ObservedObject private var service = HumanizerService.shared
    @State private var input = ""
    @State private var output = ""
    @State private var problem: String?
    @State private var copied = false

    private var words: Int { HumanizerLogic.wordCount(input) }
    private var limit: Int? { service.perRequestLimit }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                card("Your text") {
                    TextEditor(text: $input).font(.system(size: 12)).scrollContentBackground(.hidden)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    HStack {
                        Text(limit.map { "\(words) of \($0) words" } ?? "\(words) words").font(.system(size: 10))
                            .foregroundStyle(limit.map { words > $0 } == true ? Color.orange : Theme.textSecondary)
                        Spacer()
                        Button(service.busy ? "Working…" : "Humanize") { run() }
                            .buttonStyle(PurpleButtonStyle()).disabled(service.busy || words == 0)
                    }
                }
                card("Rewritten") {
                    ScrollView { Text(output.isEmpty ? "The rewrite shows here." : output).font(.system(size: 12))
                        .foregroundStyle(output.isEmpty ? Theme.textSecondary : Theme.textPrimary).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .topLeading) }
                    HStack {
                        Spacer()
                        Button(copied ? "Copied" : "Copy") {
                            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(output, forType: .string)
                            copied = true; DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
                        }.buttonStyle(MetalPlainStyle()).disabled(output.isEmpty)
                    }
                }
            }
            HStack(spacing: 8) {
                Text(service.summary).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                Spacer()
                if service.monthlyLeft == 0 && service.credits == 0 {
                    Text("Extra words (1 USD = 50,000, they never run out): coming soon").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.accentBright)
                }
            }
            Text("Checklist: the Humanizer skill, from Wikipedia's “Signs of AI writing” guide (CC BY-SA 4.0).").font(.system(size: 9)).foregroundStyle(Theme.textSecondary.opacity(0.7))
            if let problem { Text(problem).font(.system(size: 10)).foregroundStyle(.orange) }
        }
    }

    private func card<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
            content()
        }
        .padding(10).frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func run() {
        problem = nil
        let text = input
        Task {
            do { output = try await HumanizerService.shared.humanize(text) }
            catch { problem = error.localizedDescription }
        }
    }
}
