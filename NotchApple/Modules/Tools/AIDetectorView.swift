//
//  AIDetectorView.swift
//  Notch Apple
//
//  Tools → AI Detector: paste text and see how strongly it shows the habits that make writing read like a chatbot, and which ones.
//  It runs on this Mac with no model and no network (AITellChecker.swift), so it is free and unlimited. It is a guide to writing
//  habits, not a detector like ZeroGPT's, and no score proves who wrote something.
//

import SwiftUI

struct AIDetectorView: View {
    @State private var input = ""
    @State private var report: AITellChecker.Report?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Text to check").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                TextEditor(text: $input).font(.system(size: 12)).scrollContentBackground(.hidden)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                HStack {
                    Text("\(HumanizerLogic.wordCount(input)) words").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Button("Check") { report = AITellChecker.report(input) }
                        .buttonStyle(PurpleButtonStyle()).disabled(HumanizerLogic.wordCount(input) == 0)
                }
            }
            .padding(10).frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 6) {
                Text("Result").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                if let r = report {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("\(r.score)%").font(.system(size: 30, weight: .bold)).foregroundStyle(color(r.score))
                        Text(AITellChecker.verdict(r.score)).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                    }
                    ProgressView(value: Double(r.score), total: 100).tint(color(r.score))
                    ScrollView {
                        VStack(alignment: .leading, spacing: 3) {
                            if r.tells.isEmpty { Text("No chatbot habits found.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
                            ForEach(r.tells, id: \.label) { t in
                                HStack { Text(t.label).font(.system(size: 11)); Spacer(); Text("\(t.count)").font(.system(size: 11, weight: .semibold)) }.foregroundStyle(Theme.textPrimary)
                            }
                            if r.uniformRhythm { Text("Sentences are all about the same length.").font(.system(size: 11)).foregroundStyle(.orange) }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                } else {
                    Text("Paste some text and press Check.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
                Text("A guide to writing habits, not proof. It runs on this Mac and sends nothing. Real detectors such as ZeroGPT use other methods and can disagree.")
                    .font(.system(size: 9)).foregroundStyle(Theme.textSecondary.opacity(0.8)).fixedSize(horizontal: false, vertical: true)
            }
            .padding(10).frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }

    private func color(_ score: Int) -> Color { score < 15 ? .green : score < 40 ? .yellow : score < 70 ? .orange : .red }
}
