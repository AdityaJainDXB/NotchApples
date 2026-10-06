//
//  TodayWellbeing.swift
//  Notch apple
//
//  Two small additions to the Today tab: "One thing today" (a single line that clears itself tomorrow) and
//  countdowns to dates you care about (an exam, a trip, a launch). The date maths is in WellbeingLogic.swift.
//

import SwiftUI

struct OneThingToday: View {
    @AppStorage("today.oneThing") private var text = ""
    @AppStorage("today.oneThingDay") private var day = ""
    @State private var draft = ""
    private var today: String { Date().formatted(.iso8601.year().month().day()) }

    var body: some View {
        TextField("The one thing today…", text: $draft)
            .textFieldStyle(.plain).font(.system(size: 12))
            .padding(.horizontal, 8).padding(.vertical, 5)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
            .onSubmit { text = String(draft.prefix(90)).trimmingCharacters(in: .whitespaces); day = today }
            .onAppear { draft = day == today ? text : "" }
    }
}

struct Countdown: Codable, Identifiable, Equatable {
    var id = UUID()
    var title: String
    var date: String      // yyyy-MM-dd
}

@MainActor
final class CountdownStore: ObservableObject {
    static let shared = CountdownStore()
    @AppStorage("today.countdowns") private var data = Data()

    var all: [Countdown] { (try? JSONDecoder().decode([Countdown].self, from: data)) ?? [] }
    private func set(_ list: [Countdown]) { data = (try? JSONEncoder().encode(list)) ?? Data(); objectWillChange.send() }

    /// The next few, soonest first. One that passed yesterday stays for a day, then goes.
    func upcoming(limit: Int = 3) -> [(item: Countdown, days: Int)] {
        let today = Date().formatted(.iso8601.year().month().day())
        return all.compactMap { c in WellbeingLogic.daysBetween(today, c.date).map { (c, $0) } }
            .filter { $0.1 >= -1 }.sorted { $0.1 < $1.1 }.prefix(limit).map { (item: $0.0, days: $0.1) }
    }

    func add(_ title: String, on date: Date) {
        let t = title.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        set(all + [Countdown(title: String(t.prefix(40)), date: date.formatted(.iso8601.year().month().day()))])
    }

    func remove(_ c: Countdown) { set(all.filter { $0.id != c.id }) }
}

struct CountdownsList: View {
    @StateObject private var store = CountdownStore.shared
    @State private var adding = false
    @State private var title = ""
    @State private var date = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Countdowns").sectionTitle()
                Spacer()
                Button("+ Add") { adding = true }.buttonStyle(.plain).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.accentBright)
                    .popover(isPresented: $adding) {
                        VStack(alignment: .leading, spacing: 8) {
                            TextField("What is it? (Exam, Trip, Launch…)", text: $title).textFieldStyle(.roundedBorder).frame(width: 220)
                            DatePicker("Date", selection: $date, in: Date()..., displayedComponents: .date)
                            HStack { Spacer(); Button("Add") { store.add(title, on: date); title = ""; adding = false }.disabled(title.trimmingCharacters(in: .whitespaces).isEmpty) }
                        }
                        .padding(12)
                    }
            }
            let items = store.upcoming()
            if items.isEmpty { Text("Add a date to count down to.").font(.system(size: 12)).foregroundStyle(Theme.textSecondary) }
            ForEach(items, id: \.item.id) { entry in
                HStack {
                    Text(entry.item.title).font(.system(size: 13)).foregroundStyle(.white).lineLimit(1)
                    Spacer()
                    Text(WellbeingLogic.countdownLabel(days: entry.days)).font(.system(size: 13, weight: .bold)).foregroundStyle(.white).monospacedDigit()
                    Button { store.remove(entry.item) } label: { Image(systemName: "xmark") }.buttonStyle(.plain).foregroundStyle(Theme.textSecondary).font(.system(size: 9))
                        .help("Remove")
                }
            }
        }
    }
}
