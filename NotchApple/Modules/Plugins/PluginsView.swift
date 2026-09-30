//
//  PluginsView.swift
//  Notch apple
//
//  Plugins: your own notch widgets, in any language. Every script in
//  ~/Library/Application Support/Notch apple/Plugins runs and its output shows
//  as a card. The format is a simple, xbar-like one:
//
//    first line           → the card's headline
//    other lines          → body text
//    text | href=https:…  → a line you can click to open a link
//    text | run=command   → a line you can click to run a shell command
//
//  The refresh interval goes in the file name: weather.10m.sh, cpu.5s.py,
//  news.1h.rb (default 5 minutes). Scripts only run while the tab is open or
//  when their interval is due, and are stopped after 10 seconds.
//

import AppKit
import SwiftUI

@MainActor
final class PluginHost: ObservableObject {
    static let shared = PluginHost()

    struct Line: Identifiable, Hashable {
        let id = UUID()
        let text: String
        let href: URL?
        let run: String?
    }

    struct Plugin: Identifiable {
        var id: String { url.path }
        let url: URL
        let name: String
        let interval: TimeInterval
        var headline = "…"
        var lines: [Line] = []
        var lastRun = Date.distantPast
        var failed = false
    }

    @Published private(set) var plugins: [Plugin] = []
    private var timer: Timer?

    nonisolated static var folder: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("Notch apple/Plugins", isDirectory: true)
    }

    func start() {
        reload()
        guard timer == nil else { return }
        timer = Power.timer(1) { [weak self] in self?.runDue() }
    }

    func stop() { timer?.invalidate(); timer = nil }

    func reload() {
        try? FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
        let files = (try? FileManager.default.contentsOfDirectory(at: Self.folder, includingPropertiesForKeys: nil))?
            .filter { !$0.lastPathComponent.hasPrefix(".") }
            .sorted { $0.lastPathComponent < $1.lastPathComponent } ?? []
        plugins = files.map { url in
            let parts = url.deletingPathExtension().lastPathComponent.split(separator: ".")
            let interval = parts.count > 1 ? Self.parseInterval(String(parts.last!)) : nil
            return Plugin(url: url, name: String(parts.first ?? "Plugin").replacingOccurrences(of: "-", with: " ").capitalized,
                          interval: interval ?? 300)
        }
        runDue(force: true)
    }

    private static func parseInterval(_ s: String) -> TimeInterval? {
        guard let unit = s.last, let n = Double(s.dropLast()) else { return nil }
        switch unit {
        case "s": return max(1, n)
        case "m": return n * 60
        case "h": return n * 3600
        case "d": return n * 86400
        default: return nil
        }
    }

    private func runDue(force: Bool = false) {
        for i in plugins.indices where force || Date.now.timeIntervalSince(plugins[i].lastRun) >= plugins[i].interval {
            plugins[i].lastRun = .now
            let url = plugins[i].url
            Task.detached {
                let result = Self.execute(url)
                await MainActor.run { self.update(url, result) }
            }
        }
    }

    private func update(_ url: URL, _ result: (ok: Bool, output: String)) {
        guard let i = plugins.firstIndex(where: { $0.url == url }) else { return }
        let lines = result.output.split(separator: "\n", omittingEmptySubsequences: false).map(String.init).filter { $0 != "---" }
        plugins[i].failed = !result.ok
        plugins[i].headline = Self.parse(lines.first ?? "").text
        plugins[i].lines = lines.dropFirst().filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.map(Self.parse)
    }

    private static func parse(_ raw: String) -> Line {
        let parts = raw.components(separatedBy: " | ")
        var href: URL?, run: String?
        for p in parts.dropFirst() {
            if p.hasPrefix("href=") { href = URL(string: String(p.dropFirst(5))) }
            if p.hasPrefix("run=") { run = String(p.dropFirst(4)) }
        }
        return Line(text: parts[0], href: href, run: run)
    }

    nonisolated private static func execute(_ url: URL) -> (ok: Bool, output: String) {
        let p = Process()
        if FileManager.default.isExecutableFile(atPath: url.path) {
            p.executableURL = url
        } else {
            p.executableURL = URL(fileURLWithPath: "/bin/zsh")
            p.arguments = [url.path]
        }
        p.currentDirectoryURL = folder
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        env["NOTCH_APPLE"] = "1"
        p.environment = env
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        do { try p.run() } catch { return (false, "Couldn't run: \(error.localizedDescription)") }
        let killer = DispatchWorkItem { if p.isRunning { p.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + 10, execute: killer)
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        killer.cancel()
        return (p.terminationStatus == 0, String(decoding: data.prefix(20_000), as: UTF8.self))
    }

    func perform(_ line: Line) {
        if let href = line.href { NSWorkspace.shared.open(href); AppDelegate.current?.notch?.closeNotch() }
        if let run = line.run {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/bin/zsh")
            p.arguments = ["-c", run]
            try? p.run()
        }
    }

    /// Writes a small example plugin so people can see the format.
    func createExample() {
        let url = Self.folder.appendingPathComponent("hello.1m.sh")
        let script = """
        #!/bin/zsh
        # A Notch apple plugin. First line = headline, other lines = body.
        # Add " | href=https://…" to make a line a link, or " | run=command" to run something.
        echo "Uptime $(uptime | sed 's/.*up \\([^,]*\\),.*/\\1/')"
        echo "Logged in as $USER"
        echo "Disk: $(df -h / | awk 'NR==2 {print $4}') free"
        echo "Open the plugin folder | run=open \\"$HOME/Library/Application Support/Notch apple/Plugins\\""
        echo "Plugin guide | href=https://github.com/AdityaJainDXB/NotchApples#plugins"
        """
        try? FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
        try? script.write(to: url, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        reload()
    }
}

struct PluginsView: View {
    @StateObject private var host = PluginHost.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Plugins").sectionTitle()
                Text("Scripts in your Plugins folder").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                Spacer()
                Button("Add example") { host.createExample() }.buttonStyle(PurpleButtonStyle(prominent: false))
                Button { NSWorkspace.shared.open(PluginHost.folder); AppDelegate.current?.notch?.closeNotch() } label: {
                    Label("Open folder", systemImage: "folder")
                }
                .buttonStyle(PurpleButtonStyle(prominent: false))
                IconButton(systemImage: "arrow.clockwise", help: "Reload and run all") { host.reload() }
            }
            if host.plugins.isEmpty {
                Text("No plugins yet. Put a script (shell, Python, anything with a #! line) in the Plugins folder, or add the example. Its output shows here; the file name sets how often it runs, e.g. weather.10m.sh.")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 10)], spacing: 10) {
                        ForEach(host.plugins) { plugin in card(plugin) }
                    }
                }
            }
        }
        .onAppear { host.start() }
        .onDisappear { host.stop() }
    }

    private func card(_ plugin: PluginHost.Plugin) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(plugin.name).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                Spacer()
                if plugin.failed { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange).help("The script exited with an error") }
            }
            Text(plugin.headline).font(.system(size: 15, weight: .bold)).foregroundStyle(.white).lineLimit(2)
            ForEach(plugin.lines.prefix(6)) { line in
                if line.href != nil || line.run != nil {
                    Button { host.perform(line) } label: {
                        Label(line.text, systemImage: line.href != nil ? "link" : "play.fill").lineLimit(1)
                    }
                    .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(Theme.accentBright)
                } else {
                    Text(line.text).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).lineLimit(2)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, minHeight: 90, alignment: .topLeading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.separator))
    }
}
