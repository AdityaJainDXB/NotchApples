//
//  HabitsView.swift
//  Notch apple
//
//  Habits (Pro), inside the Wellbeing tab: add something you want to do every day, tick today (or any of the last 7
//  days) and watch the streak grow. Saved on this Mac. The streak maths lives in HabitLogic.swift.
//

import SwiftUI

struct Habit: Codable, Identifiable, Equatable {
    var id = UUID()
    var name: String
    var done: [String] = []     // "yyyy-MM-dd"
}

@MainActor
final class HabitStore: ObservableObject {
    static let shared = HabitStore()
    @AppStorage("habits.items") private var data = Data()

    var habits: [Habit] { (try? JSONDecoder().decode([Habit].self, from: data)) ?? [] }
    private func set(_ list: [Habit]) { data = (try? JSONEncoder().encode(list)) ?? Data(); objectWillChange.send() }

    var today: String { Date().formatted(.iso8601.year().month().day()) }

    func add(_ name: String) {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, habits.count < 30 else { return }
        set(habits + [Habit(name: String(n.prefix(40)))])
    }

    func toggle(_ habit: Habit, on day: String) {
        var list = habits
        guard let i = list.firstIndex(where: { $0.id == habit.id }) else { return }
        if let at = list[i].done.firstIndex(of: day) { list[i].done.remove(at: at) } else { list[i].done.append(day) }
        set(list)
    }

    func remove(_ habit: Habit) { set(habits.filter { $0.id != habit.id }) }
}

struct HabitsView: View {
    @StateObject private var store = HabitStore.shared
    @State private var draft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("A habit to build, e.g. Read 10 pages", text: $draft).textFieldStyle(.roundedBorder).onSubmit(add)
                Button("Add", action: add).buttonStyle(PurpleButtonStyle()).disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if store.habits.isEmpty {
                Text("Nothing yet. Add a habit and tick it each day to build a streak.").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            }
            ScrollView {
                VStack(spacing: 6) {
                    ForEach(store.habits) { habit in row(habit) }
                }
            }
        }
    }

    private func add() { store.add(draft); draft = "" }

    private func row(_ habit: Habit) -> some View {
        let done = Set(habit.done)
        let streak = HabitLogic.currentStreak(done, today: store.today)
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(habit.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                Text("Best \(HabitLogic.bestStreak(done)) · \(HabitLogic.thisWeek(done, today: store.today)) of the last 7 days")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 4)
            HStack(spacing: 5) {
                ForEach(HabitLogic.lastDays(7, today: store.today), id: \.self) { day in
                    Button { store.toggle(habit, on: day) } label: {
                        Circle().fill(done.contains(day) ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Theme.surfaceHover))
                            .overlay(Circle().stroke(day == store.today ? Theme.accentBright : .clear, lineWidth: 1.5))
                            .frame(width: 16, height: 16)
                    }
                    .buttonStyle(.plain).help(day == store.today ? "Today" : day)
                }
            }
            Label("\(streak)", systemImage: "flame.fill").font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(streak > 0 ? Color.orange : Theme.textSecondary).frame(width: 46, alignment: .trailing)
                .help("Days in a row")
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
        .contextMenu { Button("Delete “\(habit.name)”", role: .destructive) { store.remove(habit) } }
    }
}
