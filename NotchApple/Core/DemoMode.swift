//
//  DemoMode.swift
//  Notch apple
//
//  Sample data for README screenshots, so they never show anyone's real
//  clipboard, chats, notes, apps or Mac name. Only on when launched with
//  `-demoMode YES`; nothing is read from or saved to disk while it's on.
//

import Foundation

enum DemoMode {
    static let isOn = UserDefaults.standard.bool(forKey: "demoMode")
        && ProcessInfo.processInfo.arguments.contains("-demoMode")

    static let deviceName = "MacBook Air"

    static func minutesAgo(_ m: Double) -> Date { Date().addingTimeInterval(-m * 60) }

    static var clipboard: [ClipItem] {
        [
            ClipItem(kind: .link, text: "https://github.com/AdityaJainDXB/NotchApples", sourceApp: "Safari", date: minutesAgo(1), pinned: true),
            ClipItem(kind: .text, text: "Meeting moved to 3:30 — same room.", sourceApp: "Messages", date: minutesAgo(4)),
            ClipItem(kind: .text, text: "brew install --cask notch-apple", sourceApp: "Terminal", date: minutesAgo(9)),
            ClipItem(kind: .files, filePaths: ["/Users/demo/Desktop/Slides.key"], sourceApp: "Finder", date: minutesAgo(22)),
            ClipItem(kind: .text, text: "The quick brown fox jumps over the lazy dog.", sourceApp: "Notes", date: minutesAgo(40)),
            ClipItem(kind: .link, text: "https://developer.apple.com/design/human-interface-guidelines", sourceApp: "Safari", date: minutesAgo(65)),
        ]
    }

    static var chats: [ChatSession] {
        func msg(_ role: String, _ text: String, _ m: Double, model: String? = nil, shot: Bool = false) -> ChatSession.Message {
            .init(role: role, text: text, hadScreenshot: shot, date: minutesAgo(m), model: model)
        }
        return [
            ChatSession(provider: "gemini", model: "gemini-2.5-flash", started: minutesAgo(12), updated: minutesAgo(10), messages: [
                msg("user", "Give me three ideas for a weekend project.", 12),
                msg("assistant", "1. A tiny weather widget for your desktop.\n2. A habit tracker that lives in the menu bar.\n3. A photo booth app that turns snapshots into stickers.", 11.5, model: "gemini-2.5-flash"),
                msg("user", "Which is the quickest to build?", 10.5),
                msg("assistant", "The menu-bar habit tracker: one list, a checkbox per day, and a streak counter. An afternoon in SwiftUI.", 10, model: "gemini-2.5-flash"),
            ]),
            ChatSession(provider: "groq", model: "llama-3.3-70b-versatile", started: minutesAgo(90), updated: minutesAgo(88), messages: [
                msg("user", "Explain what a Pomodoro timer is in one sentence.", 90),
                msg("assistant", "It's a time-management method: 25 minutes of focused work, then a 5-minute break, repeated.", 88, model: "llama-3.3-70b-versatile"),
            ]),
            ChatSession(provider: "openRouter", model: "qwen/qwen3-32b:free", started: minutesAgo(300), updated: minutesAgo(298), messages: [
                msg("user", "What's on my screen?", 300, shot: true),
                msg("assistant", "You have a Keynote presentation open on a slide titled \"Q3 roadmap\", with three milestones in a timeline.", 298, model: "qwen/qwen3-32b:free"),
            ]),
        ]
    }

    static var notes: [Note] {
        [
            Note(text: "Weekend\n• Farmers market, 9 am\n• Call the bike shop\n• Finish the book club chapter", updated: minutesAgo(3)),
            Note(text: "App ideas\nMenu-bar habit tracker with streaks.", updated: minutesAgo(120)),
            Note(text: "Groceries\nOat milk, lemons, basil, pasta", updated: minutesAgo(1500)),
        ]
    }

    static var appVolumes: [AppVolume] {
        [
            AppVolume(bundleID: "com.apple.Music", name: "Music", pid: -1, level: 100),
            AppVolume(bundleID: "com.apple.Safari", name: "Safari", pid: -1, level: 70),
            AppVolume(bundleID: "com.apple.FaceTime", name: "FaceTime", pid: -1, level: 120),
            AppVolume(bundleID: "com.apple.podcasts", name: "Podcasts", pid: -1, level: 85),
            AppVolume(bundleID: "com.apple.TV", name: "TV", pid: -1, level: 100),
        ]
    }

    static var layouts: [SavedLayout] {
        [
            SavedLayout(name: "Coding", entries: [
                .init(bundleID: "com.apple.dt.Xcode", appName: "Xcode", title: "", x: 0, y: 0, width: 1, height: 1),
                .init(bundleID: "com.apple.Safari", appName: "Safari", title: "", x: 0, y: 0, width: 1, height: 1),
                .init(bundleID: "com.apple.Terminal", appName: "Terminal", title: "", x: 0, y: 0, width: 1, height: 1),
            ]),
            SavedLayout(name: "Writing", entries: [
                .init(bundleID: "com.apple.Pages", appName: "Pages", title: "", x: 0, y: 0, width: 1, height: 1),
                .init(bundleID: "com.apple.Notes", appName: "Notes", title: "", x: 0, y: 0, width: 1, height: 1),
            ]),
        ]
    }
}
