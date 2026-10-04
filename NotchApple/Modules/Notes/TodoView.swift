//
//  TodoView.swift
//  Notch apple
//
//  To-do list in the Notes tab (free), saved on this Mac. With Pro it can also
//  show your Apple Reminders (the default list), and ticking one off completes
//  it in Reminders too. Reminders are read and written on this Mac with EventKit.
//

import EventKit
import SwiftUI

struct TodoItem: Codable, Identifiable, Equatable {
    var id = UUID()
    var text: String
    var done = false
    var created = Date()
}

@MainActor
final class TodoStore: ObservableObject {
    static let shared = TodoStore()

    @Published private(set) var items: [TodoItem] = []
    @Published private(set) var reminders: [EKReminder] = []
    @Published private(set) var remindersProblem: String?
    @AppStorage("todo.showReminders") var showReminders = false { didSet { Task { await loadReminders() } } }

    private let store = EKEventStore()
    private let url: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Notch apple", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("todos.json")
    }()

    private init() {
        items = (try? JSONDecoder().decode([TodoItem].self, from: Data(contentsOf: url))) ?? []
    }

    /// After iCloud sync replaced the file (Ultimate).
    func reloadFromDisk() { items = (try? JSONDecoder().decode([TodoItem].self, from: Data(contentsOf: url))) ?? items }

    func add(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        items.insert(TodoItem(text: t), at: 0)
        save()
    }

    func toggle(_ item: TodoItem) {
        guard let i = items.firstIndex(of: item) else { return }
        items[i].done.toggle()
        // Done items sink to the bottom.
        items.sort { !$0.done && $1.done }
        save()
    }

    func delete(_ item: TodoItem) { items.removeAll { $0.id == item.id }; save() }
    func clearDone() { items.removeAll(where: \.done); save() }

    private func save() { try? JSONEncoder().encode(items).write(to: url, options: .atomic) }

    // MARK: Reminders (Pro)

    func loadReminders() async {
        guard showReminders, Entitlements.shared.canUse(.remindersSync) else { reminders = []; return }
        let granted = (try? await store.requestFullAccessToReminders()) ?? false
        guard granted else { remindersProblem = "Allow Reminders in System Settings → Privacy & Security → Reminders."; reminders = []; return }
        remindersProblem = nil
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        let found: [EKReminder] = await withCheckedContinuation { c in
            store.fetchReminders(matching: predicate) { c.resume(returning: $0 ?? []) }
        }
        reminders = found.sorted { ($0.dueDateComponents?.date ?? .distantFuture) < ($1.dueDateComponents?.date ?? .distantFuture) }
    }

    func complete(_ r: EKReminder) {
        r.isCompleted = true
        try? store.save(r, commit: true)
        reminders.removeAll { $0.calendarItemIdentifier == r.calendarItemIdentifier }
    }

    func addReminder(_ text: String) {
        guard Entitlements.shared.canUse(.remindersSync), let cal = store.defaultCalendarForNewReminders() else { return }
        let r = EKReminder(eventStore: store)
        r.title = text
        r.calendar = cal
        try? store.save(r, commit: true)
        Task { await loadReminders() }
    }
}

struct TodoView: View {
    @StateObject private var todos = TodoStore.shared
    @ObservedObject private var entitlements = Entitlements.shared
    @State private var new = ""
    @State private var toReminders = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("Add a to-do and press Return", text: $new)
                    .textFieldStyle(.roundedBorder).font(.system(size: 12))
                    .onSubmit(add)
                if entitlements.canUse(.remindersSync) && todos.showReminders {
                    Toggle("To Reminders", isOn: $toReminders).toggleStyle(.checkbox).font(.system(size: 11))
                }
                Button("Add", action: add).buttonStyle(PurpleButtonStyle()).disabled(new.isEmpty)
            }
            ScrollView {
                VStack(spacing: 2) {
                    ForEach(todos.items) { item in
                        HStack(spacing: 8) {
                            Button { withAnimation(Theme.spring) { todos.toggle(item) } } label: {
                                Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(item.done ? .green : Theme.textSecondary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(item.done ? "Mark not done" : "Mark done")
                            Text(item.text).strikethrough(item.done).foregroundStyle(item.done ? Theme.textSecondary : .white)
                                .font(.system(size: 13)).lineLimit(2)
                            Spacer()
                            IconButton(systemImage: "xmark", help: "Delete") { todos.delete(item) }
                        }
                        .padding(.horizontal, 8).padding(.vertical, 3)
                    }
                    if todos.items.isEmpty && todos.reminders.isEmpty {
                        Text("Nothing to do. Nice.").font(.system(size: 12)).foregroundStyle(Theme.textSecondary).padding(.top, 20)
                    }
                    if !todos.reminders.isEmpty {
                        Text("Reminders").sectionTitle().frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
                        ForEach(todos.reminders, id: \.calendarItemIdentifier) { r in
                            HStack(spacing: 8) {
                                Button { withAnimation(Theme.spring) { todos.complete(r) } } label: {
                                    Image(systemName: "circle").foregroundStyle(Color(cgColor: r.calendar.cgColor))
                                }
                                .buttonStyle(.plain).accessibilityLabel("Complete \(r.title ?? "reminder")")
                                Text(r.title ?? "").font(.system(size: 13)).foregroundStyle(.white).lineLimit(2)
                                Spacer()
                                if let due = r.dueDateComponents?.date {
                                    Text(due.formatted(date: .abbreviated, time: .omitted)).font(.system(size: 10))
                                        .foregroundStyle(due < .now ? .orange : Theme.textSecondary)
                                }
                            }
                            .padding(.horizontal, 8).padding(.vertical, 3)
                        }
                    }
                }
            }
            HStack {
                if todos.items.contains(where: \.done) { Button("Clear done") { todos.clearDone() }.buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(Theme.accentBright) }
                Spacer()
                if entitlements.canUse(.remindersSync) {
                    Toggle("Show Reminders", isOn: $todos.showReminders).toggleStyle(.switch).controlSize(.mini).font(.system(size: 11))
                } else {
                    HStack(spacing: 4) { TierBadge(tier: .pro); Text("Sync with Reminders").font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
                        .help(Feature.remindersSync.benefit)
                }
            }
            if let p = todos.remindersProblem { Text(p).font(.system(size: 11)).foregroundStyle(.orange) }
        }
        .task { await todos.loadReminders() }
    }

    private func add() {
        if toReminders && entitlements.canUse(.remindersSync) && todos.showReminders { todos.addReminder(new) } else { todos.add(new) }
        new = ""
    }
}
