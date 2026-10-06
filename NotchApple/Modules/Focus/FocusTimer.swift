//
//  FocusTimer.swift
//  Notch apple
//
//  A Pomodoro-style focus timer. Work and break sessions alternate; while a
//  session runs, the closed notch shows the countdown (see LiveActivity.swift),
//  and a notification + sound mark the end of each session.
//

import AppKit
import SwiftUI
import UserNotifications

@MainActor
final class FocusTimer: ObservableObject {
    static let shared = FocusTimer()

    enum Phase: String { case focus = "Focus", shortBreak = "Break", longBreak = "Long break" }

    @AppStorage("focus.workMinutes") var workMinutes = 25
    @AppStorage("focus.breakMinutes") var breakMinutes = 5
    @AppStorage("focus.longBreakMinutes") var longBreakMinutes = 15
    @AppStorage("focus.autoStartNext") var autoStartNext = false
    @AppStorage("focus.completedToday") private var completedToday = 0
    @AppStorage("focus.completedDay") private var completedDay = ""
    /// Shortcuts run when a focus session starts and stops (e.g. turn Do Not Disturb on / off).
    @AppStorage("focus.dndOnShortcut") var dndOnShortcut = ""
    @AppStorage("focus.dndOffShortcut") var dndOffShortcut = ""
    /// Focus minutes per day ("2026-09-30": 75), for the weekly chart.
    @AppStorage("focus.history") private var historyData = Data()
    private var dndActive = false

    var history: [String: Int] { (try? JSONDecoder().decode([String: Int].self, from: historyData)) ?? [:] }

    /// The last 7 days, oldest first.
    var lastWeek: [(day: Date, minutes: Int)] {
        let h = history
        return (0..<7).reversed().map { back in
            let d = Calendar.current.date(byAdding: .day, value: -back, to: .now)!
            return (d, h[d.formatted(.iso8601.year().month().day())] ?? 0)
        }
    }

    /// Minutes of focus you want each day (0 = no goal), and how many you've done today.
    @AppStorage("focus.goal") var dailyGoal = 0
    var minutesToday: Int { history[today] ?? 0 }

    private func logMinutes(_ minutes: Int) {
        var h = history
        let before = h[today] ?? 0
        h[today, default: 0] += minutes
        if dailyGoal > 0, before < dailyGoal, before + minutes >= dailyGoal { Notifier.post(title: "Daily focus goal reached", body: "\(dailyGoal) minutes of focus today. Nice work.") }
        // Keep about two months.
        if h.count > 60 { for key in h.keys.sorted().prefix(h.count - 60) { h[key] = nil } }
        historyData = (try? JSONEncoder().encode(h)) ?? Data()
    }

    private func setDND(_ on: Bool) {
        guard on != dndActive else { return }
        dndActive = on
        ShortcutsModel.runQuietly(on ? dndOnShortcut : dndOffShortcut)
    }

    @Published private(set) var phase: Phase = .focus
    @Published private(set) var remaining: TimeInterval = 25 * 60
    @Published private(set) var isRunning = false
    /// Focus sessions finished today (resets at midnight).
    @Published private(set) var sessionsToday = 0

    private var endDate: Date?
    private var ticker: Timer?

    init() {
        remaining = TimeInterval(workMinutes * 60)
        sessionsToday = today == completedDay ? completedToday : 0
    }

    private var today: String { Date.now.formatted(.iso8601.year().month().day()) }

    var duration: TimeInterval {
        switch phase {
        case .focus: TimeInterval(workMinutes * 60)
        case .shortBreak: TimeInterval(breakMinutes * 60)
        case .longBreak: TimeInterval(longBreakMinutes * 60)
        }
    }

    var progress: Double { duration > 0 ? 1 - remaining / duration : 0 }

    static func format(_ t: TimeInterval) -> String {
        let s = max(0, Int(t.rounded(.up)))
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    /// What the closed notch shows while a session is running.
    var liveActivity: LiveActivity? {
        guard isRunning else { return nil }
        return LiveActivity(symbol: phase == .focus ? "timer" : "cup.and.saucer.fill",
                            label: Self.format(remaining),
                            tint: phase == .focus ? NSColor(Theme.accentBright) : .systemGreen)
    }

    // MARK: Controls

    func start() {
        guard !isRunning else { return }
        if remaining <= 0 { remaining = duration }
        endDate = Date.now.addingTimeInterval(remaining)
        isRunning = true
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        ticker?.tolerance = 0.1
        LiveActivityCenter.shared.recompute()
        requestNotificationPermission()
        setDND(phase == .focus)
    }

    func pause() {
        guard isRunning else { return }
        tick()
        isRunning = false
        ticker?.invalidate()
        endDate = nil
        LiveActivityCenter.shared.recompute()
        setDND(false)
    }

    func reset() {
        pause()
        remaining = duration
    }

    /// Jump to a phase (e.g. start a break early).
    func switchTo(_ newPhase: Phase) {
        pause()
        phase = newPhase
        remaining = duration
    }

    func skip() { finishPhase(notify: false) }

    // MARK: Ticking

    private func tick() {
        guard let endDate else { return }
        remaining = max(0, endDate.timeIntervalSinceNow)
        if remaining <= 0 { finishPhase(notify: true) }
        LiveActivityCenter.shared.recompute()
    }

    private func finishPhase(notify: Bool) {
        let finished = phase
        ticker?.invalidate()
        isRunning = false
        endDate = nil
        setDND(false)
        if finished == .focus {
            if notify { logMinutes(workMinutes) }
            if completedDay != today { completedDay = today; completedToday = 0 }
            completedToday += 1
            sessionsToday = completedToday
            // Every 4th focus session earns a long break.
            phase = completedToday % 4 == 0 ? .longBreak : .shortBreak
        } else {
            phase = .focus
        }
        remaining = duration
        if notify { announce(finished) }
        LiveActivityCenter.shared.recompute()
        if autoStartNext { start() }
    }

    private func announce(_ finished: Phase) {
        NSSound(named: "Glass")?.play()
        let content = UNMutableNotificationContent()
        content.title = finished == .focus ? "Focus session done 🎉" : "Break's over"
        content.body = finished == .focus
            ? "Time for a \(phase == .longBreak ? "\(longBreakMinutes)" : "\(breakMinutes)")-minute break."
            : "Ready for another \(workMinutes)-minute focus session?"
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }

    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            guard settings.authorizationStatus == .notDetermined else { return }
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
    }
}
