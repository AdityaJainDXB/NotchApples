//
//  LyricsModel.swift
//  Notch apple
//
//  Synced lyrics for the Now Playing tab. Lyrics come from LRCLIB (free, no
//  account); the playback position is read from Music or Spotify with
//  AppleScript, only while the Now Playing tab is open.
//

import AppKit
import SwiftUI

@MainActor
final class LyricsModel: ObservableObject {
    static let shared = LyricsModel()

    struct Line: Equatable { let time: TimeInterval; let text: String }

    @Published private(set) var lines: [Line] = []
    @Published private(set) var plain: String?
    @Published private(set) var currentIndex: Int?
    @Published private(set) var status = ""
    private var loadedKey = ""
    private var timer: Timer?

    func start() {
        guard timer == nil else { return }
        let t = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.tick() } }
        t.tolerance = 0.1
        RunLoop.main.add(t, forMode: .common)
        timer = t
        tick()
    }

    func stop() { timer?.invalidate(); timer = nil }

    private func tick() {
        guard let now = NowPlayingMonitor.shared.current, !now.title.isEmpty else { return }
        let key = "\(now.artist)|\(now.title)"
        if key != loadedKey { load(title: now.title, artist: now.artist, key: key) }
        guard !lines.isEmpty, now.isPlaying else { return }
        let source = now.source
        Task.detached {
            let position = Self.position(source: source)
            await MainActor.run {
                guard let position else { return }
                let idx = self.lines.lastIndex { $0.time <= position + 0.3 }
                if idx != self.currentIndex { withAnimation(.easeOut(duration: 0.25)) { self.currentIndex = idx } }
            }
        }
    }

    private func load(title: String, artist: String, key: String) {
        loadedKey = key
        lines = []
        plain = nil
        currentIndex = nil
        status = "Finding lyrics…"
        Task {
            var comps = URLComponents(string: "https://lrclib.net/api/get")!
            comps.queryItems = [.init(name: "track_name", value: title), .init(name: "artist_name", value: artist)]
            var request = URLRequest(url: comps.url!)
            request.setValue("Notch apple (https://github.com/AdityaJainDXB/NotchApples)", forHTTPHeaderField: "User-Agent")
            struct Resp: Decodable { let syncedLyrics: String?; let plainLyrics: String?; let instrumental: Bool? }
            guard key == loadedKey else { return }
            if let (data, response) = try? await URLSession.shared.data(for: request),
               (response as? HTTPURLResponse)?.statusCode == 200,
               let r = try? JSONDecoder().decode(Resp.self, from: data) {
                guard key == loadedKey else { return }
                lines = Self.parse(r.syncedLyrics ?? "")
                plain = lines.isEmpty ? r.plainLyrics : nil
                status = r.instrumental == true ? "Instrumental" : (lines.isEmpty && plain == nil ? "No lyrics found" : "")
            } else if key == loadedKey {
                status = "No lyrics found"
            }
        }
    }

    /// "[01:23.45] words" → (83.45, "words")
    private static func parse(_ lrc: String) -> [Line] {
        lrc.split(separator: "\n").compactMap { raw in
            let s = String(raw)
            guard s.hasPrefix("["), let close = s.firstIndex(of: "]") else { return nil }
            let stamp = s[s.index(after: s.startIndex)..<close].split(separator: ":")
            guard stamp.count == 2, let m = Double(stamp[0]), let sec = Double(stamp[1]) else { return nil }
            return Line(time: m * 60 + sec, text: s[s.index(after: close)...].trimmingCharacters(in: .whitespaces))
        }
    }

    nonisolated private static func position(source: String) -> TimeInterval? {
        let app = source == "Spotify" ? "Spotify" : "Music"
        let script = "if application \"\(app)\" is running then tell application \"\(app)\" to return player position"
        var error: NSDictionary?
        let result = NSAppleScript(source: script)?.executeAndReturnError(&error)
        return error == nil ? result?.doubleValue : nil
    }
}

struct LyricsPanel: View {
    @StateObject private var lyrics = LyricsModel.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if !lyrics.lines.isEmpty {
                let i = lyrics.currentIndex ?? -1
                ForEach(max(i - 1, 0)..<min(max(i - 1, 0) + 4, lyrics.lines.count), id: \.self) { n in
                    Text(lyrics.lines[n].text.isEmpty ? "♪" : lyrics.lines[n].text)
                        .font(.system(size: n == i ? 16 : 13, weight: n == i ? .bold : .regular))
                        .foregroundStyle(n == i ? .white : Theme.textSecondary)
                        .lineLimit(2)
                }
            } else if let plain = lyrics.plain {
                ScrollView { Text(plain).font(.system(size: 12)).foregroundStyle(Theme.textSecondary) }
            } else if !lyrics.status.isEmpty {
                Text(lyrics.status).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { lyrics.start() }
        .onDisappear { lyrics.stop() }
    }
}
