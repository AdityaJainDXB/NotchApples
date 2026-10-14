//
//  FeedbackView.swift
//  Notch Apple
//
//  The feedback card: shown in the open notch every three to four weeks (and from Settings → Help & Feedback).
//  An idea, a problem or praise, typed by the person and sent only when they press Send. Not now skips it.
//

import SwiftUI

struct FeedbackView: View {
    @ObservedObject private var insights = Insights.shared
    @State private var kind: Insights.Kind = .idea
    @State private var text = ""
    @State private var count = false
    @State private var sending = false
    @State private var problem: String?
    @State private var thanks = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if thanks {
                Spacer()
                Image(systemName: "heart.fill").font(.system(size: 28)).foregroundStyle(Theme.accentBright).frame(maxWidth: .infinity)
                Text("Thank you").font(.system(size: 16, weight: .bold)).frame(maxWidth: .infinity)
                Text("It goes straight to the people who build Notch Apple.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary).frame(maxWidth: .infinity)
                Spacer()
            } else {
                Text("How is Notch Apple going?").font(.system(size: 15, weight: .bold))
                Text("Tell us an idea, a problem, or what you like. It takes a minute and goes straight to the people who build it.")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                Picker("Kind", selection: $kind) {
                    ForEach(Insights.Kind.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented).labelsHidden()
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $text)
                        .font(.system(size: 12)).scrollContentBackground(.hidden).padding(6)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .onChange(of: text) { _, new in if new.count > 1000 { text = String(new.prefix(1000)) } }
                    if text.isEmpty { Text(kind.prompt).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).padding(.horizontal, 11).padding(.vertical, 14).allowsHitTesting(false) }
                }
                .frame(minHeight: 70)
                if insights.choice.isEmpty {
                    Toggle(isOn: $count) {
                        Text("Also count this Mac, anonymously (app version, macOS version and plan; no name, email or address). Change it any time in Settings → Privacy.")
                            .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                    .toggleStyle(.checkbox)
                }
                if let problem { Text(problem).font(.system(size: 11)).foregroundStyle(.orange) }
                HStack {
                    Button("Not now") { insights.dismissSurvey() }.buttonStyle(PurpleButtonStyle(prominent: false)).controlSize(.small)
                    Spacer()
                    Text("\(text.count)/1000").font(.system(size: 10)).foregroundStyle(Theme.textSecondary).monospacedDigit()
                    Button(sending ? "Sending…" : "Send") { send() }
                        .buttonStyle(PurpleButtonStyle(prominent: true)).controlSize(.small)
                        .disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
                }
            }
        }
        .padding(.horizontal, 6)
    }

    private func send() {
        sending = true; problem = nil
        Task {
            let result = await insights.send(kind, text: text)
            sending = false
            if let result { problem = result; return }
            if insights.choice.isEmpty { insights.setSharing(count) }
            thanks = true
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            insights.dismissSurvey()
        }
    }
}
