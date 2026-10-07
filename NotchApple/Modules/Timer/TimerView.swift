//
//  TimerView.swift
//  Notch apple
//
//  The Timer tab: a countdown timer with presets and a stopwatch with laps.
//  While either runs, the time shows beside the closed notch, like the
//  Dynamic Island.
//

import AppKit
import SwiftUI

@MainActor
final class CountdownTimer: ObservableObject {
    static let shared = CountdownTimer()

    // Countdown
    @Published private(set) var duration: TimeInterval = 5 * 60
    @Published private(set) var remaining: TimeInterval = 5 * 60
    @Published private(set) var timerRunning = false
    private var timerEnd: Date?

    // Stopwatch
    @Published private(set) var elapsed: TimeInterval = 0
    @Published private(set) var stopwatchRunning = false
    @Published private(set) var laps: [TimeInterval] = []
    private var stopwatchStart: Date?
    private var accumulated: TimeInterval = 0

    private var ticker: Timer?

    var liveActivity: LiveActivity? {
        if timerRunning {
            return LiveActivity(symbol: "timer", label: Self.short(remaining), tint: remaining <= 10 ? .systemOrange : .systemYellow)
        }
        if stopwatchRunning {
            return LiveActivity(symbol: "stopwatch", label: Self.short(elapsed), tint: .systemTeal)
        }
        return nil
    }

    // MARK: Countdown

    func startTimer(seconds: TimeInterval? = nil) {
        if let seconds { duration = max(1, seconds); remaining = duration }
        if remaining <= 0 { remaining = duration }
        timerEnd = .now.addingTimeInterval(remaining)
        timerRunning = true
        ensureTicker()
    }

    func pauseTimer() {
        tick()
        timerRunning = false
        timerEnd = nil
        LiveActivityCenter.shared.recompute()
    }

    func resetTimer() {
        timerRunning = false
        timerEnd = nil
        remaining = duration
        LiveActivityCenter.shared.recompute()
    }

    func add(seconds: TimeInterval) {
        if timerRunning, let end = timerEnd { timerEnd = end.addingTimeInterval(seconds); tick() }
        else { remaining = max(1, remaining + seconds); duration = max(duration, remaining) }
    }

    var progress: Double { duration > 0 ? 1 - remaining / duration : 0 }

    // MARK: Stopwatch

    func startStopwatch() {
        guard !stopwatchRunning else { return }
        stopwatchStart = .now
        stopwatchRunning = true
        ensureTicker()
    }

    func pauseStopwatch() {
        guard stopwatchRunning, let start = stopwatchStart else { return }
        accumulated += Date.now.timeIntervalSince(start)
        elapsed = accumulated
        stopwatchStart = nil
        stopwatchRunning = false
        LiveActivityCenter.shared.recompute()
    }

    func lap() { laps.insert(elapsed, at: 0) }

    func resetStopwatch() {
        stopwatchRunning = false
        stopwatchStart = nil
        accumulated = 0
        elapsed = 0
        laps = []
        LiveActivityCenter.shared.recompute()
    }

    // MARK: Ticking

    private func ensureTicker() {
        guard ticker == nil else { return }
        // Twice a second is enough for a seconds display; the end time is exact regardless.
        let t = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.tick() } }
        t.tolerance = 0.1
        RunLoop.main.add(t, forMode: .common)
        ticker = t
        tick()
    }

    private func tick() {
        if timerRunning, let end = timerEnd {
            remaining = max(0, end.timeIntervalSinceNow)
            if remaining <= 0 { finish() }
        }
        if stopwatchRunning, let start = stopwatchStart { elapsed = accumulated + Date.now.timeIntervalSince(start) }
        if !timerRunning && !stopwatchRunning { ticker?.invalidate(); ticker = nil }
        LiveActivityCenter.shared.recompute()
    }

    private func finish() {
        timerRunning = false
        timerEnd = nil
        remaining = duration
        NSSound(named: "Glass")?.play()
        LiveActivityCenter.shared.flash(LiveActivity(symbol: "bell.fill", label: "Done", tint: .systemYellow), seconds: 6)
        Notifier.post(title: "Timer done", body: "Your \(Self.long(duration)) timer has finished.")
    }

    // MARK: Formatting

    /// Fits the notch ear: "4:59", "59:59", then "1h05".
    static func short(_ t: TimeInterval) -> String {
        let s = max(0, Int(t.rounded(.up)))
        if s >= 3600 { return String(format: "%dh%02d", s / 3600, s % 3600 / 60) }
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    static func long(_ t: TimeInterval, hundredths: Bool = false) -> String {
        let total = max(0, t)
        let s = Int(total)
        let base = s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s % 3600 / 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
        guard hundredths else { return base }
        return base + String(format: ".%02d", Int((total - Double(s)) * 100))
    }
}

