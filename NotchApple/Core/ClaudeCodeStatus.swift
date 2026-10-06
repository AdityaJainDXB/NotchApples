//
//  ClaudeCodeStatus.swift
//  Notch apple
//
//  A small status dot for long-running Claude Code work. Claude Code's hooks run `open -g "notchapple://claude-code?status=…"`:
//    green  for 4 seconds when a task finishes,
//    yellow for 4 seconds when it needs your input or approval (or finished with warnings or errors).
//  The dot shows beside the closed notch and in the open notch's header, then fades out. Nothing leaves your Mac.
//

import AppKit
import SwiftUI

@MainActor
final class ClaudeCodeStatus: ObservableObject {
    static let shared = ClaudeCodeStatus()

    @Published private(set) var dot: ClaudeCodeDot?
    private var hideWork: DispatchWorkItem?

    /// From notchapple://claude-code?status=…
    func handle(_ status: String?) {
        guard SettingsManager.shared.claudeCodeDot, let dot = ClaudeCodeStatusLogic.dot(for: status) else { return }
        show(dot)
    }

    func show(_ new: ClaudeCodeDot) {
        withAnimation(.easeOut(duration: 0.2)) { dot = new }
        // Beside the closed notch: the notch's own "ear" dot.
        LiveActivityCenter.shared.flash(LiveActivity(symbol: nil, label: nil, tint: new.nsColor, dotOnly: true), seconds: ClaudeCodeStatusLogic.seconds)
        hideWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            withAnimation(.easeOut(duration: 0.5)) { self?.dot = nil }   // fades out
        }
        hideWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + ClaudeCodeStatusLogic.seconds, execute: work)
    }

    // MARK: Hooks in Claude Code's own settings

    static var claudeSettingsURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/settings.json")
    }

    static var hooksInstalled: Bool {
        guard let data = try? Data(contentsOf: claudeSettingsURL),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return false }
        return ClaudeCodeStatusLogic.isInstalled(in: json)
    }

    /// Adds the two hooks to ~/.claude/settings.json, after saving a copy next to it. Returns a message for the user.
    static func installHooks() -> String {
        let url = claudeSettingsURL
        let fm = FileManager.default
        var json: [String: Any] = [:]
        if fm.fileExists(atPath: url.path) {
            guard let data = try? Data(contentsOf: url), let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                return "Couldn't read ~/.claude/settings.json (is it valid JSON?). Nothing was changed. Use Copy instead."
            }
            json = parsed
            try? fm.copyItem(at: url, to: url.deletingLastPathComponent().appendingPathComponent("settings.json.notch-backup"))
        } else {
            try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        }
        let merged = ClaudeCodeStatusLogic.merging(into: json)
        guard let out = try? JSONSerialization.data(withJSONObject: merged, options: [.prettyPrinted, .sortedKeys]) else { return "Couldn't prepare the settings." }
        do { try out.write(to: url, options: .atomic) } catch { return "Couldn't write ~/.claude/settings.json: \(error.localizedDescription)" }
        return "Added. New Claude Code sessions will light the dot. A copy of your old settings is next to the file (settings.json.notch-backup)."
    }
}

extension ClaudeCodeDot {
    var nsColor: NSColor { self == .green ? .systemGreen : .systemYellow }
    var color: Color { self == .green ? .green : .yellow }
}

/// The dot in the open notch's header. It takes no space while there is nothing to show.
struct ClaudeCodeDotView: View {
    @ObservedObject private var status = ClaudeCodeStatus.shared

    var body: some View {
        if let dot = status.dot {
            Circle().fill(dot.color).frame(width: 9, height: 9)
                .shadow(color: dot.color.opacity(0.8), radius: 5)
                .padding(.horizontal, 4)
                .transition(.opacity.combined(with: .scale(scale: 0.6)))
                .help(dot == .green ? "Claude Code finished" : "Claude Code needs you")
                .accessibilityLabel(dot == .green ? "Claude Code finished" : "Claude Code needs your attention")
        }
    }
}
