//
//  NotchAIResearchView.swift
//  Notch Apple
//
//  The Research section (Pro): ask a question about web pages you name, or about a file you choose. Shows exactly
//  which sources were read and which failed. Answers appear in Chat, with [1], [2] citations from those sources.
//

import SwiftUI

struct NotchAIResearchView: View {
    @ObservedObject private var agent = ResearchAgent.shared
    @State private var question = ""
    @State private var urls = ""
    private var unlocked: Bool { NotchAITier.allows(.pro) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if !unlocked { Label(NotchAITier.lockedMessage(.pro), systemImage: "lock.fill").font(.system(size: 11)).foregroundStyle(.orange) }
                Text("Web pages").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                TextField("Paste one or more web addresses (https://…)", text: $urls).textFieldStyle(.roundedBorder)
                TextField("Your question about them", text: $question).textFieldStyle(.roundedBorder).onSubmit(research)
                HStack {
                    Button("Read pages and answer") { research() }.disabled(!unlocked)
                }
                Divider().opacity(0.3)
                Text("A file").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                HStack {
                    Button("Choose a file…") { agent.chooseFile() }.disabled(!unlocked)
                    Text(agent.pickedFile?.lastPathComponent ?? "None chosen").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Button(question.isEmpty ? "Summarise it" : "Ask about it") { agent.askAboutFile(question: question) }
                        .disabled(!unlocked || agent.pickedFile == nil)
                }
                if let s = agent.status { Text(s).font(.system(size: 11)).foregroundStyle(.orange) }
                Text("Pages are fetched from the public web only. Files are only read, never changed. Each question runs as a task you can watch in Tasks; answers use only the sources it read and cite them; if they don't answer, NotchAI says so. There is no built-in web search yet.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private func research() { agent.research(question: question, urlText: urls) }
}