struct TimerView: View {
    @StateObject private var timer = CountdownTimer.shared
    @State private var customMinutes = 20

    @AppStorage("timer.page") private var page = "timer"
    @ObservedObject private var entitlements = Entitlements.shared

    private let presets: [(String, Double)] = [("1 min", 1), ("3 min", 3), ("5 min", 5), ("10 min", 10), ("15 min", 15), ("30 min", 30), ("45 min", 45), ("1 hr", 60)]

    var body: some View {
        VStack(spacing: 8) {
            Picker("", selection: $page) {
                Text("Timer").tag("timer")
                Text("Named").tag("named")
            }
            .pickerStyle(.segmented).labelsHidden().frame(width: 200)
            if page == "named" {
                GlassCard {
                    if entitlements.canUse(.namedTimers) {
                        NamedTimersView()
                    } else {
                        HStack(spacing: 8) {
                            TierBadge(tier: .pro)
                            Text(Feature.namedTimers.benefit).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                        }
                    }
                }
            } else {
                classic
            }
        }
    }

    private var classic: some View {
        HStack(spacing: 12) {
            GlassCard {
                HStack(spacing: 18) {
                    ZStack {
                        Circle().stroke(Theme.surface, lineWidth: 10)
                        Circle().trim(from: 0, to: timer.progress)
                            .stroke(Theme.accentGradient, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                            .animation(.linear(duration: 0.25), value: timer.progress)
                        Text(CountdownTimer.long(timer.remaining))
                            .font(.system(size: 30, weight: .bold, design: .rounded)).monospacedDigit()
                            .foregroundStyle(.white).contentTransition(.numericText())
                    }
                    .frame(width: 150, height: 150)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Timer").sectionTitle()
                        LazyVGrid(columns: Array(repeating: GridItem(.fixed(58), spacing: 6), count: 4), spacing: 6) {
                            ForEach(presets, id: \.0) { preset in
                                Button(preset.0) { timer.startTimer(seconds: preset.1 * 60) }
                                    .buttonStyle(PurpleButtonStyle(prominent: false)).font(.system(size: 11))
                            }
                        }
                        HStack(spacing: 6) {
                            Stepper("\(customMinutes) min", value: $customMinutes, in: 1...600)
                                .font(.system(size: 12)).foregroundStyle(.white)
                            Button("Start") { timer.startTimer(seconds: Double(customMinutes) * 60) }
                                .buttonStyle(PurpleButtonStyle(prominent: false))
                        }
                        HStack(spacing: 6) {
                            Button { timer.timerRunning ? timer.pauseTimer() : timer.startTimer() } label: {
                                Label(timer.timerRunning ? "Pause" : "Resume", systemImage: timer.timerRunning ? "pause.fill" : "play.fill")
                            }
                            .buttonStyle(PurpleButtonStyle())
                            Button("+1 min") { timer.add(seconds: 60) }.buttonStyle(PurpleButtonStyle(prominent: false))
                            Button("Reset", action: timer.resetTimer).buttonStyle(PurpleButtonStyle(prominent: false))
                        }
                    }
                }
            }

            GlassCard {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Stopwatch").sectionTitle()
                    Text(CountdownTimer.long(timer.elapsed, hundredths: true))
                        .font(.system(size: 30, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(.white)
                    HStack(spacing: 6) {
                        Button { timer.stopwatchRunning ? timer.pauseStopwatch() : timer.startStopwatch() } label: {
                            Label(timer.stopwatchRunning ? "Stop" : "Start", systemImage: timer.stopwatchRunning ? "pause.fill" : "play.fill")
                        }
                        .buttonStyle(PurpleButtonStyle())
                        Button(timer.stopwatchRunning ? "Lap" : "Reset") {
                            timer.stopwatchRunning ? timer.lap() : timer.resetStopwatch()
                        }
                        .buttonStyle(PurpleButtonStyle(prominent: false))
                    }
                    ScrollView {
                        VStack(alignment: .leading, spacing: 3) {
                            ForEach(Array(timer.laps.enumerated()), id: \.offset) { i, lap in
                                HStack {
                                    Text("Lap \(timer.laps.count - i)").foregroundStyle(Theme.textSecondary)
                                    Spacer()
                                    Text(CountdownTimer.long(lap, hundredths: true)).monospacedDigit().foregroundStyle(.white)
                                }
                                .font(.system(size: 12))
                            }
                        }
                    }
                }
            }
            .frame(width: 230)
        }
    }
}
