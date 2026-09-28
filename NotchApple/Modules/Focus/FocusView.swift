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

                Text("The countdown also shows beside the notch while it runs. Every 4th session earns a long break.")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, 12)
        .frame(maxHeight: .infinity)
    }
}
