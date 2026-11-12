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
    @AppStorage(SearchEngineChoice.defaultsKey) private var engineRaw = SearchEngineChoice.duckDuckGo.rawValue
    @AppStorage(SearchEngineChoice.searxngKey) private var searxngURL = ""
    private var unlocked: Bool { NotchAITier.allows(.pro) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if !unlocked { Label(NotchAITier.lockedMessage(.pro), systemImage: "lock.fill").font(.system(size: 11)).foregroundStyle(.orange) }
                Text("Web pages").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                TextField("Web addresses (https://…), or leave empty to search the web", text: $urls).textFieldStyle(.roundedBorder)
                TextField("Your question about them", text: $question).textFieldStyle(.roundedBorder).onSubmit(research)
                HStack {
                    Button("Read pages and answer") { research() }.disabled(!unlocked)
                }
                Divider().opacity(0.3)
                Text("Search engine").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                Picker("", selection: $engineRaw) {
                    ForEach(SearchEngineChoice.allCases, id: \.rawValue) { Text($0.label).tag($0.rawValue) }
                }.labelsHidden().pickerStyle(.menu)
                if engineRaw == SearchEngineChoice.searxng.rawValue {
                    TextField("Your SearXNG address (for example search.example.org)", text: $searxngURL).textFieldStyle(.roundedBorder)
                }
                Text("When you search, your question is sent to the engine you picked here (not to the AI model). Nothing is searched until you ask.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
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
                Text("Pages are fetched from the public web only. Files are only read, never changed. Each question runs as a task you can watch in Tasks; answers use only the sources it read and cite them; if they don't answer, NotchAI says so.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private func research() { agent.research(question: question, urlText: urls) }
}
