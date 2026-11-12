//
//  NotchAIRoutinesView.swift
//  Notch Apple
//
//  The Routines section: saved requests that run on a schedule. Each shows when it runs next and how its last run went;
//  you can switch it off, run it now, resume it after three failures, or delete it. Research routines are Pro, agent
//  routines are Ultimate. Every run is an ordinary task you can watch in Tasks.
//

import SwiftUI

struct NotchAIRoutinesView: View {
    @ObservedObject private var store = NotchAIRoutineStore.shared
    @State private var adding = false
    @State private var name = ""
    @State private var kind = 0
    @State private var text = ""
    @State private var scheduleKind = 1
    @State private var minutes = 60
    @State private var time = Calendar.current.date(from: DateComponents(hour: 8, minute: 0)) ?? Date()
    @State private var days: Set<Int> = [2, 3, 4, 5, 6]
    @State private var problem: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Routines").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                    Spacer()
                    Button(adding ? "Cancel" : "New routine") { adding.toggle(); problem = nil }
                }
                Text("A routine runs a saved request again on a schedule. It only runs while Notch Apple is open and the Mac is awake and online; a run missed while the Mac was off is done once when it is back (if it is still worth it), never repeated. Three failures in a row pause it. Each run is a task you can watch in Tasks, and asks for approval like any other.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                if let m = store.message { Text(m).font(.system(size: 11)).foregroundStyle(.orange) }
                if adding { form }
                if store.routines.isEmpty && !adding {
                    Text("No routines yet. Try “every morning, what is new in physics” as a research question.").font(.system(size: 11)).foregroundStyle(Theme.textSecondary).padding(.top, 4)
                }
                ForEach(store.routines) { card($0) }
                if !store.online && !store.routines.isEmpty { Text("The Mac is offline: routines wait for the internet.").font(.system(size: 10)).foregroundStyle(.orange) }
            }
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Name (for example Morning physics)", text: $name).textFieldStyle(.roundedBorder)
            Picker("", selection: $kind) {
                Text("Research question (Pro)").tag(0)
                Text("Agent request (Ultimate)").tag(1)
            }.pickerStyle(.segmented).labelsHidden()
            TextField(kind == 0 ? "The question to search the web for" : "What the agents should do", text: $text).textFieldStyle(.roundedBorder)
            Picker("", selection: $scheduleKind) {
                Text("Every…").tag(0); Text("Daily").tag(1); Text("Weekly").tag(2)
            }.pickerStyle(.segmented).labelsHidden()
            switch scheduleKind {
            case 0:
                Picker("Repeat", selection: $minutes) {
                    ForEach([15, 30, 60, 120, 360, 720, 1440], id: \.self) { Text(RoutineSchedule.everyMinutes($0).describe()).tag($0) }
                }.frame(width: 220)
            default:
                DatePicker("At", selection: $time, displayedComponents: .hourAndMinute).frame(width: 200)
                if scheduleKind == 2 {
                    HStack(spacing: 4) {
                        ForEach(1...7, id: \.self) { d in
                            Toggle(Calendar.current.shortWeekdaySymbols[d - 1], isOn: Binding(get: { days.contains(d) }, set: { if $0 { days.insert(d) } else { days.remove(d) } }))
                                .toggleStyle(.button)
                        }
                    }
                }
            }
            if let p = problem { Text(p).font(.system(size: 11)).foregroundStyle(.orange) }
            Button("Save routine") { save() }
        }
        .padding(8).background(RoundedRectangle(cornerRadius: 8).fill(Theme.surface))
    }

    private func save() {
        let c = Calendar.current.dateComponents([.hour, .minute], from: time)
        let schedule: RoutineSchedule = switch scheduleKind {
        case 0: .everyMinutes(minutes)
        case 1: .daily(hour: c.hour ?? 8, minute: c.minute ?? 0)
        default: .weekly(weekdays: days.sorted(), hour: c.hour ?? 8, minute: c.minute ?? 0)
        }
        let action: RoutineAction = kind == 0 ? .research(question: text) : .agents(request: text)
        if let p = store.add(Routine(name: name, action: action, schedule: schedule)) { problem = p; return }
        name = ""; text = ""; problem = nil; adding = false
    }

    private func card(_ r: Routine) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Toggle("", isOn: Binding(get: { r.enabled && !r.isPaused }, set: { store.setEnabled(r.id, $0) })).labelsHidden().toggleStyle(.switch).disabled(r.isPaused)
                VStack(alignment: .leading, spacing: 1) {
                    Text(r.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                    Text("\(r.action.kindLabel) · \(r.schedule.describe())").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                Button("Run now") { store.runNow(r.id) }.disabled(r.isPaused)
                Button { store.remove(r.id) } label: { Image(systemName: "trash") }.buttonStyle(.plain).help("Delete this routine")
            }
            Text(r.action.text).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(2)
            if let why = r.pausedReason {
                HStack { Text(why).font(.system(size: 10)).foregroundStyle(.orange); Spacer(); Button("Resume") { store.resume(r.id) } }
            } else {
                HStack(spacing: 10) {
                    if let n = r.nextRun, r.enabled { Text("Next: \(n.formatted(date: .abbreviated, time: .shortened))") }
                    if let l = r.lastRun { Text("Last: \(l.formatted(date: .abbreviated, time: .shortened))") }
                    if let o = r.lastOutcome { Text(o).lineLimit(1) }
                }.font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
        }
        .padding(8).background(RoundedRectangle(cornerRadius: 8).fill(Theme.surface))
    }
}
