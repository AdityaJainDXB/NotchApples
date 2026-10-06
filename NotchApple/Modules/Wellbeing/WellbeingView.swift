//
//  WellbeingView.swift
//  Notch apple
//
//  The Wellbeing tab (free, off until you turn it on in Settings → Modules): a breathing exercise, break reminders
//  (eyes, water, stretch, posture) and a bedtime nudge. The reminders keep running while the notch is closed: a
//  notification and a short note beside the notch. The rules live in WellbeingLogic.swift.
//

import AppKit
import SwiftUI

@MainActor
final class WellbeingService: ObservableObject {
    static let shared = WellbeingService()
    typealias W = WellbeingLogic

    @AppStorage("wellbeing.on") var remindersOn = true
    @AppStorage("wellbeing.from") var from = 540            // minutes since midnight
    @AppStorage("wellbeing.to") var to = 1080
    @AppStorage("wellbeing.bedtime.on") var bedtimeOn = false
    @AppStorage("wellbeing.bedtime.at") var bedtime = 1380
    @AppStorage("wellbeing.bedtime.lead") var bedtimeLead = 30
    @AppStorage("wellbeing.snoozedUntil") private var snoozedUntil = 0.0
    @AppStorage("wellbeing.bedtimeDay") private var bedtimeDay = ""
    @AppStorage("wellbeing.last") private var lastData = Data()
    private var timer: Timer?
    private var started = Date()

    func on(_ k: W.Break) -> Bool { UserDefaults.standard.bool(forKey: "wellbeing.\(k.rawValue).on") }
    func setOn(_ k: W.Break, _ v: Bool) { UserDefaults.standard.set(v, forKey: "wellbeing.\(k.rawValue).on"); objectWillChange.send() }
    func every(_ k: W.Break) -> Int { let v = UserDefaults.standard.integer(forKey: "wellbeing.\(k.rawValue).every"); return v > 0 ? v : k.defaultMinutes }
    func setEvery(_ k: W.Break, _ v: Int) { UserDefaults.standard.set(v, forKey: "wellbeing.\(k.rawValue).every"); objectWillChange.send() }
    func snooze(minutes: Int) { snoozedUntil = Date().addingTimeInterval(Double(minutes) * 60).timeIntervalSince1970; objectWillChange.send() }

    private var last: [W.Break: Int64] {
        get { ((try? JSONDecoder().decode([String: Int64].self, from: lastData)) ?? [:]).reduce(into: [:]) { if let k = W.Break(rawValue: $1.key) { $0[k] = $1.value } } }
        set { lastData = (try? JSONEncoder().encode(Dictionary(uniqueKeysWithValues: newValue.map { ($0.key.rawValue, $0.value) }))) ?? Data() }
    }

    func start() {
        started = Date()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.check() } }
        timer?.tolerance = 5
    }

    private var minuteOfDay: Int { let c = Calendar.current.dateComponents([.hour, .minute], from: Date()); return (c.hour ?? 0) * 60 + (c.minute ?? 0) }
    private var todayKey: String { Date().formatted(.iso8601.year().month().day()) }

    func check() {
        if remindersOn {
            let settings = Dictionary(uniqueKeysWithValues: W.Break.allCases.map { ($0, W.BreakSetting(on: on($0), everyMinutes: every($0))) })
            if let kind = W.nextDue(now: Int64(Date().timeIntervalSince1970 * 1000), startedMs: Int64(started.timeIntervalSince1970 * 1000), last: last,
                                    settings: settings, minuteOfDay: minuteOfDay, from: from, to: to, snoozedUntilMs: Int64(snoozedUntil * 1000)) {
                var l = last; l[kind] = Int64(Date().timeIntervalSince1970 * 1000); last = l
                Notifier.post(title: kind.title, body: kind.message)
                LiveActivityCenter.shared.flash(LiveActivity(symbol: kind.symbol, label: kind.title, tint: .systemTeal), seconds: 8)
            }
        }
        if bedtimeOn, W.bedtimeDue(minuteOfDay: minuteOfDay, bedtime: bedtime, lead: bedtimeLead, lastDayKey: bedtimeDay, todayKey: todayKey) {
            bedtimeDay = todayKey
            Notifier.post(title: "Time to wind down", body: "Screens off soon: your bedtime is coming up.")
            LiveActivityCenter.shared.flash(LiveActivity(symbol: "moon.stars.fill", label: "Wind down", tint: .systemIndigo), seconds: 8)
        }
    }
}

struct WellbeingView: View {
    @StateObject private var service = WellbeingService.shared
    @AppStorage("wellbeing.pattern") private var patternID = "box"
    @State private var breathingSince: Date?
    @AppStorage("wellbeing.page") private var page = "calm"

