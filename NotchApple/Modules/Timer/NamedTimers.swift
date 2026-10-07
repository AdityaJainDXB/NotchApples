//
//  NamedTimers.swift
//  Notch apple
//
//  Several named timers at once (Pro): type "Pasta 10m" or "Egg 1:30" and each one counts down on its own,
//  with a notification and a sound when it ends. They end at a fixed time, so they stay exact and survive a
//  relaunch. The main Timer tab keeps its single big timer; these are extra.
//

import AppKit
import SwiftUI

struct NamedTimer: Codable, Identifiable, Equatable {
    var id = UUID()
    var name: String
    var seconds: Int
    var endsAt: Date
    var done = false
}

@MainActor
final class NamedTimers: ObservableObject {
    static let shared = NamedTimers()

    @Published private(set) var timers: [NamedTimer] = []
    @AppStorage("timer.named") private var stored = Data()
    private var ticker: Timer?
    static let maxCount = 8

    private init() {
        timers = (try? JSONDecoder().decode([NamedTimer].self, from: stored)) ?? []
        tick()
        ensureTicker()
    }

    /// Adds a timer from text like "Pasta 10m". Returns an explanation when it can't.
    @discardableResult
    func add(_ input: String) -> String? {
        guard let parsed = NamedTimerLogic.parse(input) else { return "Add a time: “Pasta 10m”, “Egg 1:30” or “Tea 3 min”." }
        guard timers.filter({ !$0.done }).count < Self.maxCount else { return "That's \(Self.maxCount) running. Remove one first." }
        timers.append(NamedTimer(name: parsed.name, seconds: parsed.seconds, endsAt: Date().addingTimeInterval(TimeInterval(parsed.seconds))))
        save(); ensureTicker()
        return nil
    }

    func remove(_ id: UUID) { timers.removeAll { $0.id == id }; save() }
    func clearDone() { timers.removeAll(where: \.done); save() }

    func remaining(_ t: NamedTimer, now: Date = Date()) -> Int { t.done ? 0 : max(0, Int(t.endsAt.timeIntervalSince(now).rounded(.up))) }

    private func save() { stored = (try? JSONEncoder().encode(timers)) ?? Data() }

    private func ensureTicker() {
        guard ticker == nil, timers.contains(where: { !$0.done }) else { return }
        let t = Timer(timeInterval: 1, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.tick() } }
        t.tolerance = 0.2
        RunLoop.main.add(t, forMode: .common)
        ticker = t
    }

    private func tick() {
        var finished: [NamedTimer] = []
        for i in timers.indices where !timers[i].done && timers[i].endsAt <= Date() {
            timers[i].done = true
            finished.append(timers[i])
        }
        if !finished.isEmpty {
            save()
            NSSound(named: "Glass")?.play()
            for t in finished {
                Notifier.post(title: "\(t.name) is done", body: "Your \(NamedTimerLogic.clock(t.seconds)) timer has finished.")
            }
            LiveActivityCenter.shared.flash(LiveActivity(symbol: "bell.fill", label: String(finished[0].name.prefix(12)), tint: .systemYellow), seconds: 6)
        }
        if !timers.contains(where: { !$0.done }) { ticker?.invalidate(); ticker = nil }
    }
}

/// The "Named" page of the Timer tab.
struct NamedTimersView: View {
    @StateObject private var store = NamedTimers.shared
    @State private var input = ""
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                TextField("Pasta 10m · Egg 1:30 · Tea 3 min", text: $input)
                    .textFieldStyle(.roundedBorder).onSubmit(add)
                Button("Start", action: add).buttonStyle(PurpleButtonStyle())
                if store.timers.contains(where: \.done) {
                    Button("Clear done", action: store.clearDone).buttonStyle(PurpleButtonStyle(prominent: false))
                }
            }
            if let problem { Text(problem).font(.system(size: 11)).foregroundStyle(.yellow) }
            TimelineView(.periodic(from: .now, by: 1)) { context in
                ScrollView {
                    VStack(spacing: 4) {
                        ForEach(store.timers) { t in
                            HStack {
                                Image(systemName: t.done ? "bell.fill" : "timer").foregroundStyle(t.done ? .yellow : Theme.accentBright)
                                Text(t.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                                Spacer()
                                Text(t.done ? "Done" : NamedTimerLogic.clock(store.remaining(t, now: context.date)))
                                    .font(.system(size: 15, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(t.done ? .yellow : .white)
                                Button { store.remove(t.id) } label: { Image(systemName: "xmark") }
                                    .buttonStyle(.plain).foregroundStyle(Theme.textSecondary).help("Remove")
                            }
                            .padding(.horizontal, 8).padding(.vertical, 5)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.surface))
                        }
                        if store.timers.isEmpty {
                            Text("Type a name and a time. Start as many as you need.").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }
        }
    }

    private func add() {
        problem = store.add(input)
        if problem == nil { input = "" }
    }
}
