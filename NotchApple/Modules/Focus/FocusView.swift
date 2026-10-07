//
//  FocusView.swift
//  Notch apple
//
//  The Focus tab: a big ring countdown with start / pause / reset, session
//  type switcher, and today's completed sessions.
//

import SwiftUI

struct FocusView: View {
    @StateObject private var timer = FocusTimer.shared

    var body: some View {
        HStack(spacing: 28) {
            ZStack {
                Circle().stroke(Theme.surface, lineWidth: 12)
                Circle()
                    .trim(from: 0, to: timer.progress)
                    .stroke(timer.phase == .focus ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Color.green.gradient),
                            style: StrokeStyle(lineWidth: 12, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.linear(duration: 0.5), value: timer.progress)
                VStack(spacing: 2) {
                    Text(FocusTimer.format(timer.remaining))
                        .font(.system(size: 40, weight: .bold, design: .rounded)).monospacedDigit()
                        .foregroundStyle(.white)
                        .contentTransition(.numericText())
                    Text(timer.phase.rawValue).font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.textSecondary)
                }
            }
            .frame(width: 190, height: 190)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(timer.phase.rawValue), \(FocusTimer.format(timer.remaining)) remaining")

            VStack(alignment: .leading, spacing: 14) {
                Picker("Session", selection: Binding(get: { timer.phase }, set: { timer.switchTo($0) })) {
                    Text("Focus").tag(FocusTimer.Phase.focus)
                    Text("Break").tag(FocusTimer.Phase.shortBreak)
                    Text("Long break").tag(FocusTimer.Phase.longBreak)
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()

                HStack(spacing: 8) {
                    Button { timer.isRunning ? timer.pause() : timer.start() } label: {
                        Label(timer.isRunning ? "Pause" : (timer.remaining < timer.duration ? "Resume" : "Start"),
                              systemImage: timer.isRunning ? "pause.fill" : "play.fill")
                            .frame(minWidth: 90)
                    }
                    .buttonStyle(PurpleButtonStyle())
                    .keyboardShortcut(.space, modifiers: [])
                    Button("Reset", action: timer.reset).buttonStyle(PurpleButtonStyle(prominent: false))
                    Button("Skip", action: timer.skip).buttonStyle(PurpleButtonStyle(prominent: false))
                        .help("End this session now")
                }

                HStack(spacing: 6) {
                    ForEach(0..<4, id: \.self) { i in
                        Circle().fill(i < timer.sessionsToday % 4 || (timer.sessionsToday > 0 && timer.sessionsToday % 4 == 0)
                                      ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Theme.surfaceHover))
                            .frame(width: 10, height: 10)
                    }
                    Text("\(timer.sessionsToday) focus session\(timer.sessionsToday == 1 ? "" : "s") today")
                        .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                }

                // Daily goal: a bar that fills as you focus.
                HStack(spacing: 8) {
                    if timer.dailyGoal > 0 {
                        let f = WellbeingLogic.goalFraction(minutes: timer.minutesToday, goal: timer.dailyGoal)
                        ProgressView(value: f).tint(f >= 1 ? .green : Theme.accent).frame(width: 130)
                        Text("\(timer.minutesToday) of \(timer.dailyGoal) min").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    }
                    Stepper(timer.dailyGoal > 0 ? "Goal" : "Set a daily goal", value: $timer.dailyGoal, in: 0...600, step: 15)
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).fixedSize()
                }

                // Project (Pro): what this session counts towards, and this week split by project.
                if Entitlements.shared.canUse(.focusProjects) {
                    HStack(spacing: 6) {
                        Image(systemName: "folder").foregroundStyle(Theme.textSecondary).font(.system(size: 11))
                        TextField("Project (optional)", text: $timer.project).textFieldStyle(.plain).font(.system(size: 12)).frame(width: 150)
                            .onSubmit { timer.project = ProjectFocusLogic.clean(timer.project) }
                        if !timer.projectNames.isEmpty {
                            Menu {
                                ForEach(timer.projectNames, id: \.self) { n in Button(n) { timer.project = n } }
                            } label: { Image(systemName: "chevron.down") }
                            .menuStyle(.borderlessButton).fixedSize()
                        }
                    }
                    let byProject = Array(timer.weekByProject.prefix(3))
                    if !byProject.isEmpty {
                        Text(byProject.map { "\($0.project) \($0.minutes / 60)h \($0.minutes % 60)m" }.joined(separator: " · "))
                            .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                    }
                }

                // This week's focus minutes.
                HStack(alignment: .bottom, spacing: 6) {
                    let week = timer.lastWeek
                    let top = max(week.map(\.minutes).max() ?? 0, 25)
                    ForEach(week, id: \.day) { entry in
                        VStack(spacing: 3) {
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Calendar.current.isDateInToday(entry.day) ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Theme.surfaceHover))
                                .frame(width: 16, height: max(3, 44 * CGFloat(entry.minutes) / CGFloat(top)))
                                .help("\(entry.minutes) min")
                            Text(entry.day.formatted(.dateTime.weekday(.narrow))).font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
                        }
                    }
                    let total = week.map(\.minutes).reduce(0, +)
                    Text("\(total / 60)h \(total % 60)m this week").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                        .padding(.leading, 6)
                }
                .frame(height: 60, alignment: .bottom)

                Text("The countdown shows beside the notch while it runs. Every 4th session earns a long break. Settings → Focus can turn Do Not Disturb on during sessions.")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, 12)
        .frame(maxHeight: .infinity)
    }
}
