//
//  NotchAISkillLogic.swift
//  Notch Apple
//
//  Skills: plain Markdown files the user (or anyone) drops in a folder, each with a small header saying what it is
//  for and which apps it applies to. When the user is in a matching app, its instructions are added to the model's
//  instructions. No code runs: a skill is text. This file parses them and matches them; unit tested.
//
//  File format:
//      ---
//      name: Xcode helper
//      description: How I like Swift errors explained
//      apps: com.apple.dt.Xcode, com.apple.dt.Xcode.preview
//      ---
//      Explain compiler errors step by step and show the smallest fix.
//
//  An empty or missing `apps` line means the skill applies everywhere.
//

import Foundation

struct NotchAISkill: Identifiable, Equatable {
    var id: String { fileName }
    var fileName: String
    var name: String
    var description: String
    var apps: [String]
    var instructions: String
    var enabled = true
}

enum NotchAISkillLogic {
    static let maxInstructionLength = 4_000

    /// Parses one skill file. Nil if it has no instructions.
    static func parse(_ text: String, fileName: String) -> NotchAISkill? {
        var name = (fileName as NSString).deletingPathExtension, description = "", apps: [String] = []
        var body = text
        let lines = text.components(separatedBy: "\n")
        if lines.first?.trimmingCharacters(in: .whitespaces) == "---", let end = lines.dropFirst().firstIndex(where: { $0.trimmingCharacters(in: .whitespaces) == "---" }) {
            for line in lines[1..<end] {
                guard let colon = line.firstIndex(of: ":") else { continue }
                let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
                let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                switch key {
                case "name": if !value.isEmpty { name = value }
                case "description": description = value
                case "apps": apps = value.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
                default: break
                }
            }
            body = lines[(end + 1)...].joined(separator: "\n")
        }
        let instructions = String(body.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxInstructionLength))
        guard !instructions.isEmpty else { return nil }
        return NotchAISkill(fileName: fileName, name: name, description: description, apps: apps, instructions: instructions)
    }

    static func applies(_ skill: NotchAISkill, bundleID: String?) -> Bool {
        guard skill.enabled else { return false }
        if skill.apps.isEmpty { return true }
        guard let id = bundleID?.lowercased() else { return false }
        return skill.apps.contains(id)
    }

    /// The model's instructions with the skills that apply to the app in front.
    static func systemPrompt(base: String, skills: [NotchAISkill], bundleID: String?) -> String {
        let active = skills.filter { applies($0, bundleID: bundleID) }
        guard !active.isEmpty else { return base }
        return base + "\n\nSkills that apply right now (follow them when relevant):\n"
            + active.map { "## \($0.name)\n\($0.instructions)" }.joined(separator: "\n\n")
    }
}