    private var pattern: WellbeingLogic.Pattern { WellbeingLogic.Pattern.all.first { $0.id == patternID } ?? .box }

    var body: some View {
        VStack(spacing: 8) {
            Picker("", selection: $page) { Text("Breathe & reminders").tag("calm"); Text("Habits").tag("habits") }
                .pickerStyle(.segmented).labelsHidden().frame(width: 260)
            if page == "habits" {
                GlassCard { HabitsView() }.requires(.habits)
            } else {
                HStack(spacing: 12) {
                    GlassCard { breathing }.frame(width: 250)
                    GlassCard { reminders }
                }
            }
        }
    }

    // MARK: Breathing

    private var breathing: some View {
        VStack(spacing: 8) {
            Text("Breathe").sectionTitle().frame(maxWidth: .infinity, alignment: .leading)
            TimelineView(.animation(paused: breathingSince == nil)) { ctx in
                let state = breathingSince.map { WellbeingLogic.breath(pattern, elapsed: ctx.date.timeIntervalSince($0)) }
                VStack(spacing: 6) {
                    ZStack {
                        Circle().fill(Theme.accentGradient).shadow(color: Theme.accent.opacity(0.5), radius: 16)
                            .frame(width: 112, height: 112).scaleEffect(0.45 + 0.55 * (state?.size ?? 0))
                    }
                    .frame(height: 116)
                    Text(state?.label ?? "Ready").font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(.white)
                    Text(state.map { "\($0.secondsLeft)s · \($0.cycles) round\($0.cycles == 1 ? "" : "s") done" } ?? "Pick a pattern, then press Start.")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
            }
            Button(breathingSince == nil ? "Start" : "Stop") { breathingSince = breathingSince == nil ? Date() : nil }
                .buttonStyle(PurpleButtonStyle())
            Picker("", selection: $patternID) {
                Text("Box").tag("box"); Text("4-7-8").tag("478"); Text("5-5").tag("55")
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            .onChange(of: patternID) { _, _ in if breathingSince != nil { breathingSince = Date() } }
            Spacer(minLength: 0)
        }
    }

    // MARK: Reminders

    private func asDate(_ minutes: Int) -> Date { Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: Date()) ?? Date() }
    private func minutes(_ d: Date) -> Int { let c = Calendar.current.dateComponents([.hour, .minute], from: d); return (c.hour ?? 0) * 60 + (c.minute ?? 0) }
    private func timeBinding(_ get: @escaping () -> Int, _ set: @escaping (Int) -> Void) -> Binding<Date> {
        Binding(get: { asDate(get()) }, set: { set(minutes($0)) })
    }

    private var reminders: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Reminders").sectionTitle()
                Spacer()
                Toggle("", isOn: $service.remindersOn).labelsHidden().toggleStyle(.switch).controlSize(.small)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(WellbeingLogic.Break.allCases) { k in
                        HStack(spacing: 8) {
                            Image(systemName: k.symbol).frame(width: 22).foregroundStyle(Theme.accentBright)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(k.title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                                Text(k.message).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(2)
                            }
                            Spacer(minLength: 4)
                            Picker("", selection: Binding(get: { service.every(k) }, set: { service.setEvery(k, $0) })) {
                                ForEach([5, 10, 15, 20, 30, 45, 60, 90, 120], id: \.self) { Text("\($0) min").tag($0) }
                            }
                            .labelsHidden().frame(width: 84)
                            Toggle("", isOn: Binding(get: { service.on(k) }, set: { service.setOn(k, $0) })).labelsHidden().toggleStyle(.switch).controlSize(.small)
                        }
                        .disabled(!service.remindersOn)
                    }
                    Divider().opacity(0.3)
                    HStack {
                        Text("Only between").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                        DatePicker("", selection: timeBinding({ service.from }, { service.from = $0 }), displayedComponents: .hourAndMinute).labelsHidden()
                        Text("and").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                        DatePicker("", selection: timeBinding({ service.to }, { service.to = $0 }), displayedComponents: .hourAndMinute).labelsHidden()
                    }
                    HStack {
                        Image(systemName: "moon.stars.fill").frame(width: 22).foregroundStyle(Theme.accentBright)
                        Text("Bedtime wind-down").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                        Spacer()
                        DatePicker("", selection: timeBinding({ service.bedtime }, { service.bedtime = $0 }), displayedComponents: .hourAndMinute).labelsHidden()
                        Toggle("", isOn: $service.bedtimeOn).labelsHidden().toggleStyle(.switch).controlSize(.small)
                    }
                    Button("Snooze all for an hour") { service.snooze(minutes: 60) }.buttonStyle(PurpleButtonStyle(prominent: false))
                }
            }
        }
    }
}
