//
//  NotchAISkills.swift
//  Notch Apple
//
//  Loads skills from ~/Library/Application Support/Notch apple/NotchAI Skills/*.md (the folder is created on first
//  use) and adds the matching ones to the model's instructions. A skill is only text; nothing it says runs. The
//  user can switch each skill off or open the folder. Skills are used only while "Use skills" is on (default on).
//

import AppKit
import SwiftUI

@MainActor
final class NotchAISkills: ObservableObject {
    static let shared = NotchAISkills()

    @Published private(set) var skills: [NotchAISkill] = []
    @AppStorage("notchai.skills.use") var useSkills = true { willSet { objectWillChange.send() } }
    @AppStorage("notchai.skills.off") private var disabledJSON = "[]"

    let folder: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Notch apple/NotchAI Skills", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private init() { reload() }

    private var disabled: Set<String> {
        get { Set((try? JSONDecoder().decode([String].self, from: Data(disabledJSON.utf8))) ?? []) }
        set { disabledJSON = String(decoding: (try? JSONEncoder().encode(Array(newValue))) ?? Data("[]".utf8), as: UTF8.self) }
    }

    func reload() {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        skills = files.filter { $0.pathExtension.lowercased() == "md" }.sorted { $0.lastPathComponent < $1.lastPathComponent }.compactMap { url in
            guard let text = try? String(contentsOf: url, encoding: .utf8), var s = NotchAISkillLogic.parse(text, fileName: url.lastPathComponent) else { return nil }
            s.enabled = !disabled.contains(s.fileName)
            return s
        }
    }

    func setEnabled(_ skill: NotchAISkill, _ on: Bool) {
        var d = disabled
        if on { d.remove(skill.fileName) } else { d.insert(skill.fileName) }
        disabled = d
        reload()
    }

    func openFolder() { NSWorkspace.shared.open(folder) }

    /// Instructions for the app the user was just in.
    func systemPrompt(base: String) -> String {
        guard useSkills else { return base }
        return NotchAISkillLogic.systemPrompt(base: base, skills: skills, bundleID: ScreenIntelligence.shared.lastExternalApp?.bundleIdentifier)
    }
}

struct NotchAISkillsView: View {
    @ObservedObject private var skills = NotchAISkills.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Toggle("Use skills", isOn: $skills.useSkills).toggleStyle(.switch).controlSize(.small)
                    Spacer()
                    Button("Open skills folder") { skills.openFolder() }
                    Button("Reload") { skills.reload() }
                }
                if skills.skills.isEmpty {
                    Text("No skills yet. A skill is a Markdown file in the skills folder with a short header (name, description, apps). When you are in a matching app, its instructions are added to the model's. Skills are only text: nothing in them runs.")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
                ForEach(skills.skills) { s in
                    HStack(alignment: .top, spacing: 8) {
                        Toggle("", isOn: Binding(get: { s.enabled }, set: { skills.setEnabled(s, $0) })).labelsHidden().toggleStyle(.switch).controlSize(.mini)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                            if !s.description.isEmpty { Text(s.description).font(.system(size: 10)).foregroundStyle(Theme.textSecondary) }
                            Text(s.apps.isEmpty ? "Applies in every app" : "Apps: \(s.apps.joined(separator: ", "))")
                                .font(.system(size: 9, design: .monospaced)).foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                }
                Text("The matching skills go to the model you chose with each question, so with a cloud model they are sent too; Local first still applies.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
        }
        .onAppear { skills.reload() }
    }
}
